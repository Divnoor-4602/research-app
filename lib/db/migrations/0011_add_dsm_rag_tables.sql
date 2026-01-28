-- Enable pgvector extension for vector similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- DSM Source table - tracks ingested PDFs
CREATE TABLE IF NOT EXISTS "DsmSource" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "version" text NOT NULL,
  "checksum" text NOT NULL,
  "status" varchar DEFAULT 'pending' NOT NULL,
  "totalChunks" integer,
  "errorMessage" text,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "completedAt" timestamp
);

-- DSM Chunk table - stores text chunks with embeddings
CREATE TABLE IF NOT EXISTS "DsmChunk" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "sourceId" uuid NOT NULL REFERENCES "DsmSource"("id") ON DELETE CASCADE,
  "chunkIndex" integer NOT NULL,
  "content" text NOT NULL,
  "embedding" vector(1536),
  "page" integer,
  "sectionPath" text,
  "headingLevel" integer,
  "tokenCount" integer NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

-- Create index on sourceId for efficient lookups
CREATE INDEX IF NOT EXISTS "dsm_chunk_source_idx" ON "DsmChunk" ("sourceId");

-- Create pgvector index for cosine similarity search
-- Using ivfflat for good balance of speed and accuracy
CREATE INDEX IF NOT EXISTS "dsm_chunk_embedding_idx" ON "DsmChunk" 
  USING ivfflat ("embedding" vector_cosine_ops)
  WITH (lists = 100);
