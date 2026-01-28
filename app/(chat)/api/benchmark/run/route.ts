import { createHash } from "node:crypto";
import { auth } from "@/app/(auth)/auth";
import {
  type Snapshot,
  runBenchmarkInputSchema,
} from "@/lib/dsm5/benchmark-schemas";
import {
  computeCoherenceMetricsSafe,
  computeDeterministicMetrics,
  computeRagMetricsSafe,
  runLLMJudgeSafe,
  runModelComparisonSafe,
} from "@/lib/dsm5/benchmark";
import {
  computeDuplicationRate,
  computeReadabilityMetrics,
  extractInterviewerText,
  extractReportNarrative,
} from "@/lib/dsm5/benchmark/readability";
import {
  createBenchmarkRun,
  createBenchmarkSnapshot,
  getBenchmarkSnapshotByChat,
  getChatById,
  getDocumentById,
  getDsmSessionByChatId,
  getDocumentsByChatId,
  getItemResponsesBySessionId,
  updateBenchmarkRun,
} from "@/lib/db/queries";
import { DSM5_ITEM_REGISTRY_VERSION } from "@/lib/dsm5/items";
import type { ItemResponse, RiskFlags, SymptomDomain, TranscriptEntry } from "@/lib/dsm5/schemas";
import { ChatSDKError } from "@/lib/errors";

// ============================================================================
// Snapshot Creation
// ============================================================================

/**
 * Creates a SHA256 hash of the snapshot payload for integrity verification
 */
