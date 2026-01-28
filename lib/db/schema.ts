import type { InferSelectModel } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  index,
  integer,
  json,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uuid,
  varchar,
  vector,
} from "drizzle-orm/pg-core";

export const user = pgTable("User", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  email: varchar("email", { length: 64 }).notNull(),
  password: varchar("password", { length: 64 }),
});

export type User = InferSelectModel<typeof user>;

export const chat = pgTable("Chat", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  createdAt: timestamp("createdAt").notNull(),
  title: text("title").notNull(),
  userId: uuid("userId")
    .notNull()
    .references(() => user.id),
  visibility: varchar("visibility", { enum: ["public", "private"] })
    .notNull()
    .default("private"),
});

export type Chat = InferSelectModel<typeof chat>;

// DEPRECATED: The following schema is deprecated and will be removed in the future.
// Read the migration guide at https://chat-sdk.dev/docs/migration-guides/message-parts
export const messageDeprecated = pgTable("Message", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  chatId: uuid("chatId")
    .notNull()
    .references(() => chat.id),
  role: varchar("role").notNull(),
  content: json("content").notNull(),
  createdAt: timestamp("createdAt").notNull(),
});

export type MessageDeprecated = InferSelectModel<typeof messageDeprecated>;

export const message = pgTable("Message_v2", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  chatId: uuid("chatId")
    .notNull()
    .references(() => chat.id),
  role: varchar("role").notNull(),
  parts: json("parts").notNull(),
  attachments: json("attachments").notNull(),
  createdAt: timestamp("createdAt").notNull(),
});

export type DBMessage = InferSelectModel<typeof message>;

// DEPRECATED: The following schema is deprecated and will be removed in the future.
// Read the migration guide at https://chat-sdk.dev/docs/migration-guides/message-parts
export const voteDeprecated = pgTable(
  "Vote",
  {
    chatId: uuid("chatId")
      .notNull()
      .references(() => chat.id),
    messageId: uuid("messageId")
      .notNull()
      .references(() => messageDeprecated.id),
    isUpvoted: boolean("isUpvoted").notNull(),
  },
  (table) => {
    return {
      pk: primaryKey({ columns: [table.chatId, table.messageId] }),
    };
  }
);

export type VoteDeprecated = InferSelectModel<typeof voteDeprecated>;

export const vote = pgTable(
  "Vote_v2",
  {
    chatId: uuid("chatId")
      .notNull()
      .references(() => chat.id),
    messageId: uuid("messageId")
      .notNull()
      .references(() => message.id),
    isUpvoted: boolean("isUpvoted").notNull(),
  },
  (table) => {
    return {
      pk: primaryKey({ columns: [table.chatId, table.messageId] }),
    };
  }
);

export type Vote = InferSelectModel<typeof vote>;

export const document = pgTable(
  "Document",
  {
    id: uuid("id").notNull().defaultRandom(),
    createdAt: timestamp("createdAt").notNull(),
    title: text("title").notNull(),
    content: text("content"),
    kind: varchar("text", {
      enum: ["text", "code", "image", "sheet", "report"],
    })
      .notNull()
      .default("text"),
    userId: uuid("userId")
      .notNull()
      .references(() => user.id),
    chatId: uuid("chatId").references(() => chat.id),
  },
  (table) => {
    return {
      pk: primaryKey({ columns: [table.id, table.createdAt] }),
    };
  }
);

export type Document = InferSelectModel<typeof document>;

export const suggestion = pgTable(
  "Suggestion",
  {
    id: uuid("id").notNull().defaultRandom(),
    documentId: uuid("documentId").notNull(),
    documentCreatedAt: timestamp("documentCreatedAt").notNull(),
    originalText: text("originalText").notNull(),
    suggestedText: text("suggestedText").notNull(),
    description: text("description"),
    isResolved: boolean("isResolved").notNull().default(false),
    userId: uuid("userId")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("createdAt").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.id] }),
    documentRef: foreignKey({
      columns: [table.documentId, table.documentCreatedAt],
      foreignColumns: [document.id, document.createdAt],
    }),
  })
);

export type Suggestion = InferSelectModel<typeof suggestion>;

export const stream = pgTable(
  "Stream",
  {
    id: uuid("id").notNull().defaultRandom(),
    chatId: uuid("chatId").notNull(),
    createdAt: timestamp("createdAt").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.id] }),
    chatRef: foreignKey({
      columns: [table.chatId],
      foreignColumns: [chat.id],
    }),
  })
);

export type Stream = InferSelectModel<typeof stream>;

// ============================================================================
// DSM-5 Session Tables
// ============================================================================

