import { generateObject, tool } from "ai";
import { z } from "zod";
import { getLanguageModel } from "@/lib/ai/providers";
import {
  getDsmSessionByChatId,
  triggerSafetyStop,
  updateDsmSession,
} from "@/lib/db/queries";
import { SAFETY_ESCALATION_SCRIPT } from "@/lib/dsm5/prompts";
import {
  type QuestionState,
  type RiskFlags,
  riskFlagsPatchSchema,
} from "@/lib/dsm5/schemas";

type CheckSafetyProps = {
  chatId: string;
  modelId?: string;
};

// Schema for the safety check input
const checkSafetyInputSchema = z.object({
  patientMessage: z
    .string()
    .describe("The patient's message to check for safety concerns"),
});

// Schema for the LLM safety analysis output
const safetyAnalysisSchema = z.object({
  safe: z
    .boolean()
    .describe("True if the message is safe, false if crisis signals detected"),
  riskFlags: z.object({
    suicidalityMentioned: z
      .boolean()
      .describe("Any mention of wanting to die, ending life, not being here"),
    selfHarmIdeation: z
      .boolean()
      .describe("Mentions of self-harm, cutting, hurting oneself"),
    violenceRisk: z.boolean().describe("Threats of violence or harm to others"),
  }),
  reasoning: z
    .string()
    .describe("Brief explanation of why this is or is not a safety concern"),
  urgencyLevel: z
    .enum(["none", "low", "medium", "high", "critical"])
    .describe("How urgent is the safety concern"),
});

// Schema for the tool output
const checkSafetyOutputSchema = z.object({
  safe: z.boolean(),
  riskFlags: riskFlagsPatchSchema,
  reasoning: z.string(),
  urgencyLevel: z.enum(["none", "low", "medium", "high", "critical"]),
  escalationScript: z.string().optional(),
  sessionTerminated: z.boolean(),
});

export type CheckSafetyOutput = z.infer<typeof checkSafetyOutputSchema>;

/**
 * Get the safety check prompt for the LLM
 */
function getSafetyCheckPrompt(patientMessage: string): string {
  return `You are a safety screening assistant. Your job is to detect crisis signals in patient messages during a mental health check-in.

TASK:
Analyze the patient's message for any signs of:
1. Suicidal ideation or intent (wanting to die, ending life, not wanting to be here anymore)
2. Self-harm ideation (cutting, hurting themselves, self-injury)
3. Violence risk (threats to harm others, homicidal ideation)

PATIENT MESSAGE:
"${patientMessage}"

DETECTION GUIDELINES:
- Be CONSERVATIVE - flag anything that could indicate risk
- Look for both explicit and implicit signals
- Consider context and severity

EXPLICIT SIGNALS (always flag):
- "I want to die" / "I want to kill myself" / "I don't want to be here anymore"
- "I've been thinking about ending it" / "I have a plan"
- "I've been cutting myself" / "I hurt myself"
- "I want to hurt someone" / "I'm going to hurt them"

IMPLICIT SIGNALS (flag if concerning):
- "What's the point" / "Everyone would be better off without me"
- "I can't take this anymore" / "I just want it to stop"
- "I've been thinking about ways out"
- Giving away possessions, saying goodbye

URGENCY LEVELS:
- none: No safety concerns detected
- low: Vague passive ideation ("sometimes I wonder what's the point")
- medium: Active ideation without plan ("I've thought about not being here")
- high: Active ideation with some specificity ("I've been thinking about how to do it")
- critical: Immediate danger (specific plan, means, timeline)

For "high" or "critical" urgency, set safe=false.
For "none" through "medium", set safe=true but still flag risk indicators.

Return your analysis.`;
}

/**
 * Tool to check patient messages for safety concerns
 * Should be called FIRST on every patient message before any other processing
 */
