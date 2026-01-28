import { geolocation } from "@vercel/functions";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  stepCountIs,
  streamText,
} from "ai";
import { after } from "next/server";
import { createResumableStreamContext } from "resumable-stream";
import { auth, type UserType } from "@/app/(auth)/auth";
import { entitlementsByUserType } from "@/lib/ai/entitlements";
import { type RequestHints, systemPrompt } from "@/lib/ai/prompts";
import { getLanguageModel } from "@/lib/ai/providers";
import {
  checkSafety,
  diagnose,
  generateReport,
  getNextQuestion,
  markItemComplete,
  requestFollowUp,
  scoreResponse,
} from "@/lib/ai/tools/dsm5";
import { isProductionEnvironment } from "@/lib/constants";
import {
  appendToTranscript,
  createDsmSession,
  createStreamId,
  deleteChatById,
  getChatById,
  getDsmSessionByChatId,
  getMessageCountByUserId,
  getMessagesByChatId,
  saveChat,
  saveMessages,
  updateChatTitleById,
  updateMessage,
} from "@/lib/db/queries";
import type { DBMessage } from "@/lib/db/schema";
import { getInterviewProgress } from "@/lib/dsm5/item-selector";
import { getDefaultQuestionState, getItemById } from "@/lib/dsm5/items";
import { getDsm5InterviewerPrompt } from "@/lib/dsm5/prompts";
import {
  defaultRiskFlags,
  type QuestionState,
  type TranscriptEntry,
} from "@/lib/dsm5/schemas";
import { ChatSDKError } from "@/lib/errors";
import type { ChatMessage } from "@/lib/types";
import { convertToUIMessages, generateUUID } from "@/lib/utils";
import { generateTitleFromUserMessage } from "../../actions";
import { type PostRequestBody, postRequestBodySchema } from "./schema";

export const maxDuration = 60;

function getStreamContext() {
  try {
    return createResumableStreamContext({ waitUntil: after });
  } catch (_) {
    return null;
  }
}

export { getStreamContext };