export const dsmSession = pgTable("DsmSession", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  chatId: uuid("chatId")
    .notNull()
    .unique()
    .references(() => chat.id, { onDelete: "cascade" }),
  sessionStatus: varchar("sessionStatus", {
    enum: ["active", "completed", "terminated_for_safety"],
  })
    .notNull()
    .default("active"),
  diagnosticMode: varchar("diagnosticMode", {
    enum: ["screening", "categorical", "diagnostic"],
  })
    .notNull()
    .default("diagnostic"),
  transcript: json("transcript").notNull().default([]),
  symptomSummary: json("symptomSummary").notNull().default([]),
  riskFlags: json("riskFlags").notNull(),
  questionState: json("questionState").notNull(),
  sessionMeta: json("sessionMeta").notNull(),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
});

export type DsmSession = InferSelectModel<typeof dsmSession>;

export const dsmItemResponse = pgTable("DsmItemResponse", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  sessionId: uuid("sessionId")
    .notNull()
    .references(() => dsmSession.id, { onDelete: "cascade" }),
  itemId: varchar("itemId", { length: 16 }).notNull(),
  score: integer("score").notNull(),
  ambiguity: integer("ambiguity").notNull(),
  evidenceQuotes: json("evidenceQuotes").notNull().default([]),
  evidence: json("evidence"),
  confidence: real("confidence"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
});

export type DsmItemResponse = InferSelectModel<typeof dsmItemResponse>;

// ============================================================================
// DSM-5 RAG Tables (pgvector)
// ============================================================================

/**
 * Tracks ingested DSM source documents (PDFs)
 */
export const dsmSource = pgTable("DsmSource", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  name: text("name").notNull(), // e.g., "DSM-5-TR"
  version: text("version").notNull(), // e.g., "2022"
  checksum: text("checksum").notNull(), // SHA-256 hash of PDF
  status: varchar("status", {
    enum: ["pending", "ingesting", "completed", "failed"],
  })
    .notNull()
    .default("pending"),
  totalChunks: integer("totalChunks"),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  completedAt: timestamp("completedAt"),
});

export type DsmSource = InferSelectModel<typeof dsmSource>;

/**
 * Stores DSM text chunks with embeddings for vector similarity search
 */
export const dsmChunk = pgTable(
  "DsmChunk",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    sourceId: uuid("sourceId")
      .notNull()
      .references(() => dsmSource.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunkIndex").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }), // OpenAI text-embedding-3-small
    // Metadata for citation display
    page: integer("page"), // Approximate page number
    sectionPath: text("sectionPath"), // e.g., "Depressive Disorders > MDD > Criteria"
    headingLevel: integer("headingLevel"), // 1-4 if heading-aware chunking
    tokenCount: integer("tokenCount").notNull(),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (table) => ({
    sourceIdx: index("dsm_chunk_source_idx").on(table.sourceId),
    // Note: pgvector index created in migration with specific operator class
  })
);

export type DsmChunk = InferSelectModel<typeof dsmChunk>;

// ============================================================================
// Benchmark Tables
// ============================================================================

/**
 * Stores frozen snapshots of completed DSM sessions for benchmarking
 * Snapshot is immutable once created - allows reproducible benchmarks
 */
export const benchmarkSnapshot = pgTable(
  "BenchmarkSnapshot",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    chatId: uuid("chatId")
      .notNull()
      .references(() => chat.id, { onDelete: "cascade" }),
    hash: text("hash").notNull(), // SHA256 of canonical JSON payload
    payload: json("payload").notNull(), // Full snapshot JSON (transcript, itemResponses, etc.)
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (table) => ({
    chatIdx: index("benchmark_snapshot_chat_idx").on(table.chatId),
  })
);

export type BenchmarkSnapshot = InferSelectModel<typeof benchmarkSnapshot>;

/**
 * Stores benchmark run results including all computed metrics
 */
export const benchmarkRun = pgTable(
  "BenchmarkRun",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    chatId: uuid("chatId")
      .notNull()
      .references(() => chat.id, { onDelete: "cascade" }),
    snapshotId: uuid("snapshotId")
      .notNull()
      .references(() => benchmarkSnapshot.id, { onDelete: "cascade" }),
    config: json("config").notNull(), // BenchmarkConfig: ragMode, diagnosticMode, compareModels
    status: varchar("status", {
      enum: ["pending", "running", "completed", "failed"],
    })
      .notNull()
      .default("pending"),
    metricsDeterministic: json("metricsDeterministic"), // DeterministicMetrics
    metricsText: json("metricsText"), // TextMetrics
    metricsRag: json("metricsRag"), // RagMetrics
    judgeResult: json("judgeResult"), // JudgeResult
    comparisons: json("comparisons"), // ModelComparison[]
    errorMessage: text("errorMessage"), // Error message if failed
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    completedAt: timestamp("completedAt"),
  },
  (table) => ({
    chatIdx: index("benchmark_run_chat_idx").on(table.chatId),
    snapshotIdx: index("benchmark_run_snapshot_idx").on(table.snapshotId),
  })
);

export type BenchmarkRun = InferSelectModel<typeof benchmarkRun>;
