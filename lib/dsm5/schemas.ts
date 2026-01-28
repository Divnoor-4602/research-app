import { z } from "zod";

// ============================================================================
// Core Enums
// ============================================================================

export const sessionStatusSchema = z.enum([
  "active",
  "completed",
  "terminated_for_safety",
]);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

export const diagnosticModeSchema = z.enum([
  "screening",
  "categorical",
  "diagnostic",
]);
export type DiagnosticMode = z.infer<typeof diagnosticModeSchema>;

// ============================================================================
// Transcript
// ============================================================================

export const transcriptEntrySchema = z.object({
  role: z.enum(["patient", "interviewer"]),
  text: z.string(),
  timestamp: z.string().optional(),
});
export type TranscriptEntry = z.infer<typeof transcriptEntrySchema>;

// ============================================================================
// Item Response (Individual DSM-5 Item Scores)
// ============================================================================

export const evidenceSpanSchema = z.object({
  type: z.enum(["direct_span", "inferred", "none"]),
  messageIndex: z.number().int().min(0),
  spans: z
    .array(
      z.object({
        start: z.number().int().min(0),
        end: z.number().int().min(0),
      })
    )
    .max(3),
  strength: z.number().min(0).max(1),
  summary: z.string().optional(),
});
export type EvidenceSpan = z.infer<typeof evidenceSpanSchema>;

export const itemResponseSchema = z.object({
  itemId: z.string(),
  score: z.union([
    z.literal(0),
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
  ]),
  ambiguity: z.number().int().min(1).max(10),
  evidenceQuotes: z.array(z.string()),
  evidence: evidenceSpanSchema.optional(),
  confidence: z.number().min(0).max(1).optional(),
});
export type ItemResponse = z.infer<typeof itemResponseSchema>;

// ============================================================================
// Symptom Summary (Domain-Level Aggregation)
// ============================================================================

export const symptomDomainSchema = z.object({
  domain: z.string(),
  severityAggregate: z.number(),
  notableSymptoms: z.array(z.string()),
});
export type SymptomDomain = z.infer<typeof symptomDomainSchema>;

// ============================================================================
// Risk Flags (Safety Signals)
// ============================================================================

export const riskFlagsSchema = z.object({
  suicidalityMentioned: z.boolean(),
  selfHarmIdeation: z.boolean(),
  violenceRisk: z.boolean(),
  substanceAbuseSignal: z.boolean(),
});
export type RiskFlags = z.infer<typeof riskFlagsSchema>;

export const defaultRiskFlags: RiskFlags = {
  suicidalityMentioned: false,
  selfHarmIdeation: false,
  violenceRisk: false,
  substanceAbuseSignal: false,
};

// ============================================================================
// Agent State (State Machine)
// ============================================================================

export const agentStateSchema = z.enum([
  "INTRO",
  "ASK_ITEM",
  "SCORE_ITEM",
  "FOLLOW_UP",
  "REPORT",
  "DONE",
  "SAFETY_STOP",
]);
export type AgentState = z.infer<typeof agentStateSchema>;

// ============================================================================
// Question State (Interview Progress Tracking)
// ============================================================================

export const questionStateSchema = z.object({
  pendingItems: z.array(z.string()),
  completedItems: z.array(z.string()),
  followUpsNeeded: z.array(z.string()),
  // State machine fields
  currentState: agentStateSchema.optional().default("INTRO"),
  currentItemId: z.string().nullable().optional().default(null),
  isFollowUp: z.boolean().optional().default(false),
  followUpUsedItems: z.array(z.string()).optional().default([]),
});
export type QuestionState = z.infer<typeof questionStateSchema>;

// ============================================================================
// Session Metadata
// ============================================================================

export const sessionMetaSchema = z.object({
  sessionId: z.string().uuid(),
  modelVersion: z.string(),
  promptVersion: z.string(),
  syntheticPersonaId: z.string().optional(),
});
export type SessionMeta = z.infer<typeof sessionMetaSchema>;

// ============================================================================
// Complete Patient Profile
// ============================================================================

