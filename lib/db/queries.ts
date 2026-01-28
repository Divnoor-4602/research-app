import "server-only";

import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  lt,
  type SQL,
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { ArtifactKind } from "@/components/artifact";
import type { VisibilityType } from "@/components/visibility-selector";
import type {
  BenchmarkConfig,
  DeterministicMetrics,
  JudgeResult,
  ModelComparison,
  RagMetrics,
  Snapshot,
  TextMetrics,
} from "@/lib/dsm5/benchmark-schemas";
import type {
  DiagnosticMode,
  QuestionState,
  RiskFlags,
  SessionMeta,
  SymptomDomain,
  TranscriptEntry,
} from "@/lib/dsm5/schemas";
import { ChatSDKError } from "../errors";
import { generateUUID } from "../utils";
import {
  benchmarkRun,
  type BenchmarkRun,
  benchmarkSnapshot,
  type BenchmarkSnapshot,
  type Chat,
  chat,
  type DBMessage,
  type DsmItemResponse,
  type DsmSession,
  document,
  dsmItemResponse,
  dsmSession,
  message,
  type Suggestion,
  stream,
  suggestion,
  type User,
  user,
  vote,
} from "./schema";
import { generateHashedPassword } from "./utils";

// Optionally, if not using email/pass login, you can
// use the Drizzle adapter for Auth.js / NextAuth
// https://authjs.dev/reference/adapter/drizzle

// biome-ignore lint: Forbidden non-null assertion.
const client = postgres(process.env.POSTGRES_URL!);
const db = drizzle(client);

export async function getUser(email: string): Promise<User[]> {
  try {
    return await db.select().from(user).where(eq(user.email, email));
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get user by email"
    );
  }
}

export async function createUser(email: string, password: string) {
  const hashedPassword = generateHashedPassword(password);

  try {
    return await db.insert(user).values({ email, password: hashedPassword });
  } catch (_error) {
    throw new ChatSDKError("bad_request:database", "Failed to create user");
  }
}

export async function createGuestUser() {
  const email = `guest-${Date.now()}`;
  const password = generateHashedPassword(generateUUID());

  try {
    return await db.insert(user).values({ email, password }).returning({
      id: user.id,
      email: user.email,
    });
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to create guest user"
    );
  }
}

export async function saveChat({
  id,
  userId,
  title,
  visibility,
}: {
  id: string;
  userId: string;
  title: string;
  visibility: VisibilityType;
}) {
  try {
    return await db.insert(chat).values({
      id,
      createdAt: new Date(),
      userId,
      title,
      visibility,
    });
  } catch (_error) {
    throw new ChatSDKError("bad_request:database", "Failed to save chat");
  }
}

export async function deleteChatById({ id }: { id: string }) {
  try {
    await db.delete(vote).where(eq(vote.chatId, id));
    await db.delete(message).where(eq(message.chatId, id));
    await db.delete(stream).where(eq(stream.chatId, id));

    const [chatsDeleted] = await db
      .delete(chat)
      .where(eq(chat.id, id))
      .returning();
    return chatsDeleted;
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to delete chat by id"
    );
  }
}

export async function deleteAllChatsByUserId({ userId }: { userId: string }) {
  try {
    const userChats = await db
      .select({ id: chat.id })
      .from(chat)
      .where(eq(chat.userId, userId));

    if (userChats.length === 0) {
      return { deletedCount: 0 };
    }

    const chatIds = userChats.map((c) => c.id);

    await db.delete(vote).where(inArray(vote.chatId, chatIds));
    await db.delete(message).where(inArray(message.chatId, chatIds));
    await db.delete(stream).where(inArray(stream.chatId, chatIds));

    const deletedChats = await db
      .delete(chat)
      .where(eq(chat.userId, userId))
      .returning();

    return { deletedCount: deletedChats.length };
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to delete all chats by user id"
    );
  }
}

