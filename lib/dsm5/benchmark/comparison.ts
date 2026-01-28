import "server-only";

import { generateObject } from "ai";
import { getLanguageModel } from "@/lib/ai/providers";
import {
  type ImpressionItem,
  type ModelComparison,
  type Snapshot,
} from "../benchmark-schemas";
import { getDiagnosticPrompt } from "../prompts";
import { type DsmCitation, RAG_CONFIG } from "../rag-config";
import {
  buildRetrievalQuery,
  isRagAvailable,
  retrieveCitationsForDomains,
  retrieveDsmPassages,
} from "../retriever";
import {
  type DiagnosticMode,
  llmDiagnoseOutputSchema,
  type RagMode,
  type RiskFlags,
  type TranscriptEntry,
} from "../schemas";
import { DOMAIN_THRESHOLDS, evaluateDomainThreshold } from "../thresholds";

// ============================================================================
// Types
// ============================================================================

interface DiagnoseReplayResult {
  modelId: string;
  impressions: ImpressionItem[];
  overallSummary: string;
  groundedClaimRate: number;
  ragUsed: boolean;
  citations: DsmCitation[];
}

// ============================================================================
// Diagnosis Replay
// ============================================================================

/**
 * Runs a diagnose replay for a specific model using the frozen snapshot
 * This allows fair comparison by keeping all inputs identical
 */
async function runDiagnoseReplay(
  snapshot: Snapshot,
  modelId: string,
  ragMode: RagMode = "off",
  diagnosticMode: DiagnosticMode = "diagnostic"
): Promise<DiagnoseReplayResult> {
  // Build domain summaries from snapshot
  const itemScoreMap = new Map(
    snapshot.itemResponses.map((r) => [r.itemId, r.score as number])
  );

  const domainSummaries = DOMAIN_THRESHOLDS.map((config) => {
    const result = evaluateDomainThreshold(config, itemScoreMap);
    const evidenceQuotes = snapshot.itemResponses
      .filter((r) => config.itemIds.includes(r.itemId) && r.evidenceQuotes.length > 0)
      .flatMap((r) => r.evidenceQuotes.slice(0, 1));

    return {
      domain: config.domain,
      itemIds: config.itemIds,
      threshold: config.threshold,
      ...result,
      itemScores: result.scores, // Map scores to itemScores for compatibility
      evidenceQuotes,
      clinicalNote: result.meetsThreshold
        ? config.clinicalNote
        : `${config.domain} domain within normal range.`,
    };
  });

  // Build transcript summary
  const transcript = snapshot.transcript as TranscriptEntry[];
  const transcriptSummary = buildTranscriptSummary(transcript);

  // Get risk flags
  const riskFlags = snapshot.riskFlags as RiskFlags;

  // Retrieve DSM citations if RAG mode is enabled
  const ragCitations: DsmCitation[] = [];
  let ragUsed = false;

  if (ragMode !== "off" && snapshot.rag) {
    // Use cached RAG data from snapshot
    ragUsed = true;
    for (const chunk of snapshot.rag.retrievedChunks) {
      ragCitations.push({
        id: chunk.chunkId,
        sectionPath: chunk.sectionPath,
        page: chunk.page,
        snippet: chunk.content.slice(0, 200),
        fullContent: chunk.content,
        relevance: chunk.similarity,
      });
    }
  } else if (ragMode !== "off") {
    // Attempt live retrieval if no cached data
    const ragAvailable = await isRagAvailable();
    if (ragAvailable) {
      ragUsed = true;
      const flaggedDomainNames = domainSummaries
        .filter((d) => d.meetsThreshold)
        .map((d) => d.domain);

      if (flaggedDomainNames.length > 0) {
        const domainCitations = await retrieveCitationsForDomains(
          flaggedDomainNames,
          RAG_CONFIG.citationsMinSimilarity
        );

        const seenIds = new Set<string>();
        for (const [, citations] of domainCitations) {
          for (const citation of citations) {
            if (!seenIds.has(citation.id)) {
              seenIds.add(citation.id);
              ragCitations.push(citation);
            }
          }
        }
      }
    }
  }

  // Build citations context
  const citationsContext =
    ragUsed && ragCitations.length > 0
      ? `\n\nDSM-5 Reference Material:\n${ragCitations
          .map(
            (c, i) =>
              `[${i + 1}] ${c.sectionPath ?? "DSM-5"}: ${c.snippet}`
          )
          .join("\n")}`
      : "";

  // Run LLM diagnosis
  const model = getLanguageModel(modelId);
  const basePrompt = getDiagnosticPrompt({
    mode: diagnosticMode as "screening" | "categorical" | "diagnostic",
    domainSummaries: domainSummaries.map((d) => ({
      domain: d.domain,
      severity: d.severity,
      itemScores: d.itemScores,
      evidenceQuotes: d.evidenceQuotes,
      threshold: d.threshold,
      meetsThreshold: d.meetsThreshold,
      clinicalNote: d.clinicalNote,
    })),
    riskFlags,
    transcriptSummary,
  });

  const fullPrompt = ragUsed
    ? `${basePrompt}${citationsContext}\n\nWhen providing analysis, reference the DSM-5 material above where relevant.`
    : basePrompt;

  const { object } = await generateObject({
    model,
    schema: llmDiagnoseOutputSchema,
    prompt: fullPrompt,
  });

  // Convert to impressions format
  const impressions: ImpressionItem[] = object.impressions.map((imp) => ({
    label: imp.label,
    confidence: imp.confidence,
  }));

  // Calculate grounded claim rate (simplified)
  let groundedClaimRate = 1.0;
  if (impressions.length > 0) {
    // Check if impressions have evidence and citations
    const groundedCount = object.impressions.filter(
      (imp) => imp.keyEvidence.length > 0 && imp.reasoning.length > 0
    ).length;
    groundedClaimRate = groundedCount / impressions.length;
  }

  return {
    modelId,
    impressions,
    overallSummary: object.overallSummary,
    groundedClaimRate,
    ragUsed,
    citations: ragCitations,
  };
}

