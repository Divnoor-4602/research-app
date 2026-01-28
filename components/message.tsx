"use client";
import type { UseChatHelpers } from "@ai-sdk/react";
import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import type { Vote } from "@/lib/db/schema";
import type { ChatMessage } from "@/lib/types";
import { cn, sanitizeText } from "@/lib/utils";
import { type Citation, CitationBadgeList } from "./citation-badge";
import { useDataStream } from "./data-stream-provider";
import { MessageContent } from "./elements/message";
import { Response } from "./elements/response";
import { SparklesIcon } from "./icons";
import { MessageActions } from "./message-actions";
import { MessageEditor } from "./message-editor";
import { MessageReasoning } from "./message-reasoning";
import { PreviewAttachment } from "./preview-attachment";

// Minimal inline tool display
const getToolDisplayName = (type: string): string => {
  const toolNames: Record<string, string> = {
    "tool-checkSafety": "Safety Check",
    "tool-diagnose": "Diagnostic Analysis",
    "tool-generateReport": "Generate Report",
    "tool-getNextQuestion": "Get Next Question",
    "tool-scoreResponse": "Score Response",
    "tool-markItemComplete": "Mark Complete",
    "tool-requestFollowUp": "Request Follow-Up",
  };
  return (
    toolNames[type] ??
    type
      .replace("tool-", "")
      .replace(/([A-Z])/g, " $1")
      .trim()
  );
};

const getStatusLabel = (state: string): { label: string; color: string } => {
  switch (state) {
    case "output-available":
      return { label: "Done", color: "text-green-600 dark:text-green-400" };
    case "output-error":
      return { label: "Error", color: "text-red-600 dark:text-red-400" };
    case "input-available":
    case "input-streaming":
      return { label: "Running", color: "text-blue-600 dark:text-blue-400" };
    default:
      return { label: "Pending", color: "text-muted-foreground" };
  }
};

function MinimalToolAccordion({
  toolName,
  state,
  children,
  defaultOpen = false,
}: {
  toolName: string;
  state: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const status = getStatusLabel(state);

  return (
    <div className="my-1">
      <button
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setIsOpen(!isOpen)}
        type="button"
      >
        <ChevronRightIcon
          className={cn("size-3 transition-transform", isOpen && "rotate-90")}
        />
        <span>{toolName}</span>
        <span className={cn("text-[10px]", status.color)}>
          ({status.label})
        </span>
      </button>
      {isOpen && (
        <div className="mt-1.5 ml-4 pl-2 border-l border-muted text-xs">
          {children}
        </div>
      )}
    </div>
  );
}