export const patientProfileSchema = z.object({
  sessionStatus: sessionStatusSchema,
  completedAt: z.string().optional(),
  transcript: z.array(transcriptEntrySchema),
  itemResponses: z.array(itemResponseSchema),
  symptomSummary: z.array(symptomDomainSchema),
  riskFlags: riskFlagsSchema,
  questionState: questionStateSchema,
  sessionMeta: sessionMetaSchema,
});
export type PatientProfile = z.infer<typeof patientProfileSchema>;

// ============================================================================
// Partial Update Schemas (for incremental updates)
// ============================================================================

export const patientProfilePatchSchema = patientProfileSchema.partial();
export type PatientProfilePatch = z.infer<typeof patientProfilePatchSchema>;

export const riskFlagsPatchSchema = riskFlagsSchema.partial();
export type RiskFlagsPatch = z.infer<typeof riskFlagsPatchSchema>;

// ============================================================================
// DSM Session (Database Row Shape)
// ============================================================================

export const dsmSessionSchema = z.object({
  id: z.string().uuid(),
  chatId: z.string().uuid(),
  sessionStatus: sessionStatusSchema,
  diagnosticMode: diagnosticModeSchema,
  transcript: z.array(transcriptEntrySchema),
  symptomSummary: z.array(symptomDomainSchema),
  riskFlags: riskFlagsSchema,
  questionState: questionStateSchema,
  sessionMeta: sessionMetaSchema,
  completedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type DsmSession = z.infer<typeof dsmSessionSchema>;

// ============================================================================
// DSM Item Response (Database Row Shape)
// ============================================================================

export const dsmItemResponseDbSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  itemId: z.string(),
  score: z.number().int().min(0).max(4),
  ambiguity: z.number().int().min(1).max(10),
  evidenceQuotes: z.array(z.string()),
  evidence: evidenceSpanSchema.optional(),
  confidence: z.number().min(0).max(1).nullable(),
  createdAt: z.date(),
});
export type DsmItemResponseDb = z.infer<typeof dsmItemResponseDbSchema>;

// ============================================================================
// API Request/Response Schemas
// ============================================================================

export const createDsmSessionInputSchema = z.object({
  chatId: z.string().uuid(),
  diagnosticMode: diagnosticModeSchema.optional().default("diagnostic"),
  sessionMeta: sessionMetaSchema,
  questionState: questionStateSchema,
});
export type CreateDsmSessionInput = z.infer<typeof createDsmSessionInputSchema>;

export const updateDsmSessionInputSchema = z.object({
  chatId: z.string().uuid(),
  patch: z.object({
    sessionStatus: sessionStatusSchema.optional(),
    diagnosticMode: diagnosticModeSchema.optional(),
    transcript: z.array(transcriptEntrySchema).optional(),
    symptomSummary: z.array(symptomDomainSchema).optional(),
    riskFlags: riskFlagsSchema.optional(),
    questionState: questionStateSchema.optional(),
    completedAt: z.string().optional(),
  }),
});
export type UpdateDsmSessionInput = z.infer<typeof updateDsmSessionInputSchema>;

export const appendTranscriptInputSchema = z.object({
  chatId: z.string().uuid(),
  entry: transcriptEntrySchema,
});
export type AppendTranscriptInput = z.infer<typeof appendTranscriptInputSchema>;

export const upsertItemResponseInputSchema = z.object({
  sessionId: z.string().uuid(),
  itemId: z.string(),
  score: z.number().int().min(0).max(4),
  ambiguity: z.number().int().min(1).max(10),
  evidenceQuotes: z.array(z.string()),
  confidence: z.number().min(0).max(1).optional(),
});
export type UpsertItemResponseInput = z.infer<
  typeof upsertItemResponseInputSchema
>;

// ============================================================================
// Tool Response Schemas
// ============================================================================

