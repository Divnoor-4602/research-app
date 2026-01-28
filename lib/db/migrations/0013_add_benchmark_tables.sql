-- Benchmark Snapshot table - stores frozen snapshots for reproducible evaluation
CREATE TABLE IF NOT EXISTS "BenchmarkSnapshot" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "chatId" uuid NOT NULL REFERENCES "Chat"("id") ON DELETE CASCADE,
  "hash" text NOT NULL,
  "payload" jsonb NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

-- Create index on chatId for efficient lookups
CREATE INDEX IF NOT EXISTS "benchmark_snapshot_chat_idx" ON "BenchmarkSnapshot" ("chatId");

-- Benchmark Run table - stores benchmark execution results
CREATE TABLE IF NOT EXISTS "BenchmarkRun" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "chatId" uuid NOT NULL REFERENCES "Chat"("id") ON DELETE CASCADE,
  "snapshotId" uuid NOT NULL REFERENCES "BenchmarkSnapshot"("id") ON DELETE CASCADE,
  "config" jsonb NOT NULL,
  "status" varchar DEFAULT 'pending' NOT NULL,
  "metricsDeterministic" jsonb,
  "metricsText" jsonb,
  "metricsRag" jsonb,
  "judgeResult" jsonb,
  "comparisons" jsonb,
  "errorMessage" text,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "completedAt" timestamp
);

-- Create indexes for efficient lookups
CREATE INDEX IF NOT EXISTS "benchmark_run_chat_idx" ON "BenchmarkRun" ("chatId");
CREATE INDEX IF NOT EXISTS "benchmark_run_snapshot_idx" ON "BenchmarkRun" ("snapshotId");

-- Add comments for documentation
COMMENT ON TABLE "BenchmarkSnapshot" IS 'Frozen snapshots of DSM sessions for reproducible benchmarking';
COMMENT ON COLUMN "BenchmarkSnapshot"."hash" IS 'SHA256 hash of canonical JSON payload for integrity verification';
COMMENT ON COLUMN "BenchmarkSnapshot"."payload" IS 'Full snapshot: transcript, itemResponses, domainSummary, riskFlags, report, versions, models';

COMMENT ON TABLE "BenchmarkRun" IS 'Benchmark execution results with all computed metrics';
COMMENT ON COLUMN "BenchmarkRun"."config" IS 'BenchmarkConfig: ragMode, diagnosticMode, compareModels';
COMMENT ON COLUMN "BenchmarkRun"."metricsDeterministic" IS 'Coverage, evidence, safety metrics with PASS/WARN/FAIL status';
COMMENT ON COLUMN "BenchmarkRun"."metricsText" IS 'Readability (FRE/FKG/GFI), coherence, duplication metrics';
COMMENT ON COLUMN "BenchmarkRun"."metricsRag" IS 'Context precision, domain coverage, phantom rate, grounding metrics';
COMMENT ON COLUMN "BenchmarkRun"."judgeResult" IS 'LLM judge rubric scores (1-5) and feedback';
COMMENT ON COLUMN "BenchmarkRun"."comparisons" IS 'Multi-model comparison: Jaccard, Spearman, confidence drift';
