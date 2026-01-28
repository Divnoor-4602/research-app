import type { RagMetrics, RetrievedChunk, Snapshot } from "../benchmark-schemas";

// ============================================================================
// Types
// ============================================================================

interface ReportCitation {
  chunkId: string;
  linkedDomain?: string;
}

interface ReportClaim {
  text: string;
  hasEvidence: boolean;
  hasCitation: boolean;
}

// ============================================================================
// Citation Extraction
// ============================================================================

/**
 * Extracts citations from report content
 * Looks for citation patterns like [1], [citation], or DSM-5 references
 */
function extractCitationsFromReport(report: string): ReportCitation[] {
  const citations: ReportCitation[] = [];
  const seenIds = new Set<string>();

  // Pattern 1: Bracketed citations [id] or [number]
  const bracketPattern = /\[([^\]]+)\]/g;
  let match;
  while ((match = bracketPattern.exec(report)) !== null) {
    const id = match[1].trim();
    if (!seenIds.has(id) && !isCommonMarkdownBracket(id)) {
      seenIds.add(id);
      citations.push({ chunkId: id });
    }
  }

  // Pattern 2: DSM-5 section references
  const dsmPattern =
    /DSM-5(?:\s+TR)?[:\s]+([A-Za-z\s]+(?:Disorder|Criteria|Specifiers))/gi;
  while ((match = dsmPattern.exec(report)) !== null) {
    const section = match[1].trim();
    if (!seenIds.has(section)) {
      seenIds.add(section);
      citations.push({ chunkId: section });
    }
  }

  // Pattern 3: Source/Page references - Source [X], Page YY
  const sourcePattern = /Source\s*\[?(\w+)\]?.*?(?:Page|p\.?)\s*(\d+)/gi;
  while ((match = sourcePattern.exec(report)) !== null) {
    const id = `source-${match[1]}-page-${match[2]}`;
    if (!seenIds.has(id)) {
      seenIds.add(id);
      citations.push({ chunkId: id });
    }
  }

  return citations;
}

/**
 * Checks if a bracket content is likely markdown formatting, not a citation
 */
function isCommonMarkdownBracket(content: string): boolean {
  // Skip common markdown patterns
  const markdownPatterns = [
    /^\d+$/, // Just numbers for lists
    /^x$/i, // Checkbox markers
    /^\s*$/, // Empty or whitespace
    /^http/i, // URLs
    /^link/i, // Link text
  ];

  return markdownPatterns.some((p) => p.test(content));
}

/**
 * Links citations to domains based on report context
 */