export async function getChatsByUserId({
  id,
  limit,
  startingAfter,
  endingBefore,
}: {
  id: string;
  limit: number;
  startingAfter: string | null;
  endingBefore: string | null;
}) {
  try {
    const extendedLimit = limit + 1;

    const query = (whereCondition?: SQL<any>) =>
      db
        .select()
        .from(chat)
        .where(
          whereCondition
            ? and(whereCondition, eq(chat.userId, id))
            : eq(chat.userId, id)
        )
        .orderBy(desc(chat.createdAt))
        .limit(extendedLimit);

    let filteredChats: Chat[] = [];

    if (startingAfter) {
      const [selectedChat] = await db
        .select()
        .from(chat)
        .where(eq(chat.id, startingAfter))
        .limit(1);

      if (!selectedChat) {
        throw new ChatSDKError(
          "not_found:database",
          `Chat with id ${startingAfter} not found`
        );
      }

      filteredChats = await query(gt(chat.createdAt, selectedChat.createdAt));
    } else if (endingBefore) {
      const [selectedChat] = await db
        .select()
        .from(chat)
        .where(eq(chat.id, endingBefore))
        .limit(1);

      if (!selectedChat) {
        throw new ChatSDKError(
          "not_found:database",
          `Chat with id ${endingBefore} not found`
        );
      }

      filteredChats = await query(lt(chat.createdAt, selectedChat.createdAt));
    } else {
      filteredChats = await query();
    }

    const hasMore = filteredChats.length > limit;

    return {
      chats: hasMore ? filteredChats.slice(0, limit) : filteredChats,
      hasMore,
    };
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get chats by user id"
    );
  }
}

export async function getChatById({ id }: { id: string }) {
  try {
    const [selectedChat] = await db.select().from(chat).where(eq(chat.id, id));
    if (!selectedChat) {
      return null;
    }

    return selectedChat;
  } catch (_error) {
    throw new ChatSDKError("bad_request:database", "Failed to get chat by id");
  }
}

export async function saveMessages({ messages }: { messages: DBMessage[] }) {
  try {
    return await db.insert(message).values(messages);
  } catch (_error) {
    throw new ChatSDKError("bad_request:database", "Failed to save messages");
  }
}

export async function updateMessage({
  id,
  parts,
}: {
  id: string;
  parts: DBMessage["parts"];
}) {
  try {
    return await db.update(message).set({ parts }).where(eq(message.id, id));
  } catch (_error) {
    throw new ChatSDKError("bad_request:database", "Failed to update message");
  }
}

export async function getMessagesByChatId({ id }: { id: string }) {
  try {
    return await db
      .select()
      .from(message)
      .where(eq(message.chatId, id))
      .orderBy(asc(message.createdAt));
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get messages by chat id"
    );
  }
}

export async function voteMessage({
  chatId,
  messageId,
  type,
}: {
  chatId: string;
  messageId: string;
  type: "up" | "down";
}) {
  try {
    const [existingVote] = await db
      .select()
      .from(vote)
      .where(and(eq(vote.messageId, messageId)));

    if (existingVote) {
      return await db
        .update(vote)
        .set({ isUpvoted: type === "up" })
        .where(and(eq(vote.messageId, messageId), eq(vote.chatId, chatId)));
    }
    return await db.insert(vote).values({
      chatId,
      messageId,
      isUpvoted: type === "up",
    });
  } catch (_error) {
    throw new ChatSDKError("bad_request:database", "Failed to vote message");
  }
}

export async function getVotesByChatId({ id }: { id: string }) {
  try {
    return await db.select().from(vote).where(eq(vote.chatId, id));
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get votes by chat id"
    );
  }
}

export async function saveDocument({
  id,
  title,
  kind,
  content,
  userId,
  chatId,
}: {
  id: string;
  title: string;
  kind: ArtifactKind;
  content: string;
  userId: string;
  chatId?: string;
}) {
  try {
    return await db
      .insert(document)
      .values({
        id,
        title,
        kind,
        content,
        userId,
        chatId,
        createdAt: new Date(),
      })
      .returning();
  } catch (_error) {
    throw new ChatSDKError("bad_request:database", "Failed to save document");
  }
}

export async function getDocumentsById({ id }: { id: string }) {
  try {
    const documents = await db
      .select()
      .from(document)
      .where(eq(document.id, id))
      .orderBy(asc(document.createdAt));

    return documents;
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get documents by id"
    );
  }
}

export async function getDocumentById({ id }: { id: string }) {
  try {
    const [selectedDocument] = await db
      .select()
      .from(document)
      .where(eq(document.id, id))
      .orderBy(desc(document.createdAt));

    return selectedDocument;
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get document by id"
    );
  }
}