/**
 * Builds a transcript summary for the diagnostic prompt
 */
function buildTranscriptSummary(transcript: TranscriptEntry[]): string {
  if (transcript.length === 0) {
    return "No transcript available.";
  }

  const recentExchanges = transcript.slice(-20);
  return recentExchanges
    .map((t) => `${t.role === "patient" ? "Patient" : "Interviewer"}: ${t.text}`)
    .join("\n");
}

// ============================================================================
// Comparison Metrics
// ============================================================================

/**
 * Computes Jaccard similarity between two sets of impressions
 * Jaccard = |A ∩ B| / |A ∪ B|
 */
function computeJaccard(
  impressionsA: ImpressionItem[],
  impressionsB: ImpressionItem[],
  topK: number = 5
): number {
  const topA = new Set(impressionsA.slice(0, topK).map((i) => i.label));
  const topB = new Set(impressionsB.slice(0, topK).map((i) => i.label));

  if (topA.size === 0 && topB.size === 0) {
    return 1.0; // Both empty = perfect agreement
  }

  const intersection = [...topA].filter((x) => topB.has(x)).length;
  const union = new Set([...topA, ...topB]).size;

  return union > 0 ? intersection / union : 0;
}

/**
 * Computes Spearman rank correlation between two sets of impressions
 * ρ = 1 - (6 * Σ d_i²) / (n * (n² - 1))
 * where d_i is the difference in ranks for shared labels
 */
function computeSpearman(
  impressionsA: ImpressionItem[],
  impressionsB: ImpressionItem[]
): number {
  // Find shared labels
  const labelsA = impressionsA.map((i) => i.label);
  const labelsB = impressionsB.map((i) => i.label);
  const sharedLabels = labelsA.filter((label) => labelsB.includes(label));

  if (sharedLabels.length < 2) {
    return 0; // Not enough shared labels for correlation
  }

  const n = sharedLabels.length;
  let sumD2 = 0;

  for (const label of sharedLabels) {
    const rankA = labelsA.indexOf(label);
    const rankB = labelsB.indexOf(label);
    sumD2 += (rankA - rankB) ** 2;
  }

  return 1 - (6 * sumD2) / (n * (n ** 2 - 1));
}

/**
 * Computes confidence drift between two sets of impressions
 * Mean absolute difference in confidence for shared labels
 */
