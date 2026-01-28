#!/usr/bin/env tsx
/**
 * DSM-5 RAG Ingestion Script
 *
 * Reads a DSM-5 PDF, chunks it, generates embeddings, and stores in pgvector.
 *
 * Usage:
 *   pnpm ingest:dsm ./private/dsm5.pdf
 *
 * Environment:
 *   POSTGRES_URL - Database connection string
 *   OPENAI_API_KEY - OpenAI API key for embeddings
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import OpenAI from "openai";
import postgres from "postgres";
import { dsmChunk, dsmSource } from "../lib/db/schema";
import { extractAndChunkPdf } from "../lib/dsm5/chunker";
import { RAG_CONFIG } from "../lib/dsm5/rag-config";

// Load environment variables
config({ path: ".env.local" });

// ============================================================================
// Configuration
// ============================================================================

const POSTGRES_URL = process.env.POSTGRES_URL;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!POSTGRES_URL) {
  console.error("Error: POSTGRES_URL environment variable is required");
  process.exit(1);
}

if (!OPENAI_API_KEY) {
  console.error("Error: OPENAI_API_KEY environment variable is required");
  process.exit(1);
}

// ============================================================================
// Database Connection
// ============================================================================

const client = postgres(POSTGRES_URL);
const db = drizzle(client);

// ============================================================================
// OpenAI Client
// ============================================================================

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ============================================================================
// Embedding Generation
// ============================================================================

async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const response = await openai.embeddings.create({
    model: RAG_CONFIG.embedModel,
    input: texts,
  });

  return response.data.map((d) => d.embedding);
}

// ============================================================================
// Main Ingestion Logic
// ============================================================================

async function ingestPdf(pdfPath: string): Promise<void> {
  console.log("\n📚 DSM-5 RAG Ingestion Script\n");
  console.log(`📄 Reading PDF: ${pdfPath}`);

  // Read PDF file
  let pdfBuffer: Buffer;
  try {
    pdfBuffer = readFileSync(pdfPath);
  } catch (error) {
    console.error(`Error: Could not read file ${pdfPath}`);
    process.exit(1);
  }

  // Calculate checksum
  const checksum = createHash("sha256").update(pdfBuffer).digest("hex");
  console.log(`   Checksum: ${checksum.slice(0, 16)}...`);

  // Check if already ingested
  const existingSource = await db
    .select()
    .from(dsmSource)
    .where(eq(dsmSource.checksum, checksum))
    .limit(1);

  if (existingSource.length > 0 && existingSource[0].status === "completed") {
    console.log("\n✅ This PDF has already been ingested.");
    console.log(`   Source ID: ${existingSource[0].id}`);
    console.log(`   Chunks: ${existingSource[0].totalChunks}`);
    await client.end();
    return;
  }

  // Create or update source record
  let sourceId: string;
  if (existingSource.length > 0) {
    sourceId = existingSource[0].id;
    console.log("\n🔄 Resuming previous ingestion attempt...");
    // Delete any existing chunks for this source
    await db.delete(dsmChunk).where(eq(dsmChunk.sourceId, sourceId));
    await db
      .update(dsmSource)
      .set({ status: "ingesting", errorMessage: null })
      .where(eq(dsmSource.id, sourceId));
  } else {
    const [newSource] = await db
      .insert(dsmSource)
      .values({
        name: RAG_CONFIG.sourceName,
        version: RAG_CONFIG.sourceVersion,
        checksum,
        status: "ingesting",
      })
      .returning();
    sourceId = newSource.id;
    console.log(`\n📝 Created source record: ${sourceId}`);
  }

  try {
    // Extract and chunk PDF
    console.log("\n✂️  Chunking PDF...");
    const chunks = await extractAndChunkPdf(pdfBuffer);
    console.log(`   Created ${chunks.length} chunks`);

    // Update source with total chunks
    await db
      .update(dsmSource)
      .set({ totalChunks: chunks.length })
      .where(eq(dsmSource.id, sourceId));

    // Generate embeddings and insert in batches
    console.log("\n🧠 Generating embeddings...");
    const batchSize = RAG_CONFIG.embedBatchSize;
    let processed = 0;

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const texts = batch.map((c) => c.content);

      // Generate embeddings for batch
      const embeddings = await generateEmbeddings(texts);

      // Insert chunks with embeddings
      const insertValues = batch.map((chunk, idx) => ({
        sourceId,
        chunkIndex: chunk.metadata.chunkIndex,
        content: chunk.content,
        embedding: embeddings[idx],
        page: chunk.metadata.page,
        sectionPath: chunk.metadata.sectionPath,
        headingLevel: chunk.metadata.headingLevel,
        tokenCount: chunk.metadata.tokenCount,
      }));

      await db.insert(dsmChunk).values(insertValues);

      processed += batch.length;
      const percent = Math.round((processed / chunks.length) * 100);
      process.stdout.write(
        `\r   Progress: ${processed}/${chunks.length} (${percent}%)`
      );

      // Small delay to avoid rate limiting
      if (i + batchSize < chunks.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    console.log("\n");

    // Mark ingestion as complete
    await db
      .update(dsmSource)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(dsmSource.id, sourceId));

    console.log("✅ Ingestion complete!");
    console.log(`   Source ID: ${sourceId}`);
    console.log(`   Total chunks: ${chunks.length}`);
  } catch (error) {
    // Mark as failed
    const errorMessage = error instanceof Error ? error.message : String(error);
    await db
      .update(dsmSource)
      .set({ status: "failed", errorMessage })
      .where(eq(dsmSource.id, sourceId));

    console.error("\n❌ Ingestion failed:", errorMessage);
    throw error;
  } finally {
    await client.end();
  }
}

// ============================================================================
// CLI Entry Point
// ============================================================================

const pdfPath = process.argv[2];

if (!pdfPath) {
  console.error("Usage: pnpm ingest:dsm <path-to-pdf>");
  console.error("Example: pnpm ingest:dsm ./private/dsm5.pdf");
  process.exit(1);
}

ingestPdf(pdfPath).catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
