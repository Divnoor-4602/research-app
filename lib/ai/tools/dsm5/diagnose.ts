import { generateObject, tool } from "ai";
import type { z } from "zod";
import { getLanguageModel } from "@/lib/ai/providers";
import {
  getDsmSessionByChatId,
  getItemResponsesBySessionId,
  updateDsmSession,
} from "@/lib/db/queries";
import { getDiagnosticPrompt } from "@/lib/dsm5/prompts";
import { type DsmCitation, RAG_CONFIG } from "@/lib/dsm5/rag-config";
import {
  buildRetrievalQuery,
  isRagAvailable,
  retrieveCitationsForDomains,
  retrieveDsmPassages,
} from "@/lib/dsm5/retriever";
import {
  type DiagnoseOutput,
  type DiagnosticMode,
  diagnoseInputSchema,
  llmDiagnoseOutputSchema,
  type QuestionState,
  type RagMode,
  type RiskFlags,
  type TranscriptEntry,
} from "@/lib/dsm5/schemas";
import {
  DOMAIN_THRESHOLDS,
  type DomainThresholdConfig,
  evaluateDomainThreshold,
} from "@/lib/dsm5/thresholds";

// ============================================================================
// Types
// ============================================================================

type DiagnoseProps = {
  chatId: string;
  modelId?: string;
  ragMode?: RagMode;
};

type RunDiagnosisParams = {
  chatId: string;
  modelId?: string;
  ragMode: RagMode;
  diagnosticMode: DiagnosticMode;
  /** If true, skip session state validation (for report generation) */
  skipStateValidation?: boolean;
  /** If true, don't update session state to DONE */
  skipSessionUpdate?: boolean;
};

type RunDiagnosisResult =
  | { success: true } & DiagnoseOutput
  | { success: false; error: string };

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Compute risk level DETERMINISTICALLY based on safety flags only.
 * This prevents arbitrary "moderate" risk when no safety concerns exist.
 * 
 * Rules:
 * - suicidalityMentioned or selfHarmIdeation → critical
 * - violenceRisk → high
 * - Otherwise → low (no "moderate" unless safety flags present)
 */
function computeRiskLevel(riskFlags: RiskFlags): "low" | "high" | "critical" {
  if (riskFlags.suicidalityMentioned || riskFlags.selfHarmIdeation) {
    return "critical";
  }
  if (riskFlags.violenceRisk) {
    return "high";
  }
  return "low";
}

/**
 * Build a transcript summary for the diagnostic prompt
 */
function buildTranscriptSummary(transcript: TranscriptEntry[]): string {
  if (transcript.length === 0) {
    return "No transcript available.";
  }

  // Get last 10 exchanges for context
  const recentExchanges = transcript.slice(-20);
  return recentExchanges
    .map(
      (t) => `${t.role === "patient" ? "Patient" : "Interviewer"}: ${t.text}`
    )
    .join("\n");
}

/**
 * Collect evidence quotes for a domain from item responses
 */
function collectDomainEvidence(
  config: DomainThresholdConfig,
  itemResponses: Map<string, { score: number; evidenceQuotes: string[] }>
): string[] {
  const quotes: string[] = [];
  for (const itemId of config.itemIds) {
    const response = itemResponses.get(itemId);
    if (response?.evidenceQuotes) {
      quotes.push(...response.evidenceQuotes);
    }
  }
  return quotes.slice(0, 5); // Max 5 quotes per domain
}

// ============================================================================
// Core Diagnosis Function (Single Source of Truth)
// ============================================================================

/**
 * Run diagnostic analysis - the single source of truth for all diagnosis logic.
 * 
 * This function can be called:
 * 1. By the diagnose tool (during chat)
 * 2. By the report generation API (for RAG-enriched reports)
 * 
 * @param params - Diagnosis parameters
 * @returns DiagnoseOutput with success flag
 */
