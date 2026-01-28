import "server-only";

import OpenAI from "openai";
import type { CoherenceMetrics, Snapshot } from "../benchmark-schemas";
import { RAG_CONFIG } from "../rag-config";

// ============================================================================
// OpenAI Client (Lazy initialization)
// ============================================================================

let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is required for coherence metrics");
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

// ============================================================================
// Embedding Generation
// ============================================================================

/**
 * Generate embedding for a text string
 */
async function generateEmbedding(text: string): Promise<number[]> {
  const openai = getOpenAIClient();
  const response = await openai.embeddings.create({
    model: RAG_CONFIG.embedModel,
    input: text,
  });

  return response.data[0].embedding;
}

/**
 * Generate embeddings for multiple texts in batch (more efficient)
 */
async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  const openai = getOpenAIClient();
  const response = await openai.embeddings.create({
    model: RAG_CONFIG.embedModel,
    input: texts,
  });

  return response.data.map((d) => d.embedding);
}

// ============================================================================
// Cosine Similarity
// ============================================================================

/**
 * Computes cosine similarity between two vectors
 * Returns value between -1 and 1 (1 = identical, 0 = orthogonal, -1 = opposite)
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error("Vectors must have the same dimension");
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (normA * normB);
}

// ============================================================================
// Q/A Pair Extraction
// ============================================================================

interface QAPair {
  question: string;
  response: string;
}

/**
 * Extracts question/answer pairs from the transcript
 * Pairs consecutive interviewer questions with patient responses
 */
function extractQAPairs(
  transcript: Array<{ role: string; text: string }>
): QAPair[] {
  const pairs: QAPair[] = [];

  for (let i = 0; i < transcript.length - 1; i++) {
    const current = transcript[i];
    const next = transcript[i + 1];

    // Look for interviewer question followed by patient response
    if (current.role === "interviewer" && next.role === "patient") {
      // Only include if the interviewer message looks like a question
      if (current.text.includes("?") || current.text.length < 500) {
        pairs.push({
          question: current.text,
          response: next.text,
        });
      }
    }
  }

  return pairs;
}

// ============================================================================
// Report Summary Extraction
// ============================================================================

/**
 * Extracts the summary section from a streamdown report
 */
function extractReportSummary(report: string): string {
  // Try to find summary section
  const summaryMatch = report.match(
    /(?:##?\s*(?:Executive\s+)?Summary|##?\s*Overview)([\s\S]*?)(?=##|$)/i
  );

  if (summaryMatch) {
    return summaryMatch[1].trim();
  }

  // Fallback: take first few paragraphs
  const paragraphs = report.split(/\n\n+/);
  const textParagraphs = paragraphs
    .filter((p) => !p.startsWith("#") && !p.startsWith("|") && p.trim().length > 0)
    .slice(0, 3);

  return textParagraphs.join(" ").trim();
}

/**
 * Builds domain summary text from symptom domains
 */
function buildDomainSummaryText(
  domainSummary: Array<{
    domain: string;
    severityAggregate: number;
    notableSymptoms: string[];
  }>
): string {
  const parts: string[] = [];

  for (const domain of domainSummary) {
    if (domain.severityAggregate > 0 || domain.notableSymptoms.length > 0) {
      let part = domain.domain;
      if (domain.notableSymptoms.length > 0) {
        part += `: ${domain.notableSymptoms.join(", ")}`;
      }
      parts.push(part);
    }
  }

  return parts.join(". ");
}

// ============================================================================
// Statistical Utilities
// ============================================================================

/**
 * Computes the arithmetic mean of an array of numbers
 */
function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// ============================================================================
// Main Coherence Computation
// ============================================================================

/**
 * Computes coherence metrics for a snapshot using embedding similarity
 *
 * QA Coherence: Measures how well patient responses relate to interviewer questions
 * Report Alignment: Measures how well the report summary aligns with domain summaries
 */
export async function computeCoherenceMetrics(
  snapshot: Snapshot
): Promise<CoherenceMetrics> {
  // Extract Q/A pairs from transcript
  const qaPairs = extractQAPairs(snapshot.transcript);

  // Compute QA coherence
  let qaCoherenceAvg = 1.0; // Default to perfect if no pairs

  if (qaPairs.length > 0) {
    // Batch embed all questions and responses
    const allTexts = [...qaPairs.map((p) => p.question), ...qaPairs.map((p) => p.response)];
    const allEmbeddings = await generateEmbeddings(allTexts);

    // Split embeddings
    const questionEmbeddings = allEmbeddings.slice(0, qaPairs.length);
    const responseEmbeddings = allEmbeddings.slice(qaPairs.length);

    // Compute similarities
    const similarities: number[] = [];
    for (let i = 0; i < qaPairs.length; i++) {
      const sim = cosineSimilarity(questionEmbeddings[i], responseEmbeddings[i]);
      similarities.push(sim);
    }

    qaCoherenceAvg = mean(similarities);
  }

  // Compute report alignment
  let reportAlignment = 1.0; // Default to perfect if no data

  const reportSummary = extractReportSummary(snapshot.report);
  const domainSummaryText = buildDomainSummaryText(snapshot.domainSummary);

  if (reportSummary.length > 0 && domainSummaryText.length > 0) {
    const [reportEmbed, domainEmbed] = await generateEmbeddings([
      reportSummary,
      domainSummaryText,
    ]);

    reportAlignment = cosineSimilarity(reportEmbed, domainEmbed);
  }

  return {
    qaCoherenceAvg,
    reportAlignment,
  };
}

/**
 * Computes coherence metrics with a fallback for when embeddings fail
 * Returns default values instead of throwing
 */
export async function computeCoherenceMetricsSafe(
  snapshot: Snapshot
): Promise<CoherenceMetrics> {
  try {
    return await computeCoherenceMetrics(snapshot);
  } catch (error) {
    console.error("Failed to compute coherence metrics:", error);
    // Return neutral values on failure
    return {
      qaCoherenceAvg: 0.5, // Neutral
      reportAlignment: 0.5, // Neutral
    };
  }
}