function computeConfidenceDrift(
  impressionsA: ImpressionItem[],
  impressionsB: ImpressionItem[]
): number {
  const mapA = new Map(impressionsA.map((i) => [i.label, i.confidence]));
  const mapB = new Map(impressionsB.map((i) => [i.label, i.confidence]));

  // Find shared labels
  const sharedLabels = [...mapA.keys()].filter((label) => mapB.has(label));

  if (sharedLabels.length === 0) {
    return 1.0; // Maximum drift if no overlap
  }

  let sumDiff = 0;
  for (const label of sharedLabels) {
    const confA = mapA.get(label) ?? 0;
    const confB = mapB.get(label) ?? 0;
    sumDiff += Math.abs(confA - confB);
  }

  return sumDiff / sharedLabels.length;
}

// ============================================================================
// Main Comparison Entry Point
// ============================================================================

/**
 * Runs model comparison by replaying diagnosis with multiple models
 * Returns comparison metrics for each model vs the driver model
 */
export async function runModelComparison(
  snapshot: Snapshot,
  driverModel: string,
  compareModels: string[],
  ragMode: RagMode = "off",
  diagnosticMode: DiagnosticMode = "diagnostic"
): Promise<ModelComparison[]> {
  const allModels = [driverModel, ...compareModels];

  // Run diagnosis replay for each model in parallel
  const results = await Promise.all(
    allModels.map((model) =>
      runDiagnoseReplay(snapshot, model, ragMode, diagnosticMode)
    )
  );

  const driverResult = results[0];

  // Build comparison results
  return results.map((result, i) => {
    const isDriver = i === 0;

    return {
      modelId: result.modelId,
      impressions: result.impressions,
      // Only compute comparison metrics for non-driver models
      jaccard: isDriver
        ? undefined
        : computeJaccard(driverResult.impressions, result.impressions),
      spearmanRho: isDriver
        ? undefined
        : computeSpearman(driverResult.impressions, result.impressions),
      confidenceDrift: isDriver
        ? undefined
        : computeConfidenceDrift(driverResult.impressions, result.impressions),
      groundedClaimRate: result.groundedClaimRate,
    };
  });
}

/**
 * Runs model comparison with error handling
 * Returns empty array on failure
 */
export async function runModelComparisonSafe(
  snapshot: Snapshot,
  driverModel: string,
  compareModels: string[],
  ragMode: RagMode = "off",
  diagnosticMode: DiagnosticMode = "diagnostic"
): Promise<ModelComparison[]> {
  try {
    return await runModelComparison(
      snapshot,
      driverModel,
      compareModels,
      ragMode,
      diagnosticMode
    );
  } catch (error) {
    console.error("Model comparison failed:", error);
    return [];
  }
}

// ============================================================================
// Comparison Utilities
// ============================================================================

/**
 * Interprets Jaccard similarity score
 */
export function interpretJaccard(score: number): {
  level: "high" | "moderate" | "low";
  description: string;
} {
  if (score >= 0.7) {
    return {
      level: "high",
      description: "Models agree on most diagnoses",
    };
  }
  if (score >= 0.4) {
    return {
      level: "moderate",
      description: "Models have partial agreement",
    };
  }
  return {
    level: "low",
    description: "Models disagree significantly",
  };
}

/**
 * Interprets Spearman rank correlation
 */
export function interpretSpearman(rho: number): {
  level: "strong" | "moderate" | "weak" | "negative";
  description: string;
} {
  if (rho >= 0.7) {
    return {
      level: "strong",
      description: "Strong agreement on diagnosis ranking",
    };
  }
  if (rho >= 0.4) {
    return {
      level: "moderate",
      description: "Moderate agreement on ranking",
    };
  }
  if (rho >= 0) {
    return {
      level: "weak",
      description: "Weak agreement on ranking",
    };
  }
  return {
    level: "negative",
    description: "Models rank diagnoses differently",
  };
}

/**
 * Interprets confidence drift
 */
export function interpretConfidenceDrift(drift: number): {
  level: "stable" | "moderate" | "high";
  description: string;
} {
  if (drift <= 0.1) {
    return {
      level: "stable",
      description: "Models have consistent confidence levels",
    };
  }
  if (drift <= 0.3) {
    return {
      level: "moderate",
      description: "Some variation in confidence levels",
    };
  }
  return {
    level: "high",
    description: "Significant difference in confidence levels",
  };
}