export const getNextQuestionResponseSchema = z.object({
  itemId: z.string(),
  canonicalText: z.string(),
  domain: z.string(),
  isFollowUp: z.boolean(),
  remainingCount: z.number(),
  state: agentStateSchema,
  shouldIntroduce: z.boolean(),
  progress: z.object({
    completed: z.number(),
    total: z.number(),
    percentComplete: z.number(),
  }),
});
export type GetNextQuestionResponse = z.infer<
  typeof getNextQuestionResponseSchema
>;

export const scoreResponseResultSchema = z.object({
  score: z.number().int().min(0).max(4),
  ambiguity: z.number().int().min(1).max(10),
  evidenceQuotes: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  riskFlagsPatch: riskFlagsSchema.partial(),
  shouldFollowUp: z.boolean(),
  nextState: agentStateSchema,
});
export type ScoreResponseResult = z.infer<typeof scoreResponseResultSchema>;

// ============================================================================
// Score Response Tool Schemas
// ============================================================================

/**
 * Input schema for the scoreResponse tool
 */
export const scoreResponseInputSchema = z.object({
  itemId: z
    .string()
    .describe(
      "The EXACT item ID from getNextQuestion (e.g., 'D1', 'ANG1', 'M1'). Must match the itemId returned by getNextQuestion."
    ),
  patientText: z.string().describe("The patient's response text to analyze"),
  additionalItemIds: z
    .array(z.string())
    .optional()
    .describe(
      "Additional item IDs if the response covers multiple symptoms (e.g., ['D2', 'SLP1'])"
    ),
});
export type ScoreResponseInput = z.infer<typeof scoreResponseInputSchema>;

/**
 * Schema for a single item's score result
 */
export const itemScoreResultSchema = z.object({
  itemId: z.string(),
  score: z.number().int().min(0).max(4),
  ambiguity: z.number().int().min(1).max(10),
  evidenceQuotes: z
    .array(z.string())
    .max(3)
    .describe("Top 3 sentence-level quotes as evidence"),
  confidence: z.number().min(0).max(1),
  inferenceReasoning: z
    .string()
    .describe("Brief explanation of how the score was inferred"),
});
export type ItemScoreResult = z.infer<typeof itemScoreResultSchema>;

/**
 * Output schema for the scoreResponse tool
 */
export const scoreResponseOutputSchema = z.object({
  scores: z.array(itemScoreResultSchema).describe("Scores for all items"),
  riskFlagsPatch: riskFlagsPatchSchema.describe(
    "Any safety flags detected in the response"
  ),
  shouldFollowUp: z
    .boolean()
    .describe("Whether to ask a follow-up question for the primary item"),
  followUpReason: z
    .string()
    .optional()
    .describe("Reason for follow-up if applicable"),
  primaryItemId: z.string().describe("The primary item that was scored"),
  itemsCompleted: z.array(z.string()).describe("Item IDs marked as complete"),
});
export type ScoreResponseOutput = z.infer<typeof scoreResponseOutputSchema>;

/**
 * LLM output schema for structured scoring (used internally)
 */
export const llmScoringOutputSchema = z.object({
  scores: z.array(
    z.object({
      itemId: z.string(),
      score: z.number().int().min(0).max(4),
      ambiguity: z.number().int().min(1).max(10),
      evidenceQuotes: z.array(z.string()).max(3),
      evidenceSummary: z.string().optional(),
      confidence: z.number().min(0).max(1),
      inferenceReasoning: z.string(),
    })
  ),
  riskFlagsPatch: z.object({
    suicidalityMentioned: z.boolean(),
    selfHarmIdeation: z.boolean(),
    violenceRisk: z.boolean(),
    substanceAbuseSignal: z.boolean(),
  }),
});
export type LlmScoringOutput = z.infer<typeof llmScoringOutputSchema>;

// ============================================================================
// Diagnose Tool Schemas
// ============================================================================

/**
 * Severity level for domain screening
 */
export const severityLevelSchema = z.enum([
  "none",
  "mild",
  "moderate",
  "elevated",
  "severe",
]);
export type SeverityLevel = z.infer<typeof severityLevelSchema>;

/**
 * RAG mode for diagnose tool
 */
