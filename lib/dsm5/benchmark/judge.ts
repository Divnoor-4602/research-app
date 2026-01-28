import "server-only";

import { generateObject } from "ai";
import { z } from "zod";
import { getLanguageModel } from "@/lib/ai/providers";
import type { JudgeResult, Snapshot } from "../benchmark-schemas";
import { judgeResultSchema } from "../benchmark-schemas";

// ============================================================================
// Configuration
// ============================================================================

/**
 * Fixed judge model for consistent evaluation
 * Using GPT-4.1 as specified in the PRD
 */
const JUDGE_MODEL = "openai/gpt-4.1";

/**
 * Temperature 0 for deterministic outputs
 */
const JUDGE_TEMPERATURE = 0;

// ============================================================================
// Prompt Building
// ============================================================================

/**
 * Formats transcript for the judge prompt
 */
function formatTranscript(
  transcript: Array<{ role: string; text: string }>
): string {
  return transcript
    .map((entry) => {
      const role = entry.role === "interviewer" ? "Interviewer" : "Patient";
      return `${role}: ${entry.text}`;
    })
    .join("\n\n");
}

/**
 * Formats item scores summary for the judge prompt
 */
function formatItemScores(
  itemResponses: Array<{
    itemId: string;
    score: number;
    ambiguity: number;
    evidenceQuotes: string[];
  }>
): string {
  if (itemResponses.length === 0) {
    return "No item scores available.";
  }

  return itemResponses
    .map((r) => {
      const evidence =
        r.evidenceQuotes.length > 0
          ? `Evidence: "${r.evidenceQuotes[0]}"`
          : "No evidence";
      return `- ${r.itemId}: Score ${r.score}/4, Ambiguity ${r.ambiguity}/10. ${evidence}`;
    })
    .join("\n");
}

/**
 * Formats domain summary for the judge prompt
 */
function formatDomainSummary(
  domainSummary: Array<{
    domain: string;
    severityAggregate: number;
    notableSymptoms: string[];
  }>
): string {
  if (domainSummary.length === 0) {
    return "No domain summary available.";
  }

  return domainSummary
    .map((d) => {
      const symptoms =
        d.notableSymptoms.length > 0
          ? d.notableSymptoms.join(", ")
          : "None noted";
      return `- ${d.domain}: Severity ${d.severityAggregate}. Symptoms: ${symptoms}`;
    })
    .join("\n");
}

/**
 * Builds the complete judge prompt
 */
function buildJudgePrompt(snapshot: Snapshot): string {
  const transcript = formatTranscript(snapshot.transcript);
  const itemScores = formatItemScores(
    snapshot.itemResponses.map((r) => ({
      itemId: r.itemId,
      score: typeof r.score === "number" ? r.score : 0,
      ambiguity: r.ambiguity,
      evidenceQuotes: r.evidenceQuotes,
    }))
  );
  const domainSummary = formatDomainSummary(snapshot.domainSummary);

  return `You are an expert evaluator of mental health screening conversations.

Your task is to evaluate the quality of a DSM-5 Level-1 Cross-Cutting Symptom Measure screening interview and its resulting diagnostic report.

## Conversation Transcript

${transcript}

## Item Scores Summary (23 DSM-5 Level-1 Items)

${itemScores}

## Domain Summary

${domainSummary}

## Diagnostic Report

${snapshot.report}

## Evaluation Instructions

Score each criterion from 1 (poor) to 5 (excellent):

1) **DSM-5 Coverage Completeness** (coverage)
   - Were all 23 Level-1 items addressed?
   - Were questions appropriate for each domain?
   - Was the pacing appropriate?

2) **Clinical Relevance** (relevance)
   - Were questions appropriate and non-leading?
   - Did questions align with DSM-5 Level-1 intent?
   - Were follow-ups clinically appropriate?

3) **Logical Flow and Coherence** (flow)
   - Was the conversation natural and well-structured?
   - Were transitions between topics smooth?
   - Did the conversation maintain focus?

4) **Diagnostic Justification and Explainability** (explainability)
   - Are conclusions well-supported by evidence?
   - Are citations and reasoning clear?
   - Is the diagnostic reasoning transparent?

5) **Empathy and Professionalism** (empathy)
   - Was the tone supportive and appropriate?
   - Was language accessible to patients?
   - Was professionalism maintained throughout?

## Rules

- Base scores ONLY on the provided content
- Do not introduce external medical knowledge
- Provide brief, specific justifications
- Identify concrete examples of strengths and issues
- Focus on actionable feedback

## Output

Provide your evaluation with:
- Scores (1-5) for each criterion
- Overall score (average of criteria)
- Top 3 strengths with brief explanations
- Top 3 issues with brief explanations
- Recommended fixes (actionable suggestions)
- Hallucination flags (any unsupported claims in the report)
- Overclaim flags (conclusions that exceed the evidence)

Return your evaluation as structured JSON.`;
}