export async function getDocumentsByChatId({
  chatId,
  kind,
}: {
  chatId: string;
  kind?: string;
}) {
  try {
    const conditions = [eq(document.chatId, chatId)];
    if (kind) {
      conditions.push(eq(document.kind, kind as ArtifactKind));
    }

    const documents = await db
      .select({
        id: document.id,
        title: document.title,
        kind: document.kind,
        createdAt: document.createdAt,
      })
      .from(document)
      .where(and(...conditions))
      .orderBy(desc(document.createdAt));

    return documents;
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get documents by chat id"
    );
  }
}

export async function deleteDocumentsByIdAfterTimestamp({
  id,
  timestamp,
}: {
  id: string;
  timestamp: Date;
}) {
  try {
    await db
      .delete(suggestion)
      .where(
        and(
          eq(suggestion.documentId, id),
          gt(suggestion.documentCreatedAt, timestamp)
        )
      );

    return await db
      .delete(document)
      .where(and(eq(document.id, id), gt(document.createdAt, timestamp)))
      .returning();
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to delete documents by id after timestamp"
    );
  }
}

export async function saveSuggestions({
  suggestions,
}: {
  suggestions: Suggestion[];
}) {
  try {
    return await db.insert(suggestion).values(suggestions);
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to save suggestions"
    );
  }
}

export async function getSuggestionsByDocumentId({
  documentId,
}: {
  documentId: string;
}) {
  try {
    return await db
      .select()
      .from(suggestion)
      .where(eq(suggestion.documentId, documentId));
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get suggestions by document id"
    );
  }
}

export async function getMessageById({ id }: { id: string }) {
  try {
    return await db.select().from(message).where(eq(message.id, id));
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get message by id"
    );
  }
}

export async function deleteMessagesByChatIdAfterTimestamp({
  chatId,
  timestamp,
}: {
  chatId: string;
  timestamp: Date;
}) {
  try {
    const messagesToDelete = await db
      .select({ id: message.id })
      .from(message)
      .where(
        and(eq(message.chatId, chatId), gte(message.createdAt, timestamp))
      );

    const messageIds = messagesToDelete.map(
      (currentMessage) => currentMessage.id
    );

    if (messageIds.length > 0) {
      await db
        .delete(vote)
        .where(
          and(eq(vote.chatId, chatId), inArray(vote.messageId, messageIds))
        );

      return await db
        .delete(message)
        .where(
          and(eq(message.chatId, chatId), inArray(message.id, messageIds))
        );
    }
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to delete messages by chat id after timestamp"
    );
  }
}

export async function updateChatVisibilityById({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: "private" | "public";
}) {
  try {
    return await db.update(chat).set({ visibility }).where(eq(chat.id, chatId));
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to update chat visibility by id"
    );
  }
}

export async function updateChatTitleById({
  chatId,
  title,
}: {
  chatId: string;
  title: string;
}) {
  try {
    return await db.update(chat).set({ title }).where(eq(chat.id, chatId));
  } catch (error) {
    console.warn("Failed to update title for chat", chatId, error);
    return;
  }
}

export async function getMessageCountByUserId({
  id,
  differenceInHours,
}: {
  id: string;
  differenceInHours: number;
}) {
  try {
    const twentyFourHoursAgo = new Date(
      Date.now() - differenceInHours * 60 * 60 * 1000
    );

    const [stats] = await db
      .select({ count: count(message.id) })
      .from(message)
      .innerJoin(chat, eq(message.chatId, chat.id))
      .where(
        and(
          eq(chat.userId, id),
          gte(message.createdAt, twentyFourHoursAgo),
          eq(message.role, "user")
        )
      )
      .execute();

    return stats?.count ?? 0;
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get message count by user id"
    );
  }
}

export async function createStreamId({
  streamId,
  chatId,
}: {
  streamId: string;
  chatId: string;
}) {
  try {
    await db
      .insert(stream)
      .values({ id: streamId, chatId, createdAt: new Date() });
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to create stream id"
    );
  }
}

export async function getStreamIdsByChatId({ chatId }: { chatId: string }) {
  try {
    const streamIds = await db
      .select({ id: stream.id })
      .from(stream)
      .where(eq(stream.chatId, chatId))
      .orderBy(asc(stream.createdAt))
      .execute();

    return streamIds.map(({ id }) => id);
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get stream ids by chat id"
    );
  }
}

// ============================================================================
// DSM-5 Session Functions
// ============================================================================

