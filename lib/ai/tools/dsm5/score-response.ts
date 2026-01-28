import { generateObject, tool } from "ai";
import type { z } from "zod";
import { getLanguageModel } from "@/lib/ai/providers";
import {
  getDsmSessionByChatId,
  updateDsmSession,
  upsertItemResponse,
} from "@/lib/db/queries";
import { DSM5_LEVEL1_ITEMS, getItemById } from "@/lib/dsm5/items";
import {
  llmScoringOutputSchema,
  type QuestionState,
  type RiskFlags,
  type ScoreResponseOutput,
  scoreResponseInputSchema,
} from "@/lib/dsm5/schemas";
import {
  extractEvidenceSpans,
  validateEvidenceSpan,
} from "@/lib/dsm5/evidence";

type ScoreResponseProps = {
  chatId: string;
  modelId?: string;
};

/**
 * Get the multi-item scoring prompt for the LLM
 */
function getMultiItemScoringPrompt(
  itemIds: string[],
  patientText: string,
  transcriptContext: string
): string {
  const itemDescriptions = itemIds
    .map((id) => {
      const item = getItemById(id);
      return item ? `- ${id} (${item.domain}): "${item.text}"` : null;
    })
    .filter(Boolean)
    .join("\n");

  return `You are a clinical scoring assistant that converts natural conversation into structured symptom metrics.

TASK:
Analyze the patient's response and extract frequency scores for the relevant DSM-5 items.
The patient speaks naturally - you must infer the clinical metrics from their words.

ITEMS TO SCORE:
${itemDescriptions}

PATIENT RESPONSE:
"${patientText}"

CONVERSATION CONTEXT:
${transcriptContext}

FREQUENCY INFERENCE GUIDE:
Map natural language to these anchors:

0 (Not at all): "no", "never", "not really", "I don't think so", "that's not me", denial
1 (Rarely, 1-2 days): "once or twice", "rarely", "not often", "occasionally", "a little"
2 (Several days): "sometimes", "a few times", "on and off", "here and there", "some days"
3 (More than half the days): "often", "most days", "frequently", "a lot", "more often than not"
4 (Nearly every day): "always", "every day", "constantly", "all the time", "non-stop"

Modifiers:
- Intensity words ("really", "very", "extremely") → may push score higher
- Minimizing words ("a bit", "slightly", "not too bad") → may push score lower
- Impact on functioning → indicates severity
- Duration mentioned → context for scoring

AMBIGUITY SCALE:
1 = Very clear frequency indicators given
3-4 = Reasonably clear with minor inference
5-6 = Moderate ambiguity, best-guess needed
7-8 = Quite unclear, significant inference
9-10 = Cannot determine from response

EVIDENCE QUOTES - CRITICAL RULES:
- Extract ONLY from the PATIENT RESPONSE above, NEVER from interviewer/question text
- Quotes must be exact substrings from: "${patientText}"
- Do NOT include "Patient:" prefix or any role labels
- Do NOT quote anything that contains a question mark (those are interviewer questions)
- If no clear patient quote exists, use: "(inferred from response)" and set ambiguity to 7+
- Choose up to 3 quotes that best support the score you assigned

EVIDENCE SUMMARY (required):
- Provide a brief 1-sentence summary describing what the patient said
- Format: "Patient reports [symptom/feeling] [frequency]"
- Example: "Patient reports feeling anxious several days per week"
- This summary will be shown in reports instead of raw quotes

SAFETY FLAGS (be conservative - flag if in doubt):
- suicidalityMentioned: wanting to die, not wanting to be here, ending it, suicide
- selfHarmIdeation: cutting, hurting self, self-punishment behaviors
- violenceRisk: wanting to hurt others, violent thoughts or plans
- substanceAbuseSignal: heavy/daily use, dependence, using substances to cope

OUTPUT FORMAT:
Return a JSON object with scores for ALL items listed above, plus risk flags.
Only score items that the patient actually addressed in their response.
If an item wasn't addressed, don't include it in the scores array.`;
}

