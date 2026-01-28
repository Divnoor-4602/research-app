import { z } from "zod";

// ============================================================================
// Agent State Types
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
// State Context
// ============================================================================

export const stateContextSchema = z.object({
  currentState: agentStateSchema,
  currentItemId: z.string().nullable(),
  isFollowUp: z.boolean(),
  followUpUsedItems: z.array(z.string()),
});

export type StateContext = z.infer<typeof stateContextSchema>;

// ============================================================================
// State Machine Functions
// ============================================================================

/**
 * Get the initial state context for a new session
 */
export function getInitialStateContext(): StateContext {
  return {
    currentState: "INTRO",
    currentItemId: null,
    isFollowUp: false,
    followUpUsedItems: [],
  };
}

/**
 * Check if a follow-up can be asked for the given item
 */
export function canAskFollowUp(context: StateContext, itemId: string): boolean {
  return !context.followUpUsedItems.includes(itemId);
}

/**
 * Determine if follow-up should be triggered based on score and ambiguity
 * Follow-up triggers when:
 * - ambiguity >= 7 (response unclear), OR
 * - score >= 2 (severity warrants more detail)
 * AND the item hasn't already used its follow-up
 */
export function shouldTriggerFollowUp(
  context: StateContext,
  itemId: string,
  score: number,
  ambiguity: number
): boolean {
  if (!canAskFollowUp(context, itemId)) {
    return false;
  }
  return ambiguity >= 7 || score >= 2;
}

/**
 * Transition to the next state based on current state and conditions
 */
export function transitionState(
  context: StateContext,
  event: StateEvent
): StateContext {
  const { currentState } = context;

  switch (currentState) {
    case "INTRO":
      if (event.type === "START_INTERVIEW") {
        return {
          ...context,
          currentState: "ASK_ITEM",
          currentItemId: event.itemId ?? null,
          isFollowUp: false,
        };
      }
      break;

    case "ASK_ITEM":
      if (event.type === "PATIENT_RESPONDED") {
        return {
          ...context,
          currentState: "SCORE_ITEM",
        };
      }
      if (event.type === "SAFETY_TRIGGERED") {
        return {
          ...context,
          currentState: "SAFETY_STOP",
        };
      }
      if (event.type === "ALL_ITEMS_COMPLETE") {
        return {
          ...context,
          currentState: "REPORT",
          currentItemId: null,
        };
      }
      break;

    case "SCORE_ITEM":
      if (event.type === "TRIGGER_FOLLOW_UP" && context.currentItemId) {
        return {
          ...context,
          currentState: "FOLLOW_UP",
          isFollowUp: true,
          followUpUsedItems: [
            ...context.followUpUsedItems,
            context.currentItemId,
          ],
        };
      }
      if (event.type === "MOVE_TO_NEXT_ITEM") {
        return {
          ...context,
          currentState: "ASK_ITEM",
          currentItemId: event.itemId ?? null,
          isFollowUp: false,
        };
      }
      if (event.type === "SAFETY_TRIGGERED") {
        return {
          ...context,
          currentState: "SAFETY_STOP",
        };
      }
      if (event.type === "ALL_ITEMS_COMPLETE") {
        return {
          ...context,
          currentState: "REPORT",
          currentItemId: null,
        };
      }
      break;

    case "FOLLOW_UP":
      if (event.type === "PATIENT_RESPONDED") {
        return {
          ...context,
          currentState: "SCORE_ITEM",
        };
      }
      if (event.type === "SAFETY_TRIGGERED") {
        return {
          ...context,
          currentState: "SAFETY_STOP",
        };
      }
      break;

    case "REPORT":
      if (event.type === "REPORT_COMPLETE") {
        return {
          ...context,
          currentState: "DONE",
        };
      }
      break;

    case "SAFETY_STOP":
    case "DONE":
      // Terminal states - no transitions
      break;
  }

  // Return unchanged if no valid transition
  return context;
}

// ============================================================================
// State Events
// ============================================================================

export type StateEvent =
  | { type: "START_INTERVIEW"; itemId?: string }
  | { type: "PATIENT_RESPONDED" }
  | { type: "TRIGGER_FOLLOW_UP" }
  | { type: "MOVE_TO_NEXT_ITEM"; itemId?: string }
  | { type: "ALL_ITEMS_COMPLETE" }
  | { type: "SAFETY_TRIGGERED" }
  | { type: "REPORT_COMPLETE" };

// ============================================================================
// State Helpers
// ============================================================================

/**
 * Check if the session is in a terminal state
 */
export function isTerminalState(state: AgentState): boolean {
  return state === "DONE" || state === "SAFETY_STOP";
}

/**
 * Check if the session can accept new patient messages
 */
export function canAcceptPatientMessage(state: AgentState): boolean {
  return state === "ASK_ITEM" || state === "FOLLOW_UP";
}

/**
 * Check if the session is in the interview phase
 */
export function isInInterviewPhase(state: AgentState): boolean {
  return (
    state === "INTRO" ||
    state === "ASK_ITEM" ||
    state === "SCORE_ITEM" ||
    state === "FOLLOW_UP"
  );
}

/**
 * Get a human-readable description of the current state
 */
export function getStateDescription(state: AgentState): string {
  const descriptions: Record<AgentState, string> = {
    INTRO: "Starting the screening interview",
    ASK_ITEM: "Asking a screening question",
    SCORE_ITEM: "Processing the response",
    FOLLOW_UP: "Asking a follow-up question for clarification",
    REPORT: "Generating the screening report",
    DONE: "Interview complete",
    SAFETY_STOP: "Interview terminated due to safety concerns",
  };
  return descriptions[state];
}