export async function createDsmSession({
  chatId,
  diagnosticMode = "diagnostic",
  sessionMeta,
  questionState,
  riskFlags,
}: {
  chatId: string;
  diagnosticMode?: DiagnosticMode;
  sessionMeta: SessionMeta;
  questionState: QuestionState;
  riskFlags: RiskFlags;
}): Promise<DsmSession> {
  try {
    const [session] = await db
      .insert(dsmSession)
      .values({
        chatId,
        diagnosticMode,
        sessionMeta,
        questionState,
        riskFlags,
        transcript: [],
        symptomSummary: [],
      })
      .returning();

    return session;
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to create DSM session"
    );
  }
}

export async function getDsmSessionByChatId({
  chatId,
}: {
  chatId: string;
}): Promise<DsmSession | null> {
  try {
    const [session] = await db
      .select()
      .from(dsmSession)
      .where(eq(dsmSession.chatId, chatId));

    return session ?? null;
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get DSM session by chat id"
    );
  }
}

export async function getDsmSessionById({
  id,
}: {
  id: string;
}): Promise<DsmSession | null> {
  try {
    const [session] = await db
      .select()
      .from(dsmSession)
      .where(eq(dsmSession.id, id));

    return session ?? null;
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get DSM session by id"
    );
  }
}

export async function updateDsmSession({
  chatId,
  patch,
}: {
  chatId: string;
  patch: {
    sessionStatus?: "active" | "completed" | "terminated_for_safety";
    diagnosticMode?: DiagnosticMode;
    transcript?: TranscriptEntry[];
    symptomSummary?: SymptomDomain[];
    riskFlags?: RiskFlags;
    questionState?: QuestionState;
    completedAt?: Date;
  };
}): Promise<DsmSession | null> {
  try {
    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (patch.sessionStatus !== undefined) {
      updateData.sessionStatus = patch.sessionStatus;
    }
    if (patch.diagnosticMode !== undefined) {
      updateData.diagnosticMode = patch.diagnosticMode;
    }
    if (patch.transcript !== undefined) {
      updateData.transcript = patch.transcript;
    }
    if (patch.symptomSummary !== undefined) {
      updateData.symptomSummary = patch.symptomSummary;
    }
    if (patch.riskFlags !== undefined) {
      updateData.riskFlags = patch.riskFlags;
    }
    if (patch.questionState !== undefined) {
      updateData.questionState = patch.questionState;
    }
    if (patch.completedAt !== undefined) {
      updateData.completedAt = patch.completedAt;
    }

    const [updated] = await db
      .update(dsmSession)
      .set(updateData)
      .where(eq(dsmSession.chatId, chatId))
      .returning();

    return updated ?? null;
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to update DSM session"
    );
  }
}

export async function appendToTranscript({
  chatId,
  entry,
}: {
  chatId: string;
  entry: TranscriptEntry;
}): Promise<DsmSession | null> {
  try {
    // Get current session to append to transcript
    const session = await getDsmSessionByChatId({ chatId });
    if (!session) {
      return null;
    }

    const currentTranscript = (session.transcript as TranscriptEntry[]) || [];
    const newTranscript = [...currentTranscript, entry];

    const [updated] = await db
      .update(dsmSession)
      .set({
        transcript: newTranscript,
        updatedAt: new Date(),
      })
      .where(eq(dsmSession.chatId, chatId))
      .returning();

    return updated ?? null;
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to append to transcript"
    );
  }
}

export async function upsertItemResponse({
  sessionId,
  itemId,
  score,
  ambiguity,
  evidenceQuotes,
  evidence,
  confidence,
}: {
  sessionId: string;
  itemId: string;
  score: number;
  ambiguity: number;
  evidenceQuotes: string[];
  evidence?: {
    type: "direct_span" | "inferred" | "none";
    messageIndex: number;
    spans: Array<{ start: number; end: number }>;
    strength: number;
    summary?: string;
  };
  confidence?: number;
}): Promise<DsmItemResponse> {
  try {
    // Check if response exists
    const [existing] = await db
      .select()
      .from(dsmItemResponse)
      .where(
        and(
          eq(dsmItemResponse.sessionId, sessionId),
          eq(dsmItemResponse.itemId, itemId)
        )
      );

    if (existing) {
      // Update existing response
      const [updated] = await db
        .update(dsmItemResponse)
        .set({
          score,
          ambiguity,
          evidenceQuotes,
          evidence,
          confidence: confidence ?? null,
        })
        .where(eq(dsmItemResponse.id, existing.id))
        .returning();

      return updated;
    }

    // Create new response
    const [created] = await db
      .insert(dsmItemResponse)
      .values({
        sessionId,
        itemId,
        score,
        ambiguity,
        evidenceQuotes,
        evidence,
        confidence: confidence ?? null,
      })
      .returning();

    return created;
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to upsert item response"
    );
  }
}

