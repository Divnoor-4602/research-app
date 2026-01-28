import { tool } from "ai";
import { z } from "zod";
import { getDsmSessionByChatId, updateDsmSession } from "@/lib/db/queries";
import { type AgentState, getItemById, type QuestionState } from "@/lib/dsm5";
import { getInterviewProgress, selectNextItem } from "@/lib/dsm5/item-selector";
import { type StateContext, transitionState } from "@/lib/dsm5/state-machine";

type GetNextQuestionProps = {
  chatId: string;
};

/**
 * Tool to get the next DSM-5 screening question.
 * Manages state machine transitions and adaptive item selection.
 */
export const getNextQuestion = ({ chatId }: GetNextQuestionProps) =>
  tool({
    description:
      "Get the next DSM-5 Level-1 screening question to ask the patient. " +
      "This tool selects the appropriate item based on interview progress and " +
      "previous responses, using adaptive ordering when high-severity symptoms are detected.",
    inputSchema: z.object({
      reason: z
        .string()
        .optional()
        .describe("Optional reason for requesting the next question"),
    }),
    execute: async ({ reason }) => {
      // 1. Fetch the current session
      const session = await getDsmSessionByChatId({ chatId });

      if (!session) {
        return {
          error: "No DSM-5 session found for this chat",
          state: "DONE" as AgentState,
        };
      }

      // 2. Extract question state and build state context
      const questionState = session.questionState as QuestionState;
      const stateContext = buildStateContext(questionState);

      // 3. Check if we're in a terminal state
      if (
        stateContext.currentState === "DONE" ||
        stateContext.currentState === "SAFETY_STOP"
      ) {
        return {
          error: `Session is in terminal state: ${stateContext.currentState}`,
          state: stateContext.currentState,
        };
      }

      // 4. Check if all items are complete
      if (questionState.pendingItems.length === 0) {
        // Transition to REPORT state
        const newContext = transitionState(stateContext, {
          type: "ALL_ITEMS_COMPLETE",
        });

        await updateSessionState(chatId, questionState, newContext);

        return {
          error: "All items complete - ready for report generation",
          state: "REPORT" as AgentState,
        };
      }

      // 5. Get item scores for adaptive ordering
      const itemScores = await getItemScoresMap(session.id);

      // 6. Select the next item
      const nextItemId = selectNextItem(
        questionState.pendingItems,
        questionState.completedItems,
        itemScores
      );

      if (!nextItemId) {
        return {
          error: "No pending items found",
          state: stateContext.currentState,
        };
      }

      // 7. Get the item details
      const item = getItemById(nextItemId);
      if (!item) {
        return {
          error: `Item not found: ${nextItemId}`,
          state: stateContext.currentState,
        };
      }

      // 8. Determine if this is the first question (needs introduction)
      const isFirstQuestion =
        stateContext.currentState === "INTRO" ||
        questionState.completedItems.length === 0;

      // 9. Transition state machine
      let newContext: StateContext;
      if (stateContext.currentState === "INTRO") {
        newContext = transitionState(stateContext, {
          type: "START_INTERVIEW",
          itemId: nextItemId,
        });
      } else {
        newContext = transitionState(stateContext, {
          type: "MOVE_TO_NEXT_ITEM",
          itemId: nextItemId,
        });
      }

      // Update current item
      newContext = {
        ...newContext,
        currentItemId: nextItemId,
      };

      // 10. Persist updated state
      await updateSessionState(chatId, questionState, newContext);

      // 11. Get progress info
      const progress = getInterviewProgress(
        questionState.pendingItems,
        questionState.completedItems
      );

      // 12. Return the question payload
      return {
        itemId: nextItemId,
        canonicalText: item.text,
        domain: item.domain,
        isFollowUp: newContext.isFollowUp,
        remainingCount: questionState.pendingItems.length - 1, // Excluding current
        state: newContext.currentState,
        shouldIntroduce: isFirstQuestion,
        progress: {
          completed: progress.completedItems,
          total: progress.totalItems,
          percentComplete: Math.round(progress.percentComplete),
        },
      };
    },
  });

/**
 * Build StateContext from QuestionState
 */
