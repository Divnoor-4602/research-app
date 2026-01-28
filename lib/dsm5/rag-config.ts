/**
 * DSM-5 RAG Configuration
 *
 * Configuration constants and types for the RAG (Retrieval-Augmented Generation)
 * system used to ground diagnoses with DSM-5 source material.
 */

// ============================================================================
// RAG Configuration Constants
// ============================================================================

export const RAG_CONFIG = {
  // Retrieval settings
  topK: 5, // Number of chunks to retrieve
  similarityThreshold: 0.7, // Minimum cosine similarity score (default)

  // Mode-specific retrieval settings
  citationsMinSimilarity: 0.65, // Lower threshold for citations mode
  citationsTopK: 5,
  groundedMinSimilarity: 0.75, // Higher threshold for grounded mode (stricter)
  groundedTopK: 8, // Retrieve more to filter for high-quality criterion anchors

  // Chunking settings
  chunkTokens: 1024, // Target token count per chunk
  chunkOverlap: 128, // Overlap between chunks for context continuity
  headingAware: true, // Try heading-based chunking first

  // Embedding settings
  embedModel: "text-embedding-3-small" as const,
  embedDims: 1536,
  embedBatchSize: 10, // Number of chunks to embed in one API call

  // Source metadata
  sourceName: "DSM-5-TR",
  sourceVersion: "2022",
} as const;

// ============================================================================
// RAG Mode Types
// ============================================================================

/**
 * RAG mode controls how DSM-5 retrieval is used during diagnosis
 *
 * - "off": No DSM retrieval, uses transcript and item responses only
 * - "citations": Retrieves DSM passages and includes citations in report
 * - "grounded": Retrieves DSM passages and requires criterion anchors (stricter)
 */
export type RagMode = "off" | "citations" | "grounded";

export const RAG_MODE_LABELS: Record<RagMode, string> = {
  off: "Off",
  citations: "Citations",
  grounded: "Grounded",
};

export const RAG_MODE_DESCRIPTIONS: Record<RagMode, string> = {
  off: "No DSM-5 retrieval - uses transcript only",
  citations: "Cite DSM-5 passages in diagnosis",
  grounded: "Require DSM criterion anchors (strict)",
};

// ============================================================================
// Citation Types
// ============================================================================

/**
 * Citation data returned from RAG retrieval
 */
export type DsmCitation = {
  id: string;
  sectionPath: string | null; // e.g., "Depressive Disorders > MDD > Criteria"
  page: number | null; // Page number if available
  snippet: string; // Short excerpt from the chunk
  fullContent: string; // Full chunk content
  relevance: number; // Cosine similarity score (0-1)
  linkedDomain?: string; // Domain this citation was retrieved for (for domain-aligned retrieval)
};

/**
 * Format a citation for display in the UI
 */
export function formatCitationBadge(citation: DsmCitation): string {
  if (citation.page) {
    return `DSM-5 p.${citation.page}`;
  }
  if (citation.sectionPath) {
    // Get the last segment of the section path
    const segments = citation.sectionPath.split(" > ");
    const shortPath = segments.slice(-2).join(" > ");
    return shortPath;
  }
  return "DSM-5";
}

/**
 * Get relevance color class based on similarity score
 */
export function getRelevanceColorClass(relevance: number): string {
  if (relevance >= 0.85) {
    return "text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/30";
  }
  if (relevance >= 0.7) {
    return "text-yellow-600 dark:text-yellow-400 bg-yellow-100 dark:bg-yellow-900/30";
  }
  return "text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800/30";
}
