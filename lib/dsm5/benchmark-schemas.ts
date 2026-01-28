import { z } from "zod";
import {
  diagnosticModeSchema,
  itemResponseSchema,
  ragModeSchema,
  riskFlagsSchema,
  sessionStatusSchema,
  symptomDomainSchema,
  transcriptEntrySchema,
} from "./schemas";

// ============================================================================
// Retrieved Chunk (for RAG tracking)
// ============================================================================

export const retrievedChunkSchema = z.object({
  chunkId: z.string(),
  content: z.string(),
  page: z.number().nullable(),
  sectionPath: z.string().nullable(),
  similarity: z.number(),
});
export type RetrievedChunk = z.infer<typeof retrievedChunkSchema>;

// ============================================================================
// Snapshot Schema - Frozen evaluation unit
// ============================================================================

export const snapshotVersionsSchema = z.object({
  promptVersion: z.string(),
  toolVersion: z.string(),
  schemaVersion: z.string(),
});
export type SnapshotVersions = z.infer<typeof snapshotVersionsSchema>;

export const snapshotModelsSchema = z.object({
  interviewerModel: z.string(),
  scorerModel: z.string(),
  diagnoserModel: z.string(),
});
export type SnapshotModels = z.infer<typeof snapshotModelsSchema>;

export const snapshotRagSchema = z.object({
  ragMode: ragModeSchema,
  retrievedChunks: z.array(retrievedChunkSchema),
});
export type SnapshotRag = z.infer<typeof snapshotRagSchema>;

export const snapshotSchema = z.object({
  snapshotId: z.string().uuid(),
  chatId: z.string().uuid(),
  hash: z.string(), // SHA256 of canonical JSON
  transcript: z.array(transcriptEntrySchema),
  itemResponses: z.array(itemResponseSchema),
  domainSummary: z.array(symptomDomainSchema),
  riskFlags: riskFlagsSchema,
  sessionStatus: sessionStatusSchema,
  report: z.string(), // streamdown content
  rag: snapshotRagSchema.optional(),
  versions: snapshotVersionsSchema,
  models: snapshotModelsSchema,
  createdAt: z.string(),
});
export type Snapshot = z.infer<typeof snapshotSchema>;

// ============================================================================
// Coverage Metrics
// ============================================================================

export const coverageMetricsSchema = z.object({
  rate: z.number(), // |completed| / 23
  completedItems: z.array(z.string()),
  missingItems: z.array(z.string()),
  followupViolations: z.number(),
  repeatViolations: z.number(),
  multiQuestionTurns: z.number(),
});
export type CoverageMetrics = z.infer<typeof coverageMetricsSchema>;

// ============================================================================
// Evidence Metrics
// ============================================================================

export const evidenceMetricsSchema = z.object({
  presentRate: z.number(),
  validRate: z.number(),
  leakCount: z.number(),
  missingLowAmbiguity: z.number(),
});
export type EvidenceMetrics = z.infer<typeof evidenceMetricsSchema>;

// ============================================================================
// Safety Metrics
// ============================================================================

export const safetyMetricsSchema = z.object({
  triggered: z.boolean(),
  stopLatencyTurns: z.number(),
  postStopToolCalls: z.number(),
});
export type SafetyMetrics = z.infer<typeof safetyMetricsSchema>;

// ============================================================================
// Deterministic Metrics (Combined)
// ============================================================================

export const benchmarkStatusSchema = z.enum(["pass", "warn", "fail"]);
export type BenchmarkStatus = z.infer<typeof benchmarkStatusSchema>;

export const deterministicMetricsSchema = z.object({
  coverage: coverageMetricsSchema,
  evidence: evidenceMetricsSchema,
  safety: safetyMetricsSchema,
  status: benchmarkStatusSchema,
  failReasons: z.array(z.string()),
  warnReasons: z.array(z.string()),
});
export type DeterministicMetrics = z.infer<typeof deterministicMetricsSchema>;

// ============================================================================
// Readability Metrics
// ============================================================================

export const readabilityMetricsSchema = z.object({
  fre: z.number(), // Flesch Reading Ease
  fkg: z.number(), // Flesch-Kincaid Grade
  gfi: z.number(), // Gunning Fog Index
});
export type ReadabilityMetrics = z.infer<typeof readabilityMetricsSchema>;

// ============================================================================
// Coherence Metrics
// ============================================================================

export const coherenceMetricsSchema = z.object({
  qaCoherenceAvg: z.number(), // mean cosine sim Q/A pairs
  reportAlignment: z.number(), // report vs domain summary
});
export type CoherenceMetrics = z.infer<typeof coherenceMetricsSchema>;

