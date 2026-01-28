import "server-only";

/**
 * DSM-5 RAG Retriever
 *
 * Retrieves relevant DSM-5 passages using pgvector similarity search.
 */

import { cosineDistance, desc, gt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import OpenAI from "openai";
import postgres from "postgres";
import { dsmChunk } from "@/lib/db/schema";
import { type DsmCitation, RAG_CONFIG } from "./rag-config";

// ============================================================================
// Database Connection
// ============================================================================

const client = postgres(process.env.POSTGRES_URL ?? "");
const db = drizzle(client);

// ============================================================================
// OpenAI Client (Lazy initialization)
// ============================================================================

let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is required for RAG retrieval");
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

// ============================================================================
// Embedding Generation
// ============================================================================

/**
 * Generate embedding for a query string
 */
async function generateQueryEmbedding(query: string): Promise<number[]> {
  const openai = getOpenAIClient();
  const response = await openai.embeddings.create({
    model: RAG_CONFIG.embedModel,
    input: query,
  });

  return response.data[0].embedding;
}

// ============================================================================
// Retrieval Functions
// ============================================================================

/**
 * Retrieve relevant DSM-5 passages for a query
 *
 * @param query - The search query (e.g., symptom summary or diagnosis hypothesis)
 * @param topK - Number of passages to retrieve (default: 5)
 * @param minSimilarity - Minimum similarity threshold (default: 0.7)
 * @returns Array of citations with content and metadata
 */
export async function retrieveDsmPassages(
  query: string,
  topK: number = RAG_CONFIG.topK,
  minSimilarity: number = RAG_CONFIG.similarityThreshold
): Promise<DsmCitation[]> {
  // Generate embedding for the query
  const queryEmbedding = await generateQueryEmbedding(query);

  // Perform similarity search using pgvector
  // cosineDistance returns distance (0 = identical), so we compute similarity as 1 - distance
  const results = await db
    .select({
      id: dsmChunk.id,
      content: dsmChunk.content,
      page: dsmChunk.page,
      sectionPath: dsmChunk.sectionPath,
      similarity: sql<number>`1 - (${cosineDistance(dsmChunk.embedding, queryEmbedding)})`,
    })
    .from(dsmChunk)
    .where(
      gt(
        sql`1 - (${cosineDistance(dsmChunk.embedding, queryEmbedding)})`,
        minSimilarity
      )
    )
    .orderBy(
      desc(sql`1 - (${cosineDistance(dsmChunk.embedding, queryEmbedding)})`)
    )
    .limit(topK);

  // Convert to citations
  return results.map((result) => ({
    id: result.id,
    sectionPath: result.sectionPath,
    page: result.page,
    snippet: truncateSnippet(result.content, 200),
    fullContent: result.content,
    relevance: result.similarity,
  }));
}

/**
 * Build a retrieval query from symptom summary and candidate diagnoses
 */
export function buildRetrievalQuery(
  symptomSummary: Array<{ domain: string; severity: string; score: number }>,
  candidateDiagnoses?: string[]
): string {
  const parts: string[] = [];

  // Add flagged symptom domains
  const flaggedDomains = symptomSummary
    .filter((s) => s.severity !== "none" && s.score >= 2)
    .map((s) => s.domain);

  if (flaggedDomains.length > 0) {
    parts.push(`Symptoms in domains: ${flaggedDomains.join(", ")}`);
  }

  // Add candidate diagnoses if provided
  if (candidateDiagnoses && candidateDiagnoses.length > 0) {
    parts.push(`Possible diagnoses: ${candidateDiagnoses.join(", ")}`);
  }

  // Add common DSM search terms
  parts.push("diagnostic criteria specifiers differential diagnosis");

  return parts.join(". ");
}

/**
 * Domain-specific DSM-5 query mapping for better retrieval alignment
 * Each domain maps to specific DSM-5 diagnostic criteria terms
 */
const DOMAIN_DSM_QUERIES: Record<string, string> = {
  "Depression": "major depressive disorder MDD diagnostic criteria depressed mood anhedonia",
  "Anxiety": "generalized anxiety disorder GAD diagnostic criteria excessive worry restlessness",
  "Somatic Symptoms": "somatic symptom disorder diagnostic criteria health anxiety excessive thoughts",
  "Repetitive Thoughts and Behaviors": "obsessive compulsive disorder OCD diagnostic criteria intrusive thoughts compulsive behaviors",
  "Mania": "bipolar disorder manic episode hypomanic diagnostic criteria elevated mood",
  "Psychosis": "schizophrenia spectrum psychotic features hallucinations delusions diagnostic criteria",
  "Sleep Problems": "insomnia disorder sleep-wake diagnostic criteria difficulty sleeping",
  "Suicidal Ideation": "suicidal behavior disorder self-harm criteria safety assessment",
  "Substance Use": "substance use disorder dependence abuse diagnostic criteria withdrawal tolerance",
  "Dissociation": "dissociative disorders depersonalization derealization diagnostic criteria",
  "Personality Functioning": "personality disorder general criteria interpersonal functioning identity",
  "Memory": "neurocognitive disorder cognitive decline memory impairment diagnostic criteria",
  "Anger": "intermittent explosive disorder disruptive mood dysregulation diagnostic criteria aggression",
};

/**
 * Get the DSM-5 specific query for a domain
 */
export function getDomainDsmQuery(domain: string): string {
  return DOMAIN_DSM_QUERIES[domain] ?? `${domain} DSM-5 diagnostic criteria symptoms`;
}

/**
 * Retrieve citations for specific symptom domains using domain-aligned queries
 */
export async function retrieveCitationsForDomains(
  domains: string[],
  minSimilarity: number = 0.65
): Promise<Map<string, DsmCitation[]>> {
  const citationsByDomain = new Map<string, DsmCitation[]>();

  for (const domain of domains) {
    // Use domain-specific DSM-5 query for better alignment
    const query = getDomainDsmQuery(domain);
    const citations = await retrieveDsmPassages(query, 2, minSimilarity);
    
    // Add domain linkage to each citation
    const linkedCitations = citations.map(c => ({
      ...c,
      linkedDomain: domain,
    }));
    
    citationsByDomain.set(domain, linkedCitations);
  }

  return citationsByDomain;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Truncate text to a maximum length, preserving word boundaries
 */
function truncateSnippet(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;

  const truncated = text.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(" ");

  if (lastSpace > maxLength * 0.8) {
    return `${truncated.slice(0, lastSpace)}...`;
  }

  return `${truncated}...`;
}

/**
 * Check if RAG data is available (at least one completed source)
 */
export async function isRagAvailable(): Promise<boolean> {
  const { dsmSource } = await import("@/lib/db/schema");

  const sources = await db
    .select({ id: dsmSource.id })
    .from(dsmSource)
    .where(sql`${dsmSource.status} = 'completed'`)
    .limit(1);

  return sources.length > 0;
}