function buildStateContext(questionState: QuestionState): StateContext {
  return {
    currentState: (questionState.currentState as AgentState) ?? "INTRO",
    currentItemId: questionState.currentItemId ?? null,
    isFollowUp: questionState.isFollowUp ?? false,
    followUpUsedItems: questionState.followUpUsedItems ?? [],
  };
}

/**
 * Update session state with new context
 */
async function updateSessionState(
  chatId: string,
  questionState: QuestionState,
  newContext: StateContext
): Promise<void> {
  const updatedQuestionState: QuestionState = {
    ...questionState,
    currentState: newContext.currentState,
    currentItemId: newContext.currentItemId,
    isFollowUp: newContext.isFollowUp,
    followUpUsedItems: newContext.followUpUsedItems,
  };

  await updateDsmSession({
    chatId,
    patch: {
      questionState: updatedQuestionState,
    },
  });
}

/**
 * Get item scores as a Map for the adaptive selector
 */
async function getItemScoresMap(
  sessionId: string
): Promise<Map<string, number>> {
  // For now, we'll return an empty map since we haven't implemented
  // the item response fetching yet. This will be populated in Feature 4.
  // The selector will fall back to sequential ordering.
  return new Map<string, number>();
}

/**
 * Tool to request a follow-up question for the current item
 */
export const requestFollowUp = ({ chatId }: GetNextQuestionProps) =>
  tool({
    description:
      "Request a follow-up question for the current DSM-5 item when the patient's " +
      "response was unclear or warrants more exploration.",
    inputSchema: z.object({
      itemId: z.string().describe("The item ID to follow up on"),
      reason: z
        .string()
        .describe(
          "Reason for follow-up (e.g., 'response unclear', 'high severity')"
        ),
    }),
    execute: async ({ itemId, reason }) => {
      const session = await getDsmSessionByChatId({ chatId });

      if (!session) {
        return { error: "No DSM-5 session found", success: false };
      }

      const questionState = session.questionState as QuestionState;
      const stateContext = buildStateContext(questionState);

      // Check if follow-up is allowed
      if (stateContext.followUpUsedItems.includes(itemId)) {
        return {
          error: "Follow-up already used for this item",
          success: false,
          itemId,
        };
      }

      // Get item details
      const item = getItemById(itemId);
      if (!item) {
        return { error: `Item not found: ${itemId}`, success: false };
      }

      // Transition to FOLLOW_UP state
      const newContext = transitionState(stateContext, {
        type: "TRIGGER_FOLLOW_UP",
      });

      // Update state
      await updateSessionState(chatId, questionState, {
        ...newContext,
        currentItemId: itemId,
      });

      return {
        success: true,
        itemId,
        canonicalText: item.text,
        domain: item.domain,
        isFollowUp: true,
        reason,
      };
    },
  });

/**
 * Tool to mark an item as completed after scoring
 */
export const markItemComplete = ({ chatId }: GetNextQuestionProps) =>
  tool({
    description:
      "Mark a DSM-5 item as completed after the response has been scored.",
    inputSchema: z.object({
      itemId: z.string().describe("The item ID to mark as complete"),
    }),
    execute: async ({ itemId }) => {
      const session = await getDsmSessionByChatId({ chatId });

      if (!session) {
        return { error: "No DSM-5 session found", success: false };
      }

      const questionState = session.questionState as QuestionState;

      // Move item from pending to completed
      const updatedPending = questionState.pendingItems.filter(
        (id) => id !== itemId
      );
      const updatedCompleted = questionState.completedItems.includes(itemId)
        ? questionState.completedItems
        : [...questionState.completedItems, itemId];

      // Check if all items are now complete
      const allComplete = updatedPending.length === 0;

      // Update question state
      const updatedQuestionState: QuestionState = {
        ...questionState,
        pendingItems: updatedPending,
        completedItems: updatedCompleted,
        currentState: allComplete ? "REPORT" : questionState.currentState,
      };

      await updateDsmSession({
        chatId,
        patch: {
          questionState: updatedQuestionState,
          ...(allComplete && { sessionStatus: "completed" }),
        },
      });

      const progress = getInterviewProgress(updatedPending, updatedCompleted);

      return {
        success: true,
        itemId,
        allComplete,
        progress: {
          completed: progress.completedItems,
          total: progress.totalItems,
          percentComplete: Math.round(progress.percentComplete),
        },
      };
    },
  });