// ============================================================================
// Text Metrics (Combined)
// ============================================================================

export const textMetricsSchema = z.object({
  readability: readabilityMetricsSchema,
  coherence: coherenceMetricsSchema,
  duplicationRate: z.number(),
});
export type TextMetrics = z.infer<typeof textMetricsSchema>;

// ============================================================================
// RAG Metrics
// ============================================================================

export const ragMetricsSchema = z.object({
  contextPrecision: z.number(), // cited / retrieved
  domainCoverageRate: z.number(), // domains with citation / flagged
  phantomRate: z.number(), // phantom citations / total
  groundedClaimRate: z.number(), // grounded claims / total
});
export type RagMetrics = z.infer<typeof ragMetricsSchema>;

// ============================================================================
// LLM Judge Result
// ============================================================================

export const judgeScoresSchema = z.object({
  coverage: z.number().min(1).max(5),
  relevance: z.number().min(1).max(5),
  flow: z.number().min(1).max(5),
  explainability: z.number().min(1).max(5),
  empathy: z.number().min(1).max(5),
});
export type JudgeScores = z.infer<typeof judgeScoresSchema>;

export const judgeResultSchema = z.object({
  scores: judgeScoresSchema,
  overallScore: z.number(),
  strengthsTop3: z.array(z.string()),
  issuesTop3: z.array(z.string()),
  recommendedFixes: z.array(z.string()),
  hallucinationFlags: z.array(z.string()),
  overclaimFlags: z.array(z.string()),
});
export type JudgeResult = z.infer<typeof judgeResultSchema>;

// ============================================================================
// Model Comparison
// ============================================================================

export const impressionSchema = z.object({
  label: z.string(),
  confidence: z.number(),
});
export type ImpressionItem = z.infer<typeof impressionSchema>;

export const modelComparisonSchema = z.object({
  modelId: z.string(),
  impressions: z.array(impressionSchema),
  jaccard: z.number().optional(), // vs driver
  spearmanRho: z.number().optional(), // vs driver
  confidenceDrift: z.number().optional(), // vs driver
  groundedClaimRate: z.number(),
  judgeResult: judgeResultSchema.optional(),
});
export type ModelComparison = z.infer<typeof modelComparisonSchema>;

// ============================================================================
// Benchmark Config
// ============================================================================

export const benchmarkConfigSchema = z.object({
  ragMode: ragModeSchema,
  diagnosticMode: diagnosticModeSchema,
  compareModels: z.array(z.string()).max(2),
});
export type BenchmarkConfig = z.infer<typeof benchmarkConfigSchema>;

// ============================================================================
// Benchmark Run Status
// ============================================================================

export const benchmarkRunStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
]);
export type BenchmarkRunStatus = z.infer<typeof benchmarkRunStatusSchema>;

// ============================================================================
// Complete Benchmark Run
// ============================================================================

export const benchmarkRunSchema = z.object({
  benchmarkRunId: z.string().uuid(),
  chatId: z.string().uuid(),
  snapshotId: z.string().uuid(),
  config: benchmarkConfigSchema,
  status: benchmarkRunStatusSchema,
  deterministic: deterministicMetricsSchema.optional(),
  text: textMetricsSchema.optional(),
  rag: ragMetricsSchema.optional(),
  judge: judgeResultSchema.optional(),
  comparisons: z.array(modelComparisonSchema).optional(),
  createdAt: z.string(),
  completedAt: z.string().optional(),
});
export type BenchmarkRun = z.infer<typeof benchmarkRunSchema>;

// ============================================================================
// API Request/Response Schemas
// ============================================================================

export const runBenchmarkInputSchema = z.object({
  chatId: z.string().uuid(),
  compareModels: z.array(z.string()).max(2).optional().default([]),
  ragMode: ragModeSchema.optional().default("off"),
  diagnosticMode: diagnosticModeSchema.optional().default("diagnostic"),
});
export type RunBenchmarkInput = z.infer<typeof runBenchmarkInputSchema>;

export const benchmarkRunResponseSchema = z.object({
  runId: z.string().uuid(),
  status: benchmarkRunStatusSchema,
  deterministic: deterministicMetricsSchema.optional(),
  text: textMetricsSchema.optional(),
  rag: ragMetricsSchema.optional(),
  judge: judgeResultSchema.optional(),
  comparisons: z.array(modelComparisonSchema).optional(),
});
export type BenchmarkRunResponse = z.infer<typeof benchmarkRunResponseSchema>;