export const checkSafety = ({ chatId, modelId }: CheckSafetyProps) =>
  tool({
    description:
      "Check a patient message for safety concerns (suicidal ideation, self-harm, violence). " +
      "MUST be called FIRST on every patient message before any other tool. " +
      "If safe=false is returned, stop the screening and use the escalation script.",
    inputSchema: checkSafetyInputSchema,
    execute: async ({ patientMessage }) => {
      // 1. Get session to check current state
      const session = await getDsmSessionByChatId({ chatId });
      if (!session) {
        // No session - likely not in DSM-5 mode, return safe
        return {
          safe: true,
          riskFlags: {},
          reasoning: "No DSM-5 session found - skipping safety check",
          urgencyLevel: "none" as const,
          sessionTerminated: false,
        };
      }

      // 2. Check if already in SAFETY_STOP state
      const questionState = session.questionState as QuestionState;
      if (questionState.currentState === "SAFETY_STOP") {
        return {
          safe: false,
          riskFlags: {},
          reasoning: "Session already in SAFETY_STOP state",
          urgencyLevel: "critical" as const,
          escalationScript: SAFETY_ESCALATION_SCRIPT,
          sessionTerminated: true,
        };
      }

      // 3. Call LLM for safety analysis
      const model = getLanguageModel(modelId ?? "openai/gpt-4o-mini");

      let analysisResult: z.infer<typeof safetyAnalysisSchema>;

      try {
        const { object } = await generateObject({
          model,
          schema: safetyAnalysisSchema,
          prompt: getSafetyCheckPrompt(patientMessage),
        });
        analysisResult = object;
      } catch (error) {
        console.error("Safety check LLM error:", error);
        // On error, err on the side of caution but don't stop the session
        return {
          safe: true,
          riskFlags: {},
          reasoning: "Safety check failed - proceeding with caution",
          urgencyLevel: "none" as const,
          sessionTerminated: false,
        };
      }

      // 4. Determine if we need to trigger safety stop
      const isCritical =
        analysisResult.urgencyLevel === "high" ||
        analysisResult.urgencyLevel === "critical";

      if (isCritical) {
        // 5. Update session state and risk flags
        const currentRiskFlags = session.riskFlags as RiskFlags;
        const updatedRiskFlags: RiskFlags = {
          suicidalityMentioned:
            currentRiskFlags.suicidalityMentioned ||
            analysisResult.riskFlags.suicidalityMentioned,
          selfHarmIdeation:
            currentRiskFlags.selfHarmIdeation ||
            analysisResult.riskFlags.selfHarmIdeation,
          violenceRisk:
            currentRiskFlags.violenceRisk ||
            analysisResult.riskFlags.violenceRisk,
          substanceAbuseSignal: currentRiskFlags.substanceAbuseSignal,
        };

        // Trigger safety stop
        await triggerSafetyStop({ chatId });

        // Update risk flags
        await updateDsmSession({
          chatId,
          patch: {
            riskFlags: updatedRiskFlags,
          },
        });

        return {
          safe: false,
          riskFlags: analysisResult.riskFlags,
          reasoning: analysisResult.reasoning,
          urgencyLevel: analysisResult.urgencyLevel,
          escalationScript: SAFETY_ESCALATION_SCRIPT,
          sessionTerminated: true,
        };
      }

      // 6. Safe to continue - but still update any detected flags
      if (
        analysisResult.riskFlags.suicidalityMentioned ||
        analysisResult.riskFlags.selfHarmIdeation ||
        analysisResult.riskFlags.violenceRisk
      ) {
        const currentRiskFlags = session.riskFlags as RiskFlags;
        await updateDsmSession({
          chatId,
          patch: {
            riskFlags: {
              suicidalityMentioned:
                currentRiskFlags.suicidalityMentioned ||
                analysisResult.riskFlags.suicidalityMentioned,
              selfHarmIdeation:
                currentRiskFlags.selfHarmIdeation ||
                analysisResult.riskFlags.selfHarmIdeation,
              violenceRisk:
                currentRiskFlags.violenceRisk ||
                analysisResult.riskFlags.violenceRisk,
              substanceAbuseSignal: currentRiskFlags.substanceAbuseSignal,
            },
          },
        });
      }

      return {
        safe: true,
        riskFlags: analysisResult.riskFlags,
        reasoning: analysisResult.reasoning,
        urgencyLevel: analysisResult.urgencyLevel,
        sessionTerminated: false,
      };
    },
  });