function computeSnapshotHash(payload: Omit<Snapshot, "snapshotId" | "hash">): string {
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Creates or retrieves a frozen snapshot for benchmarking
 * Returns both the snapshot data and the database record ID
 */
async function getOrCreateSnapshot(chatId: string): Promise<{
  snapshot: Snapshot;
  dbId: string;
}> {
  // Check for existing snapshot
  const existingSnapshot = await getBenchmarkSnapshotByChat({ chatId });
  if (existingSnapshot) {
    return {
      snapshot: existingSnapshot.payload as Snapshot,
      dbId: existingSnapshot.id,
    };
  }

  // Load session data
  const session = await getDsmSessionByChatId({ chatId });
  if (!session) {
    throw new ChatSDKError("not_found:database", "No DSM-5 session found for this chat");
  }

  // Load item responses
  const itemResponses = await getItemResponsesBySessionId({ sessionId: session.id });

  // Load report document
  const documents = await getDocumentsByChatId({ chatId });
  const reportDocMeta = documents.find((d) => d.kind === "report");
  let reportContent = "";
  if (reportDocMeta) {
    const fullDoc = await getDocumentById({ id: reportDocMeta.id });
    reportContent = fullDoc?.content ?? "";
  }

  // Build snapshot payload
  const payload: Omit<Snapshot, "snapshotId" | "hash"> = {
    chatId,
    transcript: (session.transcript as TranscriptEntry[]) ?? [],
    itemResponses: itemResponses.map((r) => ({
      itemId: r.itemId,
      score: r.score as 0 | 1 | 2 | 3 | 4,
      ambiguity: r.ambiguity,
      evidenceQuotes: (r.evidenceQuotes as string[]) ?? [],
      evidence: r.evidence as ItemResponse["evidence"],
      confidence: r.confidence ?? undefined,
    })),
    domainSummary: (session.symptomSummary as SymptomDomain[]) ?? [],
    riskFlags: session.riskFlags as RiskFlags,
    sessionStatus: session.sessionStatus as "active" | "completed" | "terminated_for_safety",
    report: reportContent,
    rag: undefined, // TODO: Include RAG data if available
    versions: {
      promptVersion: "1.0.0",
      toolVersion: "1.0.0",
      schemaVersion: DSM5_ITEM_REGISTRY_VERSION,
    },
    models: {
      interviewerModel: "openai/gpt-4o-mini", // TODO: Track actual model used
      scorerModel: "openai/gpt-4o-mini",
      diagnoserModel: "openai/gpt-4o-mini",
    },
    createdAt: new Date().toISOString(),
  };

  // Compute hash and create snapshot ID
  const hash = computeSnapshotHash(payload);
  const snapshotId = crypto.randomUUID();

  const fullSnapshot: Snapshot = {
    ...payload,
    snapshotId,
    hash,
  };

  // Persist snapshot and get the database-generated ID
  const dbRecord = await createBenchmarkSnapshot({
    chatId,
    payload: fullSnapshot,
    hash,
  });

  return {
    snapshot: fullSnapshot,
    dbId: dbRecord.id,
  };
}

// ============================================================================
// Main Benchmark Execution
// ============================================================================

export async function POST(request: Request) {
  try {
    // 1. Auth check
    const session = await auth();
    if (!session?.user) {
      return new ChatSDKError("unauthorized:chat").toResponse();
    }

    // 2. Parse and validate input
    const body = await request.json();
    const parseResult = runBenchmarkInputSchema.safeParse(body);
    if (!parseResult.success) {
      return new ChatSDKError(
        "bad_request:api",
        `Invalid input: ${parseResult.error.message}`
      ).toResponse();
    }

    const { chatId, compareModels, ragMode, diagnosticMode } = parseResult.data;

    // 3. Verify chat ownership
    const chat = await getChatById({ id: chatId });
    if (!chat) {
      return new ChatSDKError("not_found:chat").toResponse();
    }
    if (chat.userId !== session.user.id) {
      return new ChatSDKError("forbidden:chat").toResponse();
    }

    // 4. Get or create frozen snapshot
    const { snapshot, dbId: snapshotDbId } = await getOrCreateSnapshot(chatId);

    // 5. Create benchmark run record
    const run = await createBenchmarkRun({
      chatId,
      snapshotId: snapshotDbId, // Use the database-generated ID for the foreign key
      config: {
        ragMode,
        diagnosticMode,
        compareModels,
      },
    });

    // 6. Update status to running
    await updateBenchmarkRun({
      runId: run.id,
      patch: { status: "running" },
    });

    try {
      // 7. Compute deterministic metrics (FAIL-fast)
      const deterministic = computeDeterministicMetrics(snapshot);
      await updateBenchmarkRun({
        runId: run.id,
        patch: { metricsDeterministic: deterministic },
      });

      // Check for hard failures
      if (deterministic.status === "fail") {
        await updateBenchmarkRun({
          runId: run.id,
          patch: {
            status: "completed",
            completedAt: new Date(),
          },
        });

        return Response.json({
          runId: run.id,
          status: "fail",
          deterministic,
        });
      }

      // 8. Compute text metrics
      const interviewerText = extractInterviewerText(snapshot.transcript);
      const reportNarrative = extractReportNarrative(snapshot.report);
      const combinedText = `${interviewerText} ${reportNarrative}`;

      const readability = computeReadabilityMetrics(combinedText);
      const coherence = await computeCoherenceMetricsSafe(snapshot);
      const duplicationRate = computeDuplicationRate(combinedText);

      const textMetrics = {
        readability,
        coherence,
        duplicationRate,
      };

      await updateBenchmarkRun({
        runId: run.id,
        patch: { metricsText: textMetrics },
      });

      // 9. Compute RAG metrics (if applicable)
      const ragMetrics = ragMode !== "off" ? computeRagMetricsSafe(snapshot) : null;
      if (ragMetrics) {
        await updateBenchmarkRun({
          runId: run.id,
          patch: { metricsRag: ragMetrics },
        });
      }

      // 10. Run LLM judge
      const judgeResult = await runLLMJudgeSafe(snapshot);
      if (judgeResult) {
        await updateBenchmarkRun({
          runId: run.id,
          patch: { judgeResult },
        });
      }

      // 11. Multi-model comparison (if comparison models specified)
      let comparisons = null;
      if (compareModels.length > 0) {
        comparisons = await runModelComparisonSafe(
          snapshot,
          snapshot.models.diagnoserModel,
          compareModels,
          ragMode,
          diagnosticMode
        );
        if (comparisons.length > 0) {
          await updateBenchmarkRun({
            runId: run.id,
            patch: { comparisons },
          });
        }
      }

      // 12. Mark as completed
      await updateBenchmarkRun({
        runId: run.id,
        patch: {
          status: "completed",
          completedAt: new Date(),
        },
      });

      return Response.json({
        runId: run.id,
        status: "completed",
        deterministic,
        text: textMetrics,
        rag: ragMetrics,
        judge: judgeResult,
        comparisons,
      });
    } catch (error) {
      // Mark run as failed
      console.error("Benchmark execution error:", error);
      await updateBenchmarkRun({
        runId: run.id,
        patch: {
          status: "failed",
          errorMessage: error instanceof Error ? error.message : "Unknown error",
        },
      });

      return Response.json(
        {
          runId: run.id,
          status: "failed",
          error: "Benchmark execution failed",
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Benchmark run error:", error);
    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }
    return Response.json({ error: "Failed to run benchmark" }, { status: 500 });
  }
}
