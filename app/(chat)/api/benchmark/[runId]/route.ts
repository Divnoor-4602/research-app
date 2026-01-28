import { auth } from "@/app/(auth)/auth";
import {
  getBenchmarkRunById,
  getBenchmarkSnapshotById,
  getChatById,
} from "@/lib/db/queries";
import type {
  BenchmarkConfig,
  DeterministicMetrics,
  JudgeResult,
  ModelComparison,
  RagMetrics,
  Snapshot,
  TextMetrics,
} from "@/lib/dsm5/benchmark-schemas";
import { ChatSDKError } from "@/lib/errors";

// ============================================================================
// GET - Fetch benchmark run by ID
// ============================================================================

export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params;

    // 1. Auth check
    const session = await auth();
    if (!session?.user) {
      return new ChatSDKError("unauthorized:chat").toResponse();
    }

    // 2. Get benchmark run
    const run = await getBenchmarkRunById({ id: runId });
    if (!run) {
      return new ChatSDKError(
        "not_found:database",
        "Benchmark run not found"
      ).toResponse();
    }

    // 3. Verify chat ownership
    const chat = await getChatById({ id: run.chatId });
    if (!chat) {
      return new ChatSDKError("not_found:chat").toResponse();
    }
    if (chat.userId !== session.user.id) {
      return new ChatSDKError("forbidden:chat").toResponse();
    }

    // 4. Get snapshot (optional, for detailed view)
    const snapshot = await getBenchmarkSnapshotById({ id: run.snapshotId });

    // 5. Build response
    const response = {
      runId: run.id,
      chatId: run.chatId,
      snapshotId: run.snapshotId,
      config: run.config as BenchmarkConfig,
      status: run.status,
      deterministic: run.metricsDeterministic as DeterministicMetrics | null,
      text: run.metricsText as TextMetrics | null,
      rag: run.metricsRag as RagMetrics | null,
      judge: run.judgeResult as JudgeResult | null,
      comparisons: run.comparisons as ModelComparison[] | null,
      errorMessage: run.errorMessage,
      createdAt: run.createdAt.toISOString(),
      completedAt: run.completedAt?.toISOString() ?? null,
      // Include snapshot summary if available
      snapshot: snapshot
        ? {
            hash: (snapshot.payload as Snapshot).hash,
            itemCount: (snapshot.payload as Snapshot).itemResponses.length,
            transcriptLength: (snapshot.payload as Snapshot).transcript.length,
            sessionStatus: (snapshot.payload as Snapshot).sessionStatus,
          }
        : null,
    };

    return Response.json(response);
  } catch (error) {
    console.error("Get benchmark run error:", error);
    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }
    return Response.json(
      { error: "Failed to get benchmark run" },
      { status: 500 }
    );
  }
}