// ============================================================================
// Judge Execution
// ============================================================================

/**
 * Runs the LLM judge on a snapshot
 * Returns structured rubric scores and feedback
 */
export async function runLLMJudge(snapshot: Snapshot): Promise<JudgeResult> {
  const prompt = buildJudgePrompt(snapshot);

  const { object } = await generateObject({
    model: getLanguageModel(JUDGE_MODEL),
    schema: judgeResultSchema,
    prompt,
    temperature: JUDGE_TEMPERATURE,
  });

  return object;
}

/**
 * Runs the LLM judge with error handling
 * Returns null on failure instead of throwing
 */
export async function runLLMJudgeSafe(
  snapshot: Snapshot
): Promise<JudgeResult | null> {
  try {
    return await runLLMJudge(snapshot);
  } catch (error) {
    console.error("LLM Judge failed:", error);
    return null;
  }
}

// ============================================================================
// Judge Utilities
// ============================================================================

/**
 * Computes the overall score from rubric scores
 */
export function computeOverallScore(scores: {
  coverage: number;
  relevance: number;
  flow: number;
  explainability: number;
  empathy: number;
}): number {
  const values = [
    scores.coverage,
    scores.relevance,
    scores.flow,
    scores.explainability,
    scores.empathy,
  ];

  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Interprets the overall judge score
 */
export function interpretJudgeScore(overallScore: number): {
  grade: "excellent" | "good" | "acceptable" | "needs_improvement" | "poor";
  description: string;
} {
  if (overallScore >= 4.5) {
    return {
      grade: "excellent",
      description: "Exceptional quality across all criteria",
    };
  }
  if (overallScore >= 3.5) {
    return {
      grade: "good",
      description: "Good quality with minor areas for improvement",
    };
  }
  if (overallScore >= 2.5) {
    return {
      grade: "acceptable",
      description: "Acceptable quality but requires attention to flagged issues",
    };
  }
  if (overallScore >= 1.5) {
    return {
      grade: "needs_improvement",
      description: "Significant issues that need to be addressed",
    };
  }
  return {
    grade: "poor",
    description: "Major problems across multiple criteria",
  };
}

// ============================================================================
// Pairwise Comparison (for multi-model benchmarking)
// ============================================================================

/**
 * Schema for pairwise comparison results
 */
export const pairwiseComparisonSchema = z.object({
  preferredModel: z.enum(["A", "B", "tie"]),
  reasoning: z.string(),
  betterOnCriteria: z.object({
    coverage: z.enum(["A", "B", "tie"]),
    relevance: z.enum(["A", "B", "tie"]),
    flow: z.enum(["A", "B", "tie"]),
    explainability: z.enum(["A", "B", "tie"]),
    empathy: z.enum(["A", "B", "tie"]),
  }),
  majorDisagreements: z.array(z.string()),
});

export type PairwiseComparison = z.infer<typeof pairwiseComparisonSchema>;

/**
 * Builds a prompt for pairwise comparison of two model outputs
 * Model names are blinded (A vs B) to reduce bias
 */
function buildPairwisePrompt(
  snapshot: Snapshot,
  reportA: string,
  reportB: string
): string {
  const transcript = formatTranscript(snapshot.transcript);

  return `You are an expert evaluator comparing two diagnostic reports for the same DSM-5 screening interview.

## Conversation Transcript

${transcript}

## Report A

${reportA}

## Report B

${reportB}

## Evaluation Instructions

Compare the two reports on each criterion:
1) DSM-5 coverage completeness
2) Clinical relevance
3) Logical flow and coherence
4) Diagnostic justification and explainability
5) Empathy and professionalism

## Rules

- Base comparison ONLY on the provided content
- Model names are hidden to ensure unbiased evaluation
- Focus on which report better serves clinical utility
- Identify specific differences and their implications

## Output

Indicate which model is better (A, B, or tie) for each criterion and overall.
List any major disagreements between the reports.

Return your comparison as structured JSON.`;
}

/**
 * Runs pairwise comparison between two model outputs
 */
export async function runPairwiseComparison(
  snapshot: Snapshot,
  reportA: string,
  reportB: string
): Promise<PairwiseComparison> {
  const prompt = buildPairwisePrompt(snapshot, reportA, reportB);

  const { object } = await generateObject({
    model: getLanguageModel(JUDGE_MODEL),
    schema: pairwiseComparisonSchema,
    prompt,
    temperature: JUDGE_TEMPERATURE,
  });

  return object;
}
