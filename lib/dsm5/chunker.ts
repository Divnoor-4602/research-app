/**
 * DSM-5 Text Chunker
 *
 * Splits PDF text into semantic chunks for embedding and retrieval.
 * Uses hybrid approach: heading-aware splitting first, with fixed-size fallback.
 */

import { RAG_CONFIG } from "./rag-config";

// ============================================================================
// Types
// ============================================================================

export type ChunkMetadata = {
  chunkIndex: number;
  page: number | null;
  sectionPath: string | null;
  headingLevel: number | null;
  tokenCount: number;
};

export type TextChunk = {
  content: string;
  metadata: ChunkMetadata;
};

export type ChunkOptions = {
  maxTokens?: number;
  overlapTokens?: number;
  headingAware?: boolean;
};

// ============================================================================
// Token Estimation
// ============================================================================

/**
 * Estimate token count for text (rough approximation: ~4 chars per token)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ============================================================================
// Heading Detection
// ============================================================================

// Common DSM heading patterns
const HEADING_PATTERNS = [
  // Major section headings (all caps with optional numbers)
  /^([A-Z][A-Z\s-]+(?:\s+DISORDERS?)?)\s*$/m,
  // Subsection headings (Title Case with potential disorder names)
  /^((?:Major |Persistent |Generalized |Social |Specific )?\w+(?:\s+\w+)*\s+Disorder)\s*$/m,
  // Criteria sections
  /^(Diagnostic Criteria|Criteria|Specifiers|Prevalence|Development|Risk Factors|Differential Diagnosis)\s*$/m,
  // Criterion letters/numbers
  /^([A-E]\.\s+.+)$/m,
];

/**
 * Detect if a line is a heading and return its level (1-4) or null
 */
function detectHeadingLevel(line: string): number | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 100) return null;

  // All caps = level 1 (major section)
  if (/^[A-Z][A-Z\s-]{5,}$/.test(trimmed)) {
    return 1;
  }

  // Disorder names = level 2
  if (/Disorder\s*$/.test(trimmed) && trimmed.length < 60) {
    return 2;
  }

  // Criteria/Specifiers sections = level 3
  if (
    /^(Diagnostic Criteria|Criteria|Specifiers|Prevalence|Development|Risk Factors)/i.test(
      trimmed
    )
  ) {
    return 3;
  }

  // Criterion letters = level 4
  if (/^[A-E]\.\s+/.test(trimmed)) {
    return 4;
  }

  return null;
}

// ============================================================================
// Section Path Tracking
// ============================================================================

type SectionStack = Array<{ level: number; title: string }>;

/**
 * Update section stack when a new heading is encountered
 */
function updateSectionStack(
  stack: SectionStack,
  level: number,
  title: string
): SectionStack {
  // Remove all sections at same or deeper level
  const newStack = stack.filter((s) => s.level < level);
  newStack.push({ level, title });
  return newStack;
}

/**
 * Build section path string from stack
 */
function buildSectionPath(stack: SectionStack): string | null {
  if (stack.length === 0) return null;
  return stack.map((s) => s.title).join(" > ");
}

// ============================================================================
// Heading-Aware Chunking
// ============================================================================

/**
 * Split text by headings, respecting section boundaries
 */
function chunkByHeadings(
  text: string,
  maxTokens: number,
  overlapTokens: number
): TextChunk[] {
  const lines = text.split("\n");
  const chunks: TextChunk[] = [];
  let currentContent: string[] = [];
  let currentTokens = 0;
  let sectionStack: SectionStack = [];
  let currentPage = 1;
  let chunkIndex = 0;

  const flushChunk = (nextHeadingLevel?: number) => {
    if (currentContent.length === 0) return;

    const content = currentContent.join("\n").trim();
    if (content.length > 0) {
      chunks.push({
        content,
        metadata: {
          chunkIndex,
          page: currentPage,
          sectionPath: buildSectionPath(sectionStack),
          headingLevel: sectionStack.at(-1)?.level ?? null,
          tokenCount: estimateTokens(content),
        },
      });
      chunkIndex++;
    }

    // Keep overlap for context continuity
    if (overlapTokens > 0 && currentContent.length > 0) {
      const overlapLines: string[] = [];
      let overlapCount = 0;
      for (
        let i = currentContent.length - 1;
        i >= 0 && overlapCount < overlapTokens;
        i--
      ) {
        const lineTokens = estimateTokens(currentContent[i]);
        if (overlapCount + lineTokens <= overlapTokens) {
          overlapLines.unshift(currentContent[i]);
          overlapCount += lineTokens;
        } else {
          break;
        }
      }
      currentContent = overlapLines;
      currentTokens = overlapCount;
    } else {
      currentContent = [];
      currentTokens = 0;
    }
  };

  for (const line of lines) {
    // Detect page breaks (common PDF pattern)
    if (/^\s*\d+\s*$/.test(line.trim()) && line.trim().length <= 4) {
      const pageNum = Number.parseInt(line.trim(), 10);
      if (pageNum > currentPage && pageNum < currentPage + 10) {
        currentPage = pageNum;
      }
      continue;
    }

    const headingLevel = detectHeadingLevel(line);

    if (headingLevel !== null) {
      // Flush current chunk before starting new section
      flushChunk(headingLevel);
      sectionStack = updateSectionStack(
        sectionStack,
        headingLevel,
        line.trim()
      );
    }

    const lineTokens = estimateTokens(line);

    // Check if adding this line would exceed max tokens
    if (currentTokens + lineTokens > maxTokens && currentContent.length > 0) {
      flushChunk();
    }

    currentContent.push(line);
    currentTokens += lineTokens;
  }

  // Flush final chunk
  flushChunk();

  return chunks;
}