export async function runDiagnosis(
  params: RunDiagnosisParams
): Promise<RunDiagnosisResult> {
  const {
    chatId,
    modelId,
    ragMode,
    diagnosticMode,
    skipStateValidation = false,
    skipSessionUpdate = false,
  } = params;

  // 1. Get session
  const session = await getDsmSessionByChatId({ chatId });
  if (!session) {
    return {
      success: false,
      error: "No DSM-5 session found for this chat",
    };
  }

  // 2. Check session state - should be in REPORT or later (unless skipped)
  const questionState = session.questionState as QuestionState;
  if (!skipStateValidation) {
    if (
      questionState.currentState !== "REPORT" &&
      questionState.currentState !== "DONE"
    ) {
      return {
        success: false,
        error: `Interview not complete. Current state: ${questionState.currentState}`,
      };
    }
  }

  // 3. Get all item responses
  const itemResponsesRaw = await getItemResponsesBySessionId({
    sessionId: session.id,
  });

  // Build a map of item responses
  const itemResponses = new Map<
    string,
    { score: number; evidenceQuotes: string[] }
  >();
  const itemScores = new Map<string, number>();

  for (const response of itemResponsesRaw) {
    itemResponses.set(response.itemId, {
      score: response.score,
      evidenceQuotes: (response.evidenceQuotes as string[]) ?? [],
    });
    itemScores.set(response.itemId, response.score);
  }

  // 4. Evaluate all domains against thresholds
  const domainSummaries = DOMAIN_THRESHOLDS.map((config) => {
    const result = evaluateDomainThreshold(config, itemScores);
    const evidence = collectDomainEvidence(config, itemResponses);

    return {
      domain: config.domain,
      severity: result.severity,
      itemScores: result.scores,
      evidenceQuotes: evidence,
      threshold: config.threshold,
      meetsThreshold: result.meetsThreshold,
      clinicalNote: config.clinicalNote,
    };
  });

  // 5. Get risk flags
  const riskFlags = session.riskFlags as RiskFlags;

  // 6. Build transcript summary
  const transcript = (session.transcript as TranscriptEntry[]) ?? [];
  const transcriptSummary = buildTranscriptSummary(transcript);

  // 6.5 Retrieve DSM citations if RAG mode is enabled
  const ragCitations: DsmCitation[] = [];
  let ragUsed = false;

  if (ragMode !== "off") {
    // Check if RAG data is available
    const ragAvailable = await isRagAvailable();

    if (ragAvailable) {
      ragUsed = true;

      // Use different thresholds based on RAG mode
      // Grounded mode: stricter threshold (0.75), more retrieval to filter
      // Citations mode: lower threshold (0.65)
      const minSimilarity =
        ragMode === "grounded"
          ? RAG_CONFIG.groundedMinSimilarity
          : RAG_CONFIG.citationsMinSimilarity;
      const topK =
        ragMode === "grounded"
          ? RAG_CONFIG.groundedTopK
          : RAG_CONFIG.citationsTopK;

      // Get flagged domains for targeted retrieval
      const flaggedDomainNames = domainSummaries
        .filter((d) => d.meetsThreshold)
        .map((d) => d.domain);

      if (flaggedDomainNames.length > 0) {
        // Retrieve domain-aligned citations using specific DSM queries per domain
        const domainCitations = await retrieveCitationsForDomains(
          flaggedDomainNames,
          minSimilarity
        );

        // Flatten and deduplicate citations, preserving linkedDomain
        const seenIds = new Set<string>();
        for (const [, citations] of domainCitations) {
          for (const citation of citations) {
            // Only include citations that meet the mode-specific threshold
            if (!seenIds.has(citation.id) && citation.relevance >= minSimilarity) {
              seenIds.add(citation.id);
              ragCitations.push(citation);
            }
          }
        }
      }

      // Also do a general retrieval based on symptom summary (if we need more)
      if (ragCitations.length < topK) {
        const generalQuery = buildRetrievalQuery(
          domainSummaries.map((d) => ({
            domain: d.domain,
            severity: d.severity,
            score: d.itemScores.reduce((sum, s) => sum + s.score, 0),
          }))
        );
        const generalCitations = await retrieveDsmPassages(
          generalQuery,
          topK - ragCitations.length,
          minSimilarity
        );

        const seenIds = new Set(ragCitations.map((c) => c.id));
        for (const citation of generalCitations) {
          if (!seenIds.has(citation.id) && citation.relevance >= minSimilarity) {
            ragCitations.push(citation);
          }
        }
      }
    }
  }

  // Build citations context for LLM prompt if RAG is active
  const citationsContext =
    ragUsed && ragCitations.length > 0
      ? `\n\nDSM-5 Reference Material:\n${ragCitations.map((c, i) => `[${i + 1}] ${c.sectionPath ?? "DSM-5"}${c.linkedDomain ? ` (${c.linkedDomain})` : ""}: ${c.snippet}`).join("\n")}`
      : "";

  // 7. Call LLM for diagnostic analysis
  const model = getLanguageModel(modelId ?? "openai/gpt-4o-mini");

  let analysisResult: z.infer<typeof llmDiagnoseOutputSchema>;

  try {
    const basePrompt = getDiagnosticPrompt({
      mode: diagnosticMode as "screening" | "categorical" | "diagnostic",
      domainSummaries,
      riskFlags,
      transcriptSummary,
    });

    // Build prompt suffix based on RAG mode
    let ragPromptSuffix = "";
    if (ragMode === "grounded" && ragUsed) {
      // GROUNDED MODE: Strict requirements - must cite both patient quote AND DSM criterion
      ragPromptSuffix = `${citationsContext}

GROUNDED MODE - STRICT REQUIREMENTS:
1. Every claim MUST cite BOTH:
   - (a) Patient quote: <quote>"exact words from patient"</quote>
   - (b) DSM-5 criterion: [Criterion X: description] with reference number from above
2. Format observations as: "Patient reports <quote>...</quote>, consistent with Criterion A [Ref 1]"
3. If no DSM anchor is available for a domain, state: "Insufficient DSM-5 grounding for this domain"
4. Prioritize accuracy over coverage - omit claims that cannot be grounded in BOTH patient evidence AND DSM criteria
5. Each flagged domain should have at least one grounded observation where possible`;
    } else if (ragUsed) {
      // CITATIONS MODE: Include DSM references where relevant
      ragPromptSuffix = `${citationsContext}

When providing analysis, reference the DSM-5 material above where relevant to support your findings.`;
    }

    const fullPrompt = `${basePrompt}${ragPromptSuffix}`;

    const { object } = await generateObject({
      model,
      schema: llmDiagnoseOutputSchema,
      prompt: fullPrompt,
    });
    analysisResult = object;
  } catch (error) {
    console.error("Diagnostic analysis LLM error:", error);
    return {
      success: false,
      error: "Failed to generate diagnostic analysis",
    };
  }

  // 8. Build the final output
  const flaggedDomains = domainSummaries.filter((d) => d.meetsThreshold);

  // DETERMINISTIC risk level - based ONLY on safety flags, not domain count or LLM
  // This prevents arbitrary "moderate" risk when no safety concerns exist
  const finalRisk: "low" | "high" | "critical" = computeRiskLevel(riskFlags);

  // Build impressions based on mode
  const impressions =
    diagnosticMode === "screening"
      ? []
      : analysisResult.impressions.map((imp) => ({
          label: imp.label,
          confidence: imp.confidence,
          reasoning: imp.reasoning,
          supportingDomains: imp.supportingDomains,
          evidenceQuotes: imp.keyEvidence,
        }));

  // Build domain flags output
  const domains = domainSummaries.map((d) => ({
    domain: d.domain,
    severity: d.severity as
      | "none"
      | "mild"
      | "moderate"
      | "elevated"
      | "severe",
    itemScores: d.itemScores,
    evidenceQuotes: d.evidenceQuotes,
    threshold: d.threshold,
    meetsThreshold: d.meetsThreshold,
    clinicalNote: d.clinicalNote,
  }));

  // Format citations for output
  const formattedCitations = ragCitations.map((c) => ({
    id: c.id,
    sectionPath: c.sectionPath,
    page: c.page,
    snippet: c.snippet,
    relevance: c.relevance,
  }));

  const output: DiagnoseOutput = {
    mode: diagnosticMode,
    domains,
    impressions,
    overallSummary: analysisResult.overallSummary,
    riskLevel: finalRisk,
    limitations: [
      "This is a screening tool, not a diagnostic instrument",
      "Results should be validated by a qualified mental health professional",
      "Does not account for medical conditions that may cause similar symptoms",
      ...analysisResult.limitations,
    ],
    recommendations: [
      ...flaggedDomains.map((d) => d.clinicalNote),
      ...analysisResult.recommendations,
    ],
    ragUsed,
    citations: formattedCitations,
  };

  // 9. Update session state to DONE (unless skipped)
  if (!skipSessionUpdate) {
    const updatedQuestionState: QuestionState = {
      ...questionState,
      currentState: "DONE",
    };

    await updateDsmSession({
      chatId,
      patch: {
        questionState: updatedQuestionState,
        sessionStatus: "completed",
      },
    });
  }

  return {
    success: true,
    ...output,
  };
}

// ============================================================================
// Tool Definition (Wraps runDiagnosis)
// ============================================================================

/**
 * Tool to generate diagnostic analysis from completed DSM-5 screening.
 * This tool wraps the runDiagnosis function for use in the AI chat.
 */
export const diagnose = ({
  chatId,
  modelId,
  ragMode: defaultRagMode = "off",
}: DiagnoseProps) =>
  tool({
    description:
      "Generate diagnostic analysis from a completed DSM-5 Level-1 screening. " +
      "Analyzes all item responses and produces screening flags, provisional impressions (based on mode), " +
      "and clinical recommendations. Should be called when the interview is complete.",
    inputSchema: diagnoseInputSchema,
    execute: async ({
      diagnosticMode = "screening",
      ragMode = defaultRagMode,
    }) => {
      return runDiagnosis({
        chatId,
        modelId,
        ragMode,
        diagnosticMode,
      });
    },
  });
