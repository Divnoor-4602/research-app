// DSM-5 Module - Core exports

export * from "./item-selector";
export * from "./items";
export * from "./prompts";
export * from "./schemas";
// Re-export state-machine selectively to avoid collision with schemas
export {
  canAcceptPatientMessage,
  canAskFollowUp,
  getInitialStateContext,
  getStateDescription,
  isInInterviewPhase,
  isTerminalState,
  type StateContext,
  type StateEvent,
  shouldTriggerFollowUp,
  stateContextSchema,
  transitionState,
} from "./state-machine";