export async function getItemResponsesBySessionId({
  sessionId,
}: {
  sessionId: string;
}): Promise<DsmItemResponse[]> {
  try {
    return await db
      .select()
      .from(dsmItemResponse)
      .where(eq(dsmItemResponse.sessionId, sessionId))
      .orderBy(asc(dsmItemResponse.createdAt));
  } catch (error) {
    console.error("getItemResponsesBySessionId error:", error);
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get item responses by session id"
    );
  }
}

export async function deleteDsmSessionByChatId({
  chatId,
}: {
  chatId: string;
}): Promise<void> {
  try {
    // Item responses will be cascaded due to foreign key constraint
    await db.delete(dsmSession).where(eq(dsmSession.chatId, chatId));
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to delete DSM session"
    );
  }
}

// ============================================================================
// Question State Management Functions
// ============================================================================

export async function markItemAsCompleted({
  chatId,
  itemId,
}: {
  chatId: string;
  itemId: string;
}): Promise<DsmSession | null> {
  try {
    const session = await getDsmSessionByChatId({ chatId });
    if (!session) {
      return null;
    }

    const questionState = session.questionState as QuestionState;

    // Remove from pending, add to completed
    const updatedPending = questionState.pendingItems.filter(
      (id) => id !== itemId
    );
    const updatedCompleted = questionState.completedItems.includes(itemId)
      ? questionState.completedItems
      : [...questionState.completedItems, itemId];

    const updatedQuestionState: QuestionState = {
      ...questionState,
      pendingItems: updatedPending,
      completedItems: updatedCompleted,
    };

    return await updateDsmSession({
      chatId,
      patch: { questionState: updatedQuestionState },
    });
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to mark item as completed"
    );
  }
}

export async function markFollowUpUsed({
  chatId,
  itemId,
}: {
  chatId: string;
  itemId: string;
}): Promise<DsmSession | null> {
  try {
    const session = await getDsmSessionByChatId({ chatId });
    if (!session) {
      return null;
    }

    const questionState = session.questionState as QuestionState;
    const followUpUsedItems = questionState.followUpUsedItems ?? [];

    if (followUpUsedItems.includes(itemId)) {
      return session; // Already marked
    }

    const updatedQuestionState: QuestionState = {
      ...questionState,
      followUpUsedItems: [...followUpUsedItems, itemId],
    };

    return await updateDsmSession({
      chatId,
      patch: { questionState: updatedQuestionState },
    });
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to mark follow-up as used"
    );
  }
}

export async function updateAgentState({
  chatId,
  state,
  currentItemId,
  isFollowUp,
}: {
  chatId: string;
  state: string;
  currentItemId?: string | null;
  isFollowUp?: boolean;
}): Promise<DsmSession | null> {
  try {
    const session = await getDsmSessionByChatId({ chatId });
    if (!session) {
      return null;
    }

    const questionState = session.questionState as QuestionState;

    const updatedQuestionState: QuestionState = {
      ...questionState,
      currentState: state as QuestionState["currentState"],
      ...(currentItemId !== undefined && { currentItemId }),
      ...(isFollowUp !== undefined && { isFollowUp }),
    };

    return await updateDsmSession({
      chatId,
      patch: { questionState: updatedQuestionState },
    });
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to update agent state"
    );
  }
}

export async function triggerSafetyStop({
  chatId,
}: {
  chatId: string;
}): Promise<DsmSession | null> {
  try {
    const session = await getDsmSessionByChatId({ chatId });
    if (!session) {
      return null;
    }

    const questionState = session.questionState as QuestionState;

    const updatedQuestionState: QuestionState = {
      ...questionState,
      currentState: "SAFETY_STOP",
    };

    return await updateDsmSession({
      chatId,
      patch: {
        questionState: updatedQuestionState,
        sessionStatus: "terminated_for_safety",
      },
    });
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to trigger safety stop"
    );
  }
}

export async function getItemScoresBySessionId({
  sessionId,
}: {
  sessionId: string;
}): Promise<Map<string, number>> {
  try {
    const responses = await getItemResponsesBySessionId({ sessionId });
    const scoreMap = new Map<string, number>();

    for (const response of responses) {
      scoreMap.set(response.itemId, response.score);
    }

    return scoreMap;
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get item scores by session id"
    );
  }
}