// ============================================================================
// Fixed-Size Chunking (Fallback)
// ============================================================================

/**
 * Split text into fixed-size chunks with overlap
 */
function chunkBySize(
  text: string,
  maxTokens: number,
  overlapTokens: number
): TextChunk[] {
  const chunks: TextChunk[] = [];
  const words = text.split(/\s+/);
  let currentWords: string[] = [];
  let currentTokens = 0;
  let chunkIndex = 0;

  const flushChunk = () => {
    if (currentWords.length === 0) return;

    const content = currentWords.join(" ").trim();
    if (content.length > 0) {
      chunks.push({
        content,
        metadata: {
          chunkIndex,
          page: null,
          sectionPath: null,
          headingLevel: null,
          tokenCount: estimateTokens(content),
        },
      });
      chunkIndex++;
    }

    // Keep overlap
    if (overlapTokens > 0) {
      const overlapWords: string[] = [];
      let overlapCount = 0;
      for (
        let i = currentWords.length - 1;
        i >= 0 && overlapCount < overlapTokens;
        i--
      ) {
        const wordTokens = estimateTokens(currentWords[i]);
        if (overlapCount + wordTokens <= overlapTokens) {
          overlapWords.unshift(currentWords[i]);
          overlapCount += wordTokens;
        } else {
          break;
        }
      }
      currentWords = overlapWords;
      currentTokens = overlapCount;
    } else {
      currentWords = [];
      currentTokens = 0;
    }
  };

  for (const word of words) {
    const wordTokens = estimateTokens(word);

    if (currentTokens + wordTokens > maxTokens && currentWords.length > 0) {
      flushChunk();
    }

    currentWords.push(word);
    currentTokens += wordTokens;
  }

  flushChunk();

  return chunks;
}

// ============================================================================
// Main Chunking Function
// ============================================================================

/**
 * Chunk text using hybrid approach
 *
 * Tries heading-aware chunking first if enabled, falls back to fixed-size.
 */
export function chunkText(
  text: string,
  options: ChunkOptions = {}
): TextChunk[] {
  const {
    maxTokens = RAG_CONFIG.chunkTokens,
    overlapTokens = RAG_CONFIG.chunkOverlap,
    headingAware = RAG_CONFIG.headingAware,
  } = options;

  // Clean up text
  const cleanedText = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!cleanedText) {
    return [];
  }

  // Try heading-aware chunking first
  if (headingAware) {
    const headingChunks = chunkByHeadings(
      cleanedText,
      maxTokens,
      overlapTokens
    );

    // If we got reasonable chunks, use them
    if (headingChunks.length > 0) {
      // Re-index chunks sequentially
      return headingChunks.map((chunk, idx) => ({
        ...chunk,
        metadata: { ...chunk.metadata, chunkIndex: idx },
      }));
    }
  }

  // Fallback to fixed-size chunking
  return chunkBySize(cleanedText, maxTokens, overlapTokens);
}

/**
 * Extract text from PDF buffer and chunk it
 */
export async function extractAndChunkPdf(
  pdfBuffer: Buffer,
  options: ChunkOptions = {}
): Promise<TextChunk[]> {
  // Dynamic import to avoid issues with server-only code
  // pdf-parse v2 exports PDFParse - pass data in constructor
  const { PDFParse } = await import("pdf-parse");

  const parser = new PDFParse({ data: pdfBuffer });
  const textResult = await parser.getText({});
  const text = textResult.text;

  return chunkText(text, options);
}