const PurePreviewMessage = ({
  addToolApprovalResponse,
  chatId,
  message,
  vote,
  isLoading,
  setMessages,
  regenerate,
  isReadonly,
  requiresScrollPadding: _requiresScrollPadding,
}: {
  addToolApprovalResponse: UseChatHelpers<ChatMessage>["addToolApprovalResponse"];
  chatId: string;
  message: ChatMessage;
  vote: Vote | undefined;
  isLoading: boolean;
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  regenerate: UseChatHelpers<ChatMessage>["regenerate"];
  isReadonly: boolean;
  requiresScrollPadding: boolean;
}) => {
  const [mode, setMode] = useState<"view" | "edit">("view");

  const attachmentsFromMessage = message.parts.filter(
    (part): part is Extract<typeof part, { type: "file" }> =>
      part.type === "file"
  );

  useDataStream();

  return (
    <div
      className="group/message fade-in w-full animate-in duration-200"
      data-role={message.role}
      data-testid={`message-${message.role}`}
    >
      <div
        className={cn("flex w-full items-start gap-2 md:gap-3", {
          "justify-end": message.role === "user" && mode !== "edit",
          "justify-start": message.role === "assistant",
        })}
      >
        {message.role === "assistant" && (
          <div className="-mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-background ring-1 ring-border">
            <SparklesIcon size={14} />
          </div>
        )}

        <div
          className={cn("flex flex-col", {
            "gap-2 md:gap-4": message.parts?.some(
              (p) => p.type === "text" && p.text?.trim()
            ),
            "w-full":
              (message.role === "assistant" &&
                (message.parts?.some(
                  (p) => p.type === "text" && p.text?.trim()
                ) ||
                  message.parts?.some((p) => p.type.startsWith("tool-")))) ||
              mode === "edit",
            "max-w-[calc(100%-2.5rem)] sm:max-w-[min(fit-content,80%)]":
              message.role === "user" && mode !== "edit",
          })}
        >
          {attachmentsFromMessage.length > 0 && (
            <div
              className="flex flex-row justify-end gap-2"
              data-testid={"message-attachments"}
            >
              {attachmentsFromMessage.map((attachment) => (
                <PreviewAttachment
                  attachment={{
                    name: attachment.filename ?? "file",
                    contentType: attachment.mediaType,
                    url: attachment.url,
                  }}
                  key={attachment.url}
                />
              ))}
            </div>
          )}

          {message.parts?.map((part, index) => {
            const { type } = part;
            const key = `message-${message.id}-part-${index}`;

            if (type === "reasoning") {
              const hasContent = part.text?.trim().length > 0;
              const isStreaming = "state" in part && part.state === "streaming";
              if (hasContent || isStreaming) {
                return (
                  <MessageReasoning
                    isLoading={isLoading || isStreaming}
                    key={key}
                    reasoning={part.text || ""}
                  />
                );
              }
            }

            if (type === "text") {
              if (mode === "view") {
                return (
                  <div key={key}>
                    <MessageContent
                      className={cn({
                        "wrap-break-word w-fit rounded-2xl px-3 py-2 text-right text-white":
                          message.role === "user",
                        "bg-transparent px-0 py-0 text-left":
                          message.role === "assistant",
                      })}
                      data-testid="message-content"
                      style={
                        message.role === "user"
                          ? { backgroundColor: "#006cff" }
                          : undefined
                      }
                    >
                      <Response>{sanitizeText(part.text)}</Response>
                    </MessageContent>
                  </div>
                );
              }

              if (mode === "edit") {
                return (
                  <div
                    className="flex w-full flex-row items-start gap-3"
                    key={key}
                  >
                    <div className="size-8" />
                    <div className="min-w-0 flex-1">
                      <MessageEditor
                        key={message.id}
                        message={message}
                        regenerate={regenerate}
                        setMessages={setMessages}
                        setMode={setMode}
                      />
                    </div>
                  </div>
                );
              }
            }

            // DSM-5 Tools handler
            if (type.startsWith("tool-")) {
              const toolPart = part as {
                toolCallId: string;
                state: string;
                input?: unknown;
                output?: unknown;
                errorText?: string;
              };
              const { toolCallId, state } = toolPart;
              const output = toolPart.output as
                | Record<string, unknown>
                | undefined;
              const input = toolPart.input;
              const toolType = type as string;

              // Custom rendering for scoreResponse
              if (
                toolType === "tool-scoreResponse" &&
                state === "output-available" &&
                output &&
                !("error" in output)
              ) {
                return (
                  <MinimalToolAccordion
                    key={toolCallId}
                    state={state}
                    toolName={getToolDisplayName(toolType)}
                  >
                    <div className="space-y-1.5">
                      {Array.isArray(output.scores) &&
                        output.scores.map(
                          (
                            score: {
                              itemId: string;
                              score: number;
                              ambiguity: number;
                              evidenceQuotes?: string[];
                            },
                            idx: number
                          ) => (
                            <div key={idx}>
                              <span className="font-medium">
                                {score.itemId}
                              </span>
                              <span className="mx-1.5">→</span>
                              <span
                                className={cn(
                                  score.score >= 3
                                    ? "text-red-600 dark:text-red-400"
                                    : score.score >= 2
                                      ? "text-yellow-600 dark:text-yellow-400"
                                      : "text-green-600 dark:text-green-400"
                                )}
                              >
                                {score.score}/4
                              </span>
                              <span className="text-muted-foreground ml-2">
                                (ambiguity: {score.ambiguity}/10)
                              </span>
                              {score.evidenceQuotes &&
                                score.evidenceQuotes.length > 0 && (
                                  <div className="text-muted-foreground italic mt-0.5">
                                    &quot;{score.evidenceQuotes[0]}&quot;
                                  </div>
                                )}
                            </div>
                          )
                        )}
                      {Boolean(output.shouldFollowUp) && (
                        <div className="text-blue-600 dark:text-blue-400">
                          Follow-up: {String(output.followUpReason ?? "")}
                        </div>
                      )}
                      {output.nextAction === "SAFETY_STOP" && (
                        <div className="text-red-600 dark:text-red-400 font-medium">
                          ⚠ Safety concern - session stopped
                        </div>
                      )}
                    </div>
                  </MinimalToolAccordion>
                );
              }

              // Hide getNextQuestion from UI - internal tool
              if (toolType === "tool-getNextQuestion") {
                return null;
              }

              // Custom rendering for generateReport tool - prominent card, not accordion
              if (toolType === "tool-generateReport") {
                // Loading state
                if (
                  state === "input-available" ||
                  state === "input-streaming"
                ) {
                  return (
                    <div
                      className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 p-4 my-2"
                      key={toolCallId}
                    >
                      <div className="flex size-10 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30">
                        <svg
                          className="size-5 text-blue-600 dark:text-blue-400 animate-pulse"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          viewBox="0 0 24 24"
                        >
                          <path
                            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </div>
                      <div>
                        <div className="font-medium text-sm">
                          Generating Report...
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Compiling screening results and recommendations
                        </div>
                      </div>
                    </div>
                  );
                }

                // Error state
                if (state === "output-error") {
                  return (
                    <div
                      className="flex items-center gap-3 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-4 my-2"
                      key={toolCallId}
                    >
                      <div className="flex size-10 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
                        <svg
                          className="size-5 text-red-600 dark:text-red-400"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          viewBox="0 0 24 24"
                        >
                          <path
                            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </div>
                      <div>
                        <div className="font-medium text-sm text-red-700 dark:text-red-400">
                          Report Generation Failed
                        </div>
                        <div className="text-xs text-red-600/80 dark:text-red-400/80">
                          {(toolPart as { errorText?: string }).errorText ??
                            "An error occurred"}
                        </div>
                      </div>
                    </div>
                  );
                }

                // Success state - prominent clickable card
                if (state === "output-available" && output && output.success) {
                  const documentId = String(output.documentId ?? "");
                  const title = String(output.title ?? "Screening Report");

                  return (
                    <button
                      className="flex w-full items-center gap-3 rounded-lg border border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-950/30 p-4 my-2 text-left transition-all hover:bg-green-100 dark:hover:bg-green-950/50 hover:border-green-300 dark:hover:border-green-800 cursor-pointer group"
                      key={toolCallId}
                      onClick={() => {
                        const event = new CustomEvent("open-artifact", {
                          detail: { documentId, title, kind: "report" },
                        });
                        window.dispatchEvent(event);
                      }}
                      type="button"
                    >
                      <div className="flex size-10 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/50 group-hover:bg-green-200 dark:group-hover:bg-green-900/70 transition-colors">
                        <svg
                          className="size-5 text-green-600 dark:text-green-400"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          viewBox="0 0 24 24"
                        >
                          <path
                            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm text-green-800 dark:text-green-300 flex items-center gap-2">
                          <span className="truncate">{title}</span>
                          <span className="inline-flex items-center rounded-full bg-green-200 dark:bg-green-800 px-2 py-0.5 text-[10px] font-medium text-green-800 dark:text-green-200">
                            Ready
                          </span>
                        </div>
                        <div className="text-xs text-green-600/80 dark:text-green-400/70">
                          Click to view your screening report
                        </div>
                      </div>
                      <svg
                        className="size-5 text-green-500 dark:text-green-400 group-hover:translate-x-0.5 transition-transform"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        viewBox="0 0 24 24"
                      >
                        <path
                          d="M9 5l7 7-7 7"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  );
                }

                // Fallback for other states
                return null;
              }

              // Custom rendering for diagnose tool
              if (
                toolType === "tool-diagnose" &&
                state === "output-available" &&
                output &&
                !("error" in output)
              ) {
                const domains = (output.domains ?? []) as Array<{
                  domain: string;
                  severity: string;
                  meetsThreshold: boolean;
                  clinicalNote: string;
                  itemScores: Array<{ itemId: string; score: number }>;
                }>;
                const flaggedDomains = domains.filter((d) => d.meetsThreshold);
                const riskLevel = String(output.riskLevel ?? "unknown");
                const ragUsed = Boolean(output.ragUsed);
                const citations = (output.citations ?? []) as Citation[];

                return (
                  <MinimalToolAccordion
                    defaultOpen
                    key={toolCallId}
                    state={state}
                    toolName={getToolDisplayName(toolType)}
                  >
                    <div className="space-y-2">
                      {/* Risk Level */}
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">Risk:</span>{" "}
                        <span
                          className={cn(
                            "font-medium",
                            riskLevel === "critical"
                              ? "text-red-600 dark:text-red-400"
                              : riskLevel === "high"
                                ? "text-orange-600 dark:text-orange-400"
                                : riskLevel === "moderate"
                                  ? "text-yellow-600 dark:text-yellow-400"
                                  : "text-green-600 dark:text-green-400"
                          )}
                        >
                          {riskLevel.charAt(0).toUpperCase() +
                            riskLevel.slice(1)}
                        </span>
                        {ragUsed && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 dark:bg-blue-900/30 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-300">
                            <svg
                              className="size-2.5"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={2}
                              viewBox="0 0 24 24"
                            >
                              <path
                                d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                            RAG
                          </span>
                        )}
                      </div>

                      {/* Summary */}
                      {Boolean(output.overallSummary) && (
                        <div className="text-muted-foreground">
                          {String(output.overallSummary)}
                        </div>
                      )}

                      {/* Flagged Domains with Citations */}
                      {flaggedDomains.length > 0 && (
                        <div className="space-y-1.5">
                          <span className="text-muted-foreground">
                            Flagged ({flaggedDomains.length}):
                          </span>
                          <div className="flex flex-wrap gap-2">
                            {flaggedDomains.map((d, idx) => (
                              <div
                                className="inline-flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1"
                                key={idx}
                              >
                                <span
                                  className={cn(
                                    "font-medium text-sm",
                                    d.severity === "severe" ||
                                      d.severity === "elevated"
                                      ? "text-red-600 dark:text-red-400"
                                      : "text-yellow-600 dark:text-yellow-400"
                                  )}
                                >
                                  {d.domain}
                                </span>
                                {/* Show citation badge if RAG is active and we have citations */}
                                {ragUsed && citations.length > 0 && (
                                  <CitationBadgeList
                                    citations={citations
                                      .filter(
                                        (c) =>
                                          c.sectionPath
                                            ?.toLowerCase()
                                            .includes(d.domain.toLowerCase()) ||
                                          c.snippet
                                            .toLowerCase()
                                            .includes(d.domain.toLowerCase())
                                      )
                                      .slice(0, 1)}
                                    maxVisible={1}
                                  />
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* All Citations Section (when RAG active) */}
                      {ragUsed && citations.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-border/50">
                          <div className="text-xs text-muted-foreground mb-1.5">
                            DSM-5 References:
                          </div>
                          <CitationBadgeList
                            citations={citations}
                            maxVisible={5}
                          />
                        </div>
                      )}

                      {/* Recommendations */}
                      {Array.isArray(output.recommendations) &&
                        output.recommendations.length > 0 && (
                          <div className="text-muted-foreground">
                            <div className="font-medium text-foreground mb-0.5">
                              Recommendations:
                            </div>
                            <ul className="list-disc pl-4">
                              {(output.recommendations as string[])
                                .slice(0, 3)
                                .map((rec, idx) => (
                                  <li key={idx}>{rec}</li>
                                ))}
                            </ul>
                          </div>
                        )}

                      {/* Disclaimer */}
                      <div className="text-amber-600 dark:text-amber-400 italic">
                        Screening only — requires professional validation
                      </div>
                    </div>
                  </MinimalToolAccordion>
                );
              }

              // Generic fallback for other tool states and types
              return (
                <MinimalToolAccordion
                  key={toolCallId}
                  state={state}
                  toolName={getToolDisplayName(toolType)}
                >
                  {(state === "input-available" ||
                    state === "input-streaming") &&
                  Boolean(input) ? (
                    <pre className="overflow-x-auto font-mono text-[10px] text-muted-foreground">
                      {JSON.stringify(input, null, 2)}
                    </pre>
                  ) : null}
                  {state === "output-available" && Boolean(output) ? (
                    <pre className="overflow-x-auto font-mono text-[10px] text-muted-foreground">
                      {JSON.stringify(output, null, 2)}
                    </pre>
                  ) : null}
                  {state === "output-error" && toolPart.errorText ? (
                    <div className="text-red-500">{toolPart.errorText}</div>
                  ) : null}
                </MinimalToolAccordion>
              );
            }

            return null;
          })}

          {!isReadonly && (
            <MessageActions
              chatId={chatId}
              isLoading={isLoading}
              key={`action-${message.id}`}
              message={message}
              setMode={setMode}
              vote={vote}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export const PreviewMessage = PurePreviewMessage;

export const ThinkingMessage = () => {
  return (
    <div
      className="group/message fade-in w-full animate-in duration-300"
      data-role="assistant"
      data-testid="message-assistant-loading"
    >
      <div className="flex items-start justify-start gap-3">
        <div className="-mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-background ring-1 ring-border">
          <div className="animate-pulse">
            <SparklesIcon size={14} />
          </div>
        </div>

        <div className="flex w-full flex-col gap-2 md:gap-4">
          <div className="flex items-center gap-1 p-0 text-muted-foreground text-sm">
            <span className="animate-pulse">Thinking</span>
            <span className="inline-flex">
              <span className="animate-bounce [animation-delay:0ms]">.</span>
              <span className="animate-bounce [animation-delay:150ms]">.</span>
              <span className="animate-bounce [animation-delay:300ms]">.</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