// ============================================================================
// Benchmark Snapshot Queries
// ============================================================================

/**
 * Creates a new benchmark snapshot with SHA256 hash for integrity verification
 */
export async function createBenchmarkSnapshot({
  chatId,
  payload,
  hash,
}: {
  chatId: string;
  payload: Snapshot;
  hash: string;
}): Promise<BenchmarkSnapshot> {
  try {
    const [snapshot] = await db
      .insert(benchmarkSnapshot)
      .values({
        chatId,
        payload,
        hash,
      })
      .returning();

    return snapshot;
  } catch (error) {
    console.error("createBenchmarkSnapshot error:", error);
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to create benchmark snapshot"
    );
  }
}

/**
 * Gets the latest benchmark snapshot for a chat
 */
export async function getBenchmarkSnapshotByChat({
  chatId,
}: {
  chatId: string;
}): Promise<BenchmarkSnapshot | null> {
  try {
    const [snapshot] = await db
      .select()
      .from(benchmarkSnapshot)
      .where(eq(benchmarkSnapshot.chatId, chatId))
      .orderBy(desc(benchmarkSnapshot.createdAt))
      .limit(1);

    return snapshot ?? null;
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get benchmark snapshot"
    );
  }
}

/**
 * Gets a benchmark snapshot by ID
 */
export async function getBenchmarkSnapshotById({
  id,
}: {
  id: string;
}): Promise<BenchmarkSnapshot | null> {
  try {
    const [snapshot] = await db
      .select()
      .from(benchmarkSnapshot)
      .where(eq(benchmarkSnapshot.id, id))
      .limit(1);

    return snapshot ?? null;
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get benchmark snapshot by id"
    );
  }
}

// ============================================================================
// Benchmark Run Queries
// ============================================================================

/**
 * Creates a new benchmark run
 */
export async function createBenchmarkRun({
  chatId,
  snapshotId,
  config,
}: {
  chatId: string;
  snapshotId: string;
  config: BenchmarkConfig;
}): Promise<BenchmarkRun> {
  try {
    const [run] = await db
      .insert(benchmarkRun)
      .values({
        chatId,
        snapshotId,
        config,
        status: "pending",
      })
      .returning();

    return run;
  } catch (error) {
    console.error("createBenchmarkRun error:", error);
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to create benchmark run"
    );
  }
}

/**
 * Updates a benchmark run with new metrics or status
 */
export async function updateBenchmarkRun({
  runId,
  patch,
}: {
  runId: string;
  patch: {
    status?: "pending" | "running" | "completed" | "failed";
    metricsDeterministic?: DeterministicMetrics;
    metricsText?: TextMetrics;
    metricsRag?: RagMetrics;
    judgeResult?: JudgeResult;
    comparisons?: ModelComparison[];
    errorMessage?: string;
    completedAt?: Date;
  };
}): Promise<BenchmarkRun> {
  try {
    const [run] = await db
      .update(benchmarkRun)
      .set(patch)
      .where(eq(benchmarkRun.id, runId))
      .returning();

    return run;
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to update benchmark run"
    );
  }
}

/**
 * Gets a benchmark run by ID
 */
export async function getBenchmarkRunById({
  id,
}: {
  id: string;
}): Promise<BenchmarkRun | null> {
  try {
    const [run] = await db
      .select()
      .from(benchmarkRun)
      .where(eq(benchmarkRun.id, id))
      .limit(1);

    return run ?? null;
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get benchmark run by id"
    );
  }
}

/**
 * Gets all benchmark runs for a chat
 */
export async function getBenchmarkRunsByChat({
  chatId,
}: {
  chatId: string;
}): Promise<BenchmarkRun[]> {
  try {
    return await db
      .select()
      .from(benchmarkRun)
      .where(eq(benchmarkRun.chatId, chatId))
      .orderBy(desc(benchmarkRun.createdAt));
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get benchmark runs for chat"
    );
  }
}

/**
 * Gets the latest benchmark run for a chat
 */
export async function getLatestBenchmarkRun({
  chatId,
}: {
  chatId: string;
}): Promise<BenchmarkRun | null> {
  try {
    const [run] = await db
      .select()
      .from(benchmarkRun)
      .where(eq(benchmarkRun.chatId, chatId))
      .orderBy(desc(benchmarkRun.createdAt))
      .limit(1);

    return run ?? null;
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get latest benchmark run"
    );
  }
}