function linkCitationsToDomains(
  citations: ReportCitation[],
  report: string,
  flaggedDomains: string[]
): ReportCitation[] {
  return citations.map((citation) => {
    // Find context around the citation
    const citationPattern = new RegExp(
      `.{0,200}${escapeRegex(citation.chunkId)}.{0,200}`,
      "i"
    );
    const contextMatch = report.match(citationPattern);

    if (contextMatch) {
      const context = contextMatch[0].toLowerCase();
      // Check which domain is mentioned in context
      for (const domain of flaggedDomains) {
        if (context.includes(domain.toLowerCase())) {
          return { ...citation, linkedDomain: domain };
        }
      }
    }

    return citation;
  });
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ============================================================================
// Claim Extraction
// ============================================================================

/**
 * Extracts major claims from the report
 * Claims include: impressions, flagged domain follow-ups, recommendations
 */
function extractClaimsFromReport(
  report: string,
  snapshot: Snapshot
): ReportClaim[] {
  const claims: ReportClaim[] = [];

  // Extract impression claims (diagnostic statements)
  const impressionSection = extractSection(report, [
    "Provisional Impressions",
    "Diagnostic Impressions",
    "Impressions",
    "Assessment",
  ]);

  if (impressionSection) {
    const impressionLines = impressionSection
      .split(/\n/)
      .filter((line) => line.trim().length > 10 && !line.startsWith("#"));

    for (const line of impressionLines) {
      claims.push({
        text: line.trim(),
        hasEvidence: hasEvidencePointer(line),
        hasCitation: hasCitationMarker(line),
      });
    }
  }

  // Extract recommendation claims
  const recommendationSection = extractSection(report, [
    "Recommendations",
    "Clinical Recommendations",
    "Follow-up",
    "Next Steps",
  ]);

  if (recommendationSection) {
    const recLines = recommendationSection
      .split(/\n/)
      .filter(
        (line) =>
          (line.trim().startsWith("-") || line.trim().startsWith("*")) &&
          line.length > 15
      );

    for (const line of recLines) {
      claims.push({
        text: line.trim(),
        hasEvidence: hasEvidencePointer(line),
        hasCitation: hasCitationMarker(line),
      });
    }
  }

  // Extract domain threshold statements
  const domainSection = extractSection(report, [
    "Domain Summary",
    "Symptom Domains",
    "Flagged Domains",
  ]);

  if (domainSection) {
    const domainLines = domainSection
      .split(/\n/)
      .filter(
        (line) =>
          line.includes("threshold") ||
          line.includes("follow-up") ||
          line.includes("elevated")
      );

    for (const line of domainLines) {
      claims.push({
        text: line.trim(),
        hasEvidence: hasEvidencePointer(line),
        hasCitation: hasCitationMarker(line),
      });
    }
  }

  // If no structured claims found, use a fallback
  if (claims.length === 0) {
    // Count any statement-like sentences as claims
    const sentences = report
      .split(/[.!?]+/)
      .filter((s) => s.trim().length > 20);

    for (const sentence of sentences.slice(0, 10)) {
      if (
        sentence.includes("recommend") ||
        sentence.includes("suggest") ||
        sentence.includes("indicate") ||
        sentence.includes("elevated") ||
        sentence.includes("threshold")
      ) {
        claims.push({
          text: sentence.trim(),
          hasEvidence: hasEvidencePointer(sentence),
          hasCitation: hasCitationMarker(sentence),
        });
      }
    }
  }

  return claims;
}

/**
 * Extracts a section from the report by header name
 */
function extractSection(report: string, headers: string[]): string | null {
  for (const header of headers) {
    const pattern = new RegExp(
      `##?\\s*${escapeRegex(header)}[\\s\\S]*?(?=##|$)`,
      "i"
    );
    const match = report.match(pattern);
    if (match) {
      return match[0];
    }
  }
  return null;
}

/**
 * Checks if text contains evidence pointers (quotes, patient references)
 */
function hasEvidencePointer(text: string): boolean {
  const evidencePatterns = [
    /<quote>/i,
    /patient\s+(?:said|stated|reported|mentioned)/i,
    /[""][^""]+[""]/,
    /evidence:/i,
    /based on/i,
    /as indicated by/i,
  ];

  return evidencePatterns.some((p) => p.test(text));
}

/**
 * Checks if text contains citation markers
 */
function hasCitationMarker(text: string): boolean {
  const citationPatterns = [
    /\[\d+\]/,
    /\[source/i,
    /DSM-5/i,
    /criterion/i,
    /criteria/i,
    /per\s+DSM/i,
  ];

  return citationPatterns.some((p) => p.test(text));
}

// ============================================================================
// Threshold Detection
// ============================================================================

const DEFAULT_SEVERITY_THRESHOLD = 2; // Score >= 2 is considered flagged

/**
 * Extracts flagged domains from the snapshot
 */
function getFlaggedDomains(snapshot: Snapshot): string[] {
  return snapshot.domainSummary
    .filter((d) => d.severityAggregate >= DEFAULT_SEVERITY_THRESHOLD)
    .map((d) => d.domain);
}

// ============================================================================
// Main RAG Metrics Computation
// ============================================================================

/**
 * Computes RAG evaluation metrics for a snapshot
 *
 * Context Precision: How much of retrieved content was cited
 * Domain Coverage: How many flagged domains have citations
 * Phantom Rate: Citations that weren't in retrieved chunks
 * Grounded Claim Rate: Claims with both evidence and citations
 */
export function computeRagMetrics(snapshot: Snapshot): RagMetrics {
  // If no RAG data, return defaults
  if (!snapshot.rag || snapshot.rag.retrievedChunks.length === 0) {
    return {
      contextPrecision: 0,
      domainCoverageRate: 1.0, // No requirement if no RAG
      phantomRate: 0,
      groundedClaimRate: 1.0, // No requirement if no RAG
    };
  }

  const retrievedChunks = snapshot.rag.retrievedChunks;
  const flaggedDomains = getFlaggedDomains(snapshot);

  // Extract and link citations from report
  let citationsInReport = extractCitationsFromReport(snapshot.report);
  citationsInReport = linkCitationsToDomains(
    citationsInReport,
    snapshot.report,
    flaggedDomains
  );

  // Compute context precision: |cited| / |retrieved|
  const retrievedIds = new Set(retrievedChunks.map((c) => c.chunkId));
  const citedChunkIds = new Set(citationsInReport.map((c) => c.chunkId));

  // Check how many retrieved chunks were cited
  let citedCount = 0;
  for (const id of citedChunkIds) {
    if (retrievedIds.has(id)) {
      citedCount++;
    }
  }

  const contextPrecision =
    retrievedChunks.length > 0 ? citedCount / retrievedChunks.length : 0;

  // Compute domain coverage rate
  let domainCoverageRate = 1.0;
  if (flaggedDomains.length > 0) {
    const domainsWithCitation = flaggedDomains.filter((domain) =>
      citationsInReport.some((c) => c.linkedDomain === domain)
    );
    domainCoverageRate = domainsWithCitation.length / flaggedDomains.length;
  }

  // Compute phantom rate: citations not in retrieved chunks
  let phantomCount = 0;
  for (const citation of citationsInReport) {
    if (!retrievedIds.has(citation.chunkId)) {
      phantomCount++;
    }
  }

  const phantomRate =
    citationsInReport.length > 0 ? phantomCount / citationsInReport.length : 0;

  // Compute grounded claim rate
  const claims = extractClaimsFromReport(snapshot.report, snapshot);
  let groundedCount = 0;

  if (claims.length > 0) {
    for (const claim of claims) {
      if (claim.hasEvidence && claim.hasCitation) {
        groundedCount++;
      }
    }
  }

  const groundedClaimRate =
    claims.length > 0 ? groundedCount / claims.length : 1.0;

  return {
    contextPrecision,
    domainCoverageRate,
    phantomRate,
    groundedClaimRate,
  };
}

/**
 * Computes RAG metrics with safe defaults if errors occur
 */
export function computeRagMetricsSafe(snapshot: Snapshot): RagMetrics {
  try {
    return computeRagMetrics(snapshot);
  } catch (error) {
    console.error("Failed to compute RAG metrics:", error);
    return {
      contextPrecision: 0,
      domainCoverageRate: 0,
      phantomRate: 1.0,
      groundedClaimRate: 0,
    };
  }
}
