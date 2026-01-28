/**
 * DSM-5 Benchmarking Module
 *
 * Provides comprehensive per-chat evaluation of DSM-5 screening interviews
 * including deterministic metrics, text quality metrics, RAG evaluation,
 * LLM judge rubric scoring, and multi-model comparison.
 */

// Deterministic metrics
export {
  computeCoverageMetrics,
  computeDeterministicMetrics,
  computeEvidenceMetrics,
  computeSafetyMetrics,
  evaluatePassFailWarn,
} from "./deterministic";

// Readability metrics
export {
  computeDuplicationRate,
  computeFKG,
  computeFRE,
  computeGFI,
  computeReadabilityMetrics,
  extractInterviewerText,
  extractPatientText,
  extractReportNarrative,
} from "./readability";

// Coherence metrics
export {
  computeCoherenceMetrics,
  computeCoherenceMetricsSafe,
} from "./coherence";

// RAG metrics
export { computeRagMetrics, computeRagMetricsSafe } from "./rag-metrics";

// LLM Judge
export {
  computeOverallScore,
  interpretJudgeScore,
  type PairwiseComparison,
  pairwiseComparisonSchema,
  runLLMJudge,
  runLLMJudgeSafe,
  runPairwiseComparison,
} from "./judge";

// Model comparison
export {
  interpretConfidenceDrift,
  interpretJaccard,
  interpretSpearman,
  runModelComparison,
  runModelComparisonSafe,
} from "./comparison";
