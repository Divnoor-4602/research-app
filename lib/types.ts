import type { InferUITool, UIMessage } from "ai";
import { z } from "zod";
import type { ArtifactKind } from "@/components/artifact";
import type {
  checkSafety,
  diagnose,
  generateReport,
  getNextQuestion,
  markItemComplete,
  requestFollowUp,
  scoreResponse,
} from "./ai/tools/dsm5";
import type { Suggestion } from "./db/schema";

export type DataPart = { type: "append-message"; message: string };

export const messageMetadataSchema = z.object({
  createdAt: z.string(),
});

export type MessageMetadata = z.infer<typeof messageMetadataSchema>;

// DSM-5 tool types
type CheckSafetyTool = InferUITool<ReturnType<typeof checkSafety>>;
type DiagnoseTool = InferUITool<ReturnType<typeof diagnose>>;
type GenerateReportTool = InferUITool<ReturnType<typeof generateReport>>;
type GetNextQuestionTool = InferUITool<ReturnType<typeof getNextQuestion>>;
type MarkItemCompleteTool = InferUITool<ReturnType<typeof markItemComplete>>;
type RequestFollowUpTool = InferUITool<ReturnType<typeof requestFollowUp>>;
type ScoreResponseTool = InferUITool<ReturnType<typeof scoreResponse>>;

export type ChatTools = {
  checkSafety: CheckSafetyTool;
  diagnose: DiagnoseTool;
  generateReport: GenerateReportTool;
  getNextQuestion: GetNextQuestionTool;
  markItemComplete: MarkItemCompleteTool;
  requestFollowUp: RequestFollowUpTool;
  scoreResponse: ScoreResponseTool;
};

export type CustomUIDataTypes = {
  textDelta: string;
  imageDelta: string;
  sheetDelta: string;
  codeDelta: string;
  reportDelta: string;
  suggestion: Suggestion;
  appendMessage: string;
  id: string;
  title: string;
  kind: ArtifactKind;
  clear: null;
  finish: null;
  "chat-title": string;
};

export type ChatMessage = UIMessage<
  MessageMetadata,
  CustomUIDataTypes,
  ChatTools
>;

export type Attachment = {
  name: string;
  url: string;
  contentType: string;
};