/**
 * Tool to score patient responses and extract clinical metrics
 */
export const scoreResponse = ({ chatId, modelId }: ScoreResponseProps) =>
  tool({
    description:
      "Score the patient's response to extract DSM-5 symptom metrics. " +
      "Call this after the patient responds to a screening question. " +
      "Can score multiple items if the patient mentioned several symptoms. " +
      "Returns scores, evidence quotes, and whether a follow-up is needed.",
    inputSchema: scoreResponseInputSchema,
    execute: async ({ itemId, patientText, additionalItemIds }) => {
      // 1. Get session
      const session = await getDsmSessionByChatId({ chatId });
      if (!session) {
        return {
          error: "No DSM-5 session found for this chat",
          success: false,
        };
      }

      // 2. Build list of items to score
      const allItemIds = [itemId, ...(additionalItemIds ?? [])];
      const validItemIds = allItemIds.filter(
        (id) => getItemById(id) !== undefined
      );

      if (validItemIds.length === 0) {
        // Log for debugging
        console.error(
          `scoreResponse: No valid item IDs. Received: ${JSON.stringify(allItemIds)}. ` +
            `Valid IDs are: ${DSM5_LEVEL1_ITEMS.map((i) => i.itemId).join(", ")}`
        );
        return {
          error: `No valid item IDs provided. Received: "${itemId}". Use exact IDs like D1, D2, ANG1, M1, etc.`,
          success: false,
        };
      }

      // 3. Get transcript context (last 5 exchanges)
      const transcript = session.transcript as Array<{
        role: string;
        text: string;
      }>;
      const recentTranscript = transcript
        .slice(-10)
        .map(
          (t) => `${t.role === "patient" ? "Patient" : "Therapist"}: ${t.text}`
        )
        .join("\n");

      // 4. Call LLM to score the response
      const model = getLanguageModel(modelId ?? "openai/gpt-4o-mini");

      let scoringResult: z.infer<typeof llmScoringOutputSchema>;

      try {
        const { object } = await generateObject({
          model,
          schema: llmScoringOutputSchema,
          prompt: getMultiItemScoringPrompt(
            validItemIds,
            patientText,
            recentTranscript
          ),
        });
        scoringResult = object;
      } catch (error) {
        console.error("Scoring LLM error:", error);
        return {
          error: "Failed to score response",
          success: false,
        };
      }

      // 5. Save scores to database
      const questionState = session.questionState as QuestionState;
      const itemsCompleted: string[] = [];
      const patientMessageIndex = [...transcript]
        .map((entry, index) => ({ entry, index }))
        .reverse()
        .find((item) => item.entry.role === "patient")?.index ?? 0;

      for (const scoreResult of scoringResult.scores) {
        // Validate item exists
        const item = getItemById(scoreResult.itemId);
        if (!item) continue;

        const rawEvidence = extractEvidenceSpans(
          patientText,
          scoreResult.evidenceQuotes,
          patientMessageIndex,
          scoreResult.evidenceSummary
        );

        const validation = validateEvidenceSpan(rawEvidence, patientText);
        const evidence = validation.valid
          ? rawEvidence
          : {
              ...rawEvidence,
              type: "inferred" as const,
              spans: [],
              strength: 0.5,
            };

        if (!validation.valid) {
          console.warn(
            `Evidence validation issues for ${scoreResult.itemId}:`,
            validation.issues
          );
        }

        // Save to dsmItemResponse table
        await upsertItemResponse({
          sessionId: session.id,
          itemId: scoreResult.itemId,
          score: scoreResult.score,
          ambiguity: scoreResult.ambiguity,
          evidenceQuotes: scoreResult.evidenceQuotes.slice(0, 3), // Max 3
          evidence,
          confidence: scoreResult.confidence,
        });

        // Mark item as complete if it's in pending
        if (questionState.pendingItems.includes(scoreResult.itemId)) {
          itemsCompleted.push(scoreResult.itemId);
        }
      }

      // 6. Update question state - move items from pending to completed
      const updatedPending = questionState.pendingItems.filter(
        (id) => !itemsCompleted.includes(id)
      );
      const updatedCompleted = [
        ...questionState.completedItems,
        ...itemsCompleted.filter(
          (id) => !questionState.completedItems.includes(id)
        ),
      ];

      // 7. Check if follow-up should be triggered for the primary item
      const primaryScore = scoringResult.scores.find(
        (s) => s.itemId === itemId
      );
      const followUpUsedItems = questionState.followUpUsedItems ?? [];

      const shouldFollowUp = Boolean(
        primaryScore &&
          !followUpUsedItems.includes(itemId) &&
          (primaryScore.ambiguity >= 7 || primaryScore.score >= 2)
      );

      // 8. Update risk flags if any detected
      const currentRiskFlags = session.riskFlags as RiskFlags;
      const riskPatch = scoringResult.riskFlagsPatch;
      const updatedRiskFlags: RiskFlags = {
        suicidalityMentioned:
          currentRiskFlags.suicidalityMentioned ||
          Boolean(riskPatch.suicidalityMentioned),
        selfHarmIdeation:
          currentRiskFlags.selfHarmIdeation ||
          Boolean(riskPatch.selfHarmIdeation),
        violenceRisk:
          currentRiskFlags.violenceRisk || Boolean(riskPatch.violenceRisk),
        substanceAbuseSignal:
          currentRiskFlags.substanceAbuseSignal ||
          Boolean(riskPatch.substanceAbuseSignal),
      };

      // Check if any critical risk flag was just triggered
      const criticalRiskTriggered =
        riskPatch.suicidalityMentioned ||
        riskPatch.selfHarmIdeation ||
        riskPatch.violenceRisk;

      // 9. Determine next state
      let nextState = questionState.currentState;
      if (criticalRiskTriggered) {
        nextState = "SAFETY_STOP";
      } else if (updatedPending.length === 0) {
        nextState = "REPORT";
      } else if (shouldFollowUp) {
        nextState = "FOLLOW_UP";
      } else {
        nextState = "ASK_ITEM";
      }

      // 10. Persist updated session state
      const updatedQuestionState: QuestionState = {
        ...questionState,
        pendingItems: updatedPending,
        completedItems: updatedCompleted,
        currentState: nextState,
        isFollowUp: shouldFollowUp,
        followUpUsedItems: shouldFollowUp
          ? [...followUpUsedItems, itemId]
          : followUpUsedItems,
      };

      await updateDsmSession({
        chatId,
        patch: {
          questionState: updatedQuestionState,
          riskFlags: updatedRiskFlags,
          ...(criticalRiskTriggered && {
            sessionStatus: "terminated_for_safety",
          }),
          ...(nextState === "REPORT" && { sessionStatus: "completed" }),
        },
      });

      // 11. Build response
      const response: ScoreResponseOutput = {
        scores: scoringResult.scores.map((s) => ({
          itemId: s.itemId,
          score: s.score,
          ambiguity: s.ambiguity,
          evidenceQuotes: s.evidenceQuotes.slice(0, 3),
          confidence: s.confidence,
          inferenceReasoning: s.inferenceReasoning,
        })),
        riskFlagsPatch: scoringResult.riskFlagsPatch,
        shouldFollowUp,
        followUpReason: shouldFollowUp
          ? primaryScore && primaryScore.ambiguity >= 7
            ? "Response was unclear - need clarification"
            : "High severity response - worth exploring further"
          : undefined,
        primaryItemId: itemId,
        itemsCompleted,
      };

      // Add warnings for critical states
      if (criticalRiskTriggered) {
        return {
          ...response,
          warning: "SAFETY_STOP triggered - use safety escalation script",
          nextAction: "SAFETY_STOP",
        };
      }

      if (nextState === "REPORT") {
        return {
          ...response,
          info: "All items complete - ready for report generation",
          nextAction: "GENERATE_REPORT",
        };
      }

      return {
        ...response,
        nextAction: shouldFollowUp ? "ASK_FOLLOW_UP" : "ASK_NEXT_ITEM",
      };
    },
  });