export async function POST(request: Request) {
  let requestBody: PostRequestBody;

  try {
    const json = await request.json();
    requestBody = postRequestBodySchema.parse(json);
  } catch (_) {
    return new ChatSDKError("bad_request:api").toResponse();
  }

  try {
    const {
      id,
      message,
      messages,
      selectedChatModel,
      selectedVisibilityType,
      isDsm5Mode,
      ragMode,
    } = requestBody;

    console.log("[DEBUG] API /chat received - isDsm5Mode:", isDsm5Mode, "ragMode:", ragMode, "chatId:", id);

    const session = await auth();

    if (!session?.user) {
      return new ChatSDKError("unauthorized:chat").toResponse();
    }

    const userType: UserType = session.user.type;

    const messageCount = await getMessageCountByUserId({
      id: session.user.id,
      differenceInHours: 24,
    });

    if (messageCount > entitlementsByUserType[userType].maxMessagesPerDay) {
      return new ChatSDKError("rate_limit:chat").toResponse();
    }

    const isToolApprovalFlow = Boolean(messages);

    const chat = await getChatById({ id });
    let messagesFromDb: DBMessage[] = [];
    let titlePromise: Promise<string> | null = null;

    if (chat) {
      if (chat.userId !== session.user.id) {
        return new ChatSDKError("forbidden:chat").toResponse();
      }
      if (!isToolApprovalFlow) {
        messagesFromDb = await getMessagesByChatId({ id });
      }
    } else if (message?.role === "user") {
      await saveChat({
        id,
        userId: session.user.id,
        title: "New chat",
        visibility: selectedVisibilityType,
      });
      titlePromise = generateTitleFromUserMessage({ message });

      // Create DSM-5 session for new chats when DSM-5 mode is enabled
      if (isDsm5Mode) {
        console.log("[DEBUG] Creating new DSM-5 session for new chat:", id);
        await createDsmSession({
          chatId: id,
          diagnosticMode: "diagnostic",
          sessionMeta: {
            sessionId: id,
            modelVersion: selectedChatModel,
            promptVersion: "1.0.0",
          },
          questionState: getDefaultQuestionState(),
          riskFlags: defaultRiskFlags,
        });
      }
    } else {
      // Existing chat - create DSM-5 session if mode is enabled but session doesn't exist
      if (isDsm5Mode) {
        const existingDsmSession = await getDsmSessionByChatId({ chatId: id });
        if (!existingDsmSession) {
          console.log("[DEBUG] Creating DSM-5 session for existing chat:", id);
          await createDsmSession({
            chatId: id,
            diagnosticMode: "diagnostic",
            sessionMeta: {
              sessionId: id,
              modelVersion: selectedChatModel,
              promptVersion: "1.0.0",
            },
            questionState: getDefaultQuestionState(),
            riskFlags: defaultRiskFlags,
          });
        }
      }
    }

    const uiMessages = isToolApprovalFlow
      ? (messages as ChatMessage[])
      : [...convertToUIMessages(messagesFromDb), message as ChatMessage];

    const { longitude, latitude, city, country } = geolocation(request);

    const requestHints: RequestHints = {
      longitude,
      latitude,
      city,
      country,
    };

    if (message?.role === "user") {
      await saveMessages({
        messages: [
          {
            chatId: id,
            id: message.id,
            role: "user",
            parts: message.parts,
            attachments: [],
            createdAt: new Date(),
          },
        ],
      });

      // Append user message to DSM-5 transcript if in DSM-5 mode
      if (isDsm5Mode) {
        const dsmSession = await getDsmSessionByChatId({ chatId: id });
        if (dsmSession) {
          const textParts = message.parts.filter(
            (p): p is { type: "text"; text: string } => p.type === "text"
          );
          const transcriptEntry: TranscriptEntry = {
            role: "patient",
            text: textParts.map((p) => p.text).join("\n"),
            timestamp: new Date().toISOString(),
          };
          await appendToTranscript({ chatId: id, entry: transcriptEntry });
        }
      }
    }

    const isReasoningModel =
      selectedChatModel.includes("reasoning") ||
      selectedChatModel.includes("thinking");

    const modelMessages = await convertToModelMessages(uiMessages);

    // Build system prompt - use DSM-5 interviewer prompt when in DSM-5 mode
    let finalSystemPrompt: string;
    if (isDsm5Mode) {
      const dsmSession = await getDsmSessionByChatId({ chatId: id });
      console.log("[DEBUG] isDsm5Mode=true, dsmSession exists:", !!dsmSession, "chatId:", id);
      if (dsmSession) {
        const questionState = dsmSession.questionState as QuestionState;
        const progress = getInterviewProgress(
          questionState.pendingItems,
          questionState.completedItems
        );
        const currentItem = questionState.currentItemId
          ? (getItemById(questionState.currentItemId) ?? null)
          : null;

        console.log("[DEBUG] Using DSM-5 interviewer prompt, state:", questionState.currentState, "progress:", progress.completedItems, "/", progress.totalItems);

        finalSystemPrompt = getDsm5InterviewerPrompt({
          stateContext: {
            currentState: questionState.currentState ?? "INTRO",
            currentItemId: questionState.currentItemId ?? null,
            isFollowUp: questionState.isFollowUp ?? false,
            followUpUsedItems: questionState.followUpUsedItems ?? [],
          },
          progress,
          currentItem,
        });
      } else {
        // Fallback to regular prompt if no DSM session exists
        console.log("[DEBUG] No DSM session found, falling back to regular prompt");
        finalSystemPrompt = systemPrompt({ selectedChatModel, requestHints });
      }
    } else {
      console.log("[DEBUG] isDsm5Mode=false, using regular prompt");
      finalSystemPrompt = systemPrompt({ selectedChatModel, requestHints });
    }

    // Define DSM-5 tools
    type Dsm5ToolNames =
      | "checkSafety"
      | "diagnose"
      | "generateReport"
      | "getNextQuestion"
      | "markItemComplete"
      | "requestFollowUp"
      | "scoreResponse";

    // Check if session is in SAFETY_STOP state
    const isInSafetyStop =
      isDsm5Mode &&
      (await getDsmSessionByChatId({ chatId: id }))?.questionState &&
      (
        (await getDsmSessionByChatId({ chatId: id }))
          ?.questionState as QuestionState
      ).currentState === "SAFETY_STOP";

    // Only enable tools in DSM-5 mode
    // If in SAFETY_STOP, only allow checkSafety (for session state check) but no screening tools
    const activeTools: Dsm5ToolNames[] = isDsm5Mode
      ? isInSafetyStop
        ? [] // No tools in safety stop - supportive chat only
        : [
            "checkSafety",
            "diagnose",
            "generateReport",
            "getNextQuestion",
            "markItemComplete",
            "requestFollowUp",
            "scoreResponse",
          ]
      : [];

    const stream = createUIMessageStream({
      originalMessages: isToolApprovalFlow ? uiMessages : undefined,
      execute: async ({ writer: dataStream }) => {
        // DSM-5 tools
        const dsm5Tools = {
          checkSafety: checkSafety({ chatId: id, modelId: selectedChatModel }),
          diagnose: diagnose({
            chatId: id,
            modelId: selectedChatModel,
            ragMode,
          }),
          generateReport: generateReport({
            chatId: id,
            userId: session.user.id,
            dataStream,
          }),
          getNextQuestion: getNextQuestion({ chatId: id }),
          markItemComplete: markItemComplete({ chatId: id }),
          requestFollowUp: requestFollowUp({ chatId: id }),
          scoreResponse: scoreResponse({
            chatId: id,
            modelId: selectedChatModel,
          }),
        };

        const result = streamText({
          model: getLanguageModel(selectedChatModel),
          system: finalSystemPrompt,
          messages: modelMessages,
          stopWhen: stepCountIs(5),
          experimental_activeTools: activeTools,
          providerOptions: isReasoningModel
            ? {
                anthropic: {
                  thinking: { type: "enabled", budgetTokens: 10_000 },
                },
              }
            : undefined,
          tools: dsm5Tools,
          experimental_telemetry: {
            isEnabled: isProductionEnvironment,
            functionId: isDsm5Mode ? "dsm5-interview" : "stream-text",
          },
        });

        dataStream.merge(result.toUIMessageStream({ sendReasoning: true }));

        if (titlePromise) {
          const title = await titlePromise;
          dataStream.write({ type: "data-chat-title", data: title });
          updateChatTitleById({ chatId: id, title });
        }
      },
      generateId: generateUUID,
      onFinish: async ({ messages: finishedMessages }) => {
        if (isToolApprovalFlow) {
          for (const finishedMsg of finishedMessages) {
            const existingMsg = uiMessages.find((m) => m.id === finishedMsg.id);
            if (existingMsg) {
              await updateMessage({
                id: finishedMsg.id,
                parts: finishedMsg.parts,
              });
            } else {
              await saveMessages({
                messages: [
                  {
                    id: finishedMsg.id,
                    role: finishedMsg.role,
                    parts: finishedMsg.parts,
                    createdAt: new Date(),
                    attachments: [],
                    chatId: id,
                  },
                ],
              });
            }
          }
        } else if (finishedMessages.length > 0) {
          await saveMessages({
            messages: finishedMessages.map((currentMessage) => ({
              id: currentMessage.id,
              role: currentMessage.role,
              parts: currentMessage.parts,
              createdAt: new Date(),
              attachments: [],
              chatId: id,
            })),
          });
        }

        // Append assistant messages to DSM-5 transcript if in DSM-5 mode
        if (isDsm5Mode && finishedMessages.length > 0) {
          const dsmSession = await getDsmSessionByChatId({ chatId: id });
          if (dsmSession) {
            for (const finishedMsg of finishedMessages) {
              if (finishedMsg.role === "assistant") {
                const textParts =
                  finishedMsg.parts?.filter(
                    (p): p is { type: "text"; text: string } =>
                      typeof p === "object" &&
                      p !== null &&
                      "type" in p &&
                      p.type === "text"
                  ) ?? [];
                if (textParts.length > 0) {
                  const transcriptEntry: TranscriptEntry = {
                    role: "interviewer",
                    text: textParts.map((p) => p.text).join("\n"),
                    timestamp: new Date().toISOString(),
                  };
                  await appendToTranscript({
                    chatId: id,
                    entry: transcriptEntry,
                  });
                }
              }
            }
          }
        }
      },
      onError: () => "Oops, an error occurred!",
    });

    return createUIMessageStreamResponse({
      stream,
      async consumeSseStream({ stream: sseStream }) {
        if (!process.env.REDIS_URL) {
          return;
        }
        try {
          const streamContext = getStreamContext();
          if (streamContext) {
            const streamId = generateId();
            await createStreamId({ streamId, chatId: id });
            await streamContext.createNewResumableStream(
              streamId,
              () => sseStream
            );
          }
        } catch (_) {
          // ignore redis errors
        }
      },
    });
  } catch (error) {
    const vercelId = request.headers.get("x-vercel-id");

    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }

    if (
      error instanceof Error &&
      error.message?.includes(
        "AI Gateway requires a valid credit card on file to service requests"
      )
    ) {
      return new ChatSDKError("bad_request:activate_gateway").toResponse();
    }

    console.error("Unhandled error in chat API:", error, { vercelId });
    return new ChatSDKError("offline:chat").toResponse();
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return new ChatSDKError("bad_request:api").toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatSDKError("unauthorized:chat").toResponse();
  }

  const chat = await getChatById({ id });

  if (chat?.userId !== session.user.id) {
    return new ChatSDKError("forbidden:chat").toResponse();
  }

  const deletedChat = await deleteChatById({ id });

  return Response.json(deletedChat, { status: 200 });
}