export const ragModeSchema = z.enum(["off", "citations", "grounded"]);
export type RagMode = z.infer<typeof ragModeSchema>;

/**
 * Input schema for the diagnose tool
 */
export const diagnoseInputSchema = z.object({
  diagnosticMode: diagnosticModeSchema
    .optional()
    .default("screening")
    .describe(
      "The diagnostic output mode: 'screening' (domain flags only), 'categorical' (DSM-5 categories), or 'diagnostic' (specific impressions with confidence)"
    ),
  ragMode: ragModeSchema
    .optional()
    .default("off")
    .describe(
      "RAG mode: 'off' (no DSM retrieval), 'citations' (include DSM citations), 'grounded' (require criterion anchors)"
    ),
});
export type DiagnoseInput = z.infer<typeof diagnoseInputSchema>;

/**
 * Individual domain screening flag
 */
export const domainFlagSchema = z.object({
  domain: z.string().describe("The DSM-5 domain name"),
  severity: severityLevelSchema.describe(
    "Overall severity level for this domain"
  ),
  itemScores: z
    .array(
      z.object({
        itemId: z.string(),
        score: z.number().int().min(0).max(4),
      })
    )
    .describe("Individual item scores within this domain"),
  evidenceQuotes: z
    .array(z.string())
    .describe("Patient quotes supporting this domain flag"),
  threshold: z.number().describe("The threshold score for this domain"),
  meetsThreshold: z
    .boolean()
    .describe("Whether the domain meets clinical threshold"),
  clinicalNote: z.string().describe("Recommended clinical follow-up action"),
});
export type DomainFlag = z.infer<typeof domainFlagSchema>;

/**
 * Provisional impression (for categorical/diagnostic modes)
 */
export const impressionSchema = z.object({
  label: z.string().describe("The diagnostic impression label"),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("Confidence score for this impression (0-1)"),
  reasoning: z.string().describe("Step-by-step reasoning for this impression"),
  supportingDomains: z
    .array(z.string())
    .describe("Domain names that support this impression"),
  evidenceQuotes: z
    .array(z.string())
    .describe("Key patient quotes supporting this impression"),
});
export type Impression = z.infer<typeof impressionSchema>;

/**
 * Output schema for the diagnose tool
 */
export const diagnoseOutputSchema = z.object({
  mode: diagnosticModeSchema.describe("The diagnostic mode used"),
  domains: z
    .array(domainFlagSchema)
    .describe("Screening flags for all 13 domains"),
  impressions: z
    .array(impressionSchema)
    .describe("Provisional impressions (categorical/diagnostic modes only)"),
  overallSummary: z
    .string()
    .describe("Brief narrative summary of screening results"),
  riskLevel: z
    .enum(["low", "moderate", "high", "critical"])
    .describe("Overall risk assessment"),
  limitations: z
    .array(z.string())
    .describe("Important limitations and caveats"),
  recommendations: z
    .array(z.string())
    .describe("Recommended next steps for clinician"),
  ragUsed: z.boolean().describe("Whether RAG retrieval was used"),
  citations: z
    .array(
      z.object({
        id: z.string(),
        sectionPath: z.string().nullable(),
        page: z.number().nullable(),
        snippet: z.string(),
        relevance: z.number(),
        linkedDomain: z
          .string()
          .optional()
          .describe("Domain this citation supports"),
      })
    )
    .describe("DSM-5 citations from RAG retrieval"),
});
export type DiagnoseOutput = z.infer<typeof diagnoseOutputSchema>;

/**
 * LLM output schema for diagnostic analysis
 */
export const llmDiagnoseOutputSchema = z.object({
  overallSummary: z.string(),
  riskLevel: z.enum(["low", "moderate", "high", "critical"]),
  impressions: z.array(
    z.object({
      label: z.string(),
      confidence: z.number().min(0).max(1),
      reasoning: z.string(),
      supportingDomains: z.array(z.string()),
      keyEvidence: z.array(z.string()),
    })
  ),
  limitations: z.array(z.string()),
  recommendations: z.array(z.string()),
});
