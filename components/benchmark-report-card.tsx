"use client";

import {
  AlertCircleIcon,
  CheckCircle2Icon,
  AlertTriangleIcon,
  XCircleIcon,
  InfoIcon,
  BarChart3Icon,
  Loader2Icon,
} from "lucide-react";
import useSWR from "swr";
import { cn } from "@/lib/utils";
import type {
  BenchmarkConfig,
  DeterministicMetrics,
  JudgeResult,
  ModelComparison,
  RagMetrics,
  TextMetrics,
} from "@/lib/dsm5/benchmark-schemas";
import { Badge } from "./ui/badge";
import { Progress } from "./ui/progress";
import { Separator } from "./ui/separator";

// ============================================================================
// Types
// ============================================================================

interface BenchmarkRunData {
  runId: string;
  chatId: string;
  snapshotId: string;
  config: BenchmarkConfig;
  status: "pending" | "running" | "completed" | "failed";
  deterministic: DeterministicMetrics | null;
  text: TextMetrics | null;
  rag: RagMetrics | null;
  judge: JudgeResult | null;
  comparisons: ModelComparison[] | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  snapshot: {
    hash: string;
    itemCount: number;
    transcriptLength: number;
    sessionStatus: string;
  } | null;
}

interface BenchmarkReportCardProps {
  runId: string;
  className?: string;
}

// ============================================================================
// Fetcher
// ============================================================================

const fetcher = (url: string) => fetch(url).then((res) => res.json());

// ============================================================================
// Status Badge Component
// ============================================================================

function StatusBadge({ status }: { status: "pass" | "warn" | "fail" | string }) {
  const variants = {
    pass: {
      variant: "default" as const,
      icon: CheckCircle2Icon,
      label: "PASS",
      className: "bg-green-500/10 text-green-600 border-green-500/20",
    },
    warn: {
      variant: "secondary" as const,
      icon: AlertTriangleIcon,
      label: "WARN",
      className: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
    },
    fail: {
      variant: "destructive" as const,
      icon: XCircleIcon,
      label: "FAIL",
      className: "bg-red-500/10 text-red-600 border-red-500/20",
    },
  };

  const config = variants[status as keyof typeof variants] ?? variants.warn;
  const Icon = config.icon;

  return (
    <Badge variant={config.variant} className={cn("gap-1", config.className)}>
      <Icon className="size-3" />
      {config.label}
    </Badge>
  );
}

// ============================================================================
// Metric Card Component
// ============================================================================

function MetricItem({
  label,
  value,
  description,
  status,
}: {
  label: string;
  value: string | number;
  description?: string;
  status?: "good" | "warning" | "bad" | "neutral";
}) {
  const statusColors = {
    good: "text-green-600",
    warning: "text-yellow-600",
    bad: "text-red-600",
    neutral: "text-muted-foreground",
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span
          className={cn(
            "font-medium",
            status ? statusColors[status] : "text-foreground"
          )}
        >
          {value}
        </span>
      </div>
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

// ============================================================================
// Coverage Section
// ============================================================================

function CoverageSection({ metrics }: { metrics: DeterministicMetrics["coverage"] }) {
  const coveragePercent = Math.round(metrics.rate * 100);
  const status = coveragePercent === 100 ? "good" : coveragePercent >= 80 ? "warning" : "bad";

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-medium flex items-center gap-2">
        Coverage
        <Badge variant="outline" className="text-xs">
          {metrics.completedItems.length}/23
        </Badge>
      </h4>
      <div className="space-y-2">
        <Progress value={coveragePercent} className="h-2" />
        <div className="grid grid-cols-2 gap-2 text-xs">
          <MetricItem
            label="Coverage Rate"
            value={`${coveragePercent}%`}
            status={status}
          />
          <MetricItem
            label="Missing Items"
            value={metrics.missingItems.length}
            status={metrics.missingItems.length === 0 ? "good" : "bad"}
          />
          <MetricItem
            label="Follow-up Violations"
            value={metrics.followupViolations}
            status={metrics.followupViolations === 0 ? "good" : "warning"}
          />
          <MetricItem
            label="Multi-question Turns"
            value={metrics.multiQuestionTurns}
            status={metrics.multiQuestionTurns === 0 ? "good" : "warning"}
          />
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Evidence Section
// ============================================================================

function EvidenceSection({ metrics }: { metrics: DeterministicMetrics["evidence"] }) {
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-medium">Evidence Integrity</h4>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <MetricItem
          label="Present Rate"
          value={`${Math.round(metrics.presentRate * 100)}%`}
          status={metrics.presentRate >= 0.9 ? "good" : metrics.presentRate >= 0.7 ? "warning" : "bad"}
        />
        <MetricItem
          label="Valid Rate"
          value={`${Math.round(metrics.validRate * 100)}%`}
          status={metrics.validRate >= 0.95 ? "good" : metrics.validRate >= 0.8 ? "warning" : "bad"}
        />
        <MetricItem
          label="Leak Count"
          value={metrics.leakCount}
          status={metrics.leakCount === 0 ? "good" : "bad"}
        />
        <MetricItem
          label="Missing (Low Ambiguity)"
          value={metrics.missingLowAmbiguity}
          status={metrics.missingLowAmbiguity === 0 ? "good" : "warning"}
        />
      </div>
    </div>
  );
}

// ============================================================================
// Readability Section
// ============================================================================

function ReadabilitySection({ metrics }: { metrics: TextMetrics["readability"] }) {
  // FRE: Higher is better (easier to read), target 60-70 for general audience
  // FKG: Lower is better (lower grade level), target 8-10
  // GFI: Lower is better, target 8-12

  const freStatus = metrics.fre >= 60 ? "good" : metrics.fre >= 40 ? "warning" : "bad";
  const fkgStatus = metrics.fkg <= 10 ? "good" : metrics.fkg <= 14 ? "warning" : "bad";
  const gfiStatus = metrics.gfi <= 12 ? "good" : metrics.gfi <= 16 ? "warning" : "bad";

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-medium">Readability</h4>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <MetricItem
          label="Flesch Reading Ease"
          value={metrics.fre.toFixed(1)}
          description="Higher = easier"
          status={freStatus}
        />
        <MetricItem
          label="Flesch-Kincaid Grade"
          value={metrics.fkg.toFixed(1)}
          description="Grade level"
          status={fkgStatus}
        />
        <MetricItem
          label="Gunning Fog Index"
          value={metrics.gfi.toFixed(1)}
          description="Years of education"
          status={gfiStatus}
        />
      </div>
    </div>
  );
}

// ============================================================================
// Coherence Section
// ============================================================================

function CoherenceSection({ metrics }: { metrics: TextMetrics["coherence"] }) {
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-medium">Coherence</h4>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <MetricItem
          label="Q/A Coherence"
          value={`${Math.round(metrics.qaCoherenceAvg * 100)}%`}
          description="Semantic similarity"
          status={metrics.qaCoherenceAvg >= 0.7 ? "good" : metrics.qaCoherenceAvg >= 0.5 ? "warning" : "bad"}
        />
        <MetricItem
          label="Report Alignment"
          value={`${Math.round(metrics.reportAlignment * 100)}%`}
          description="Report vs domains"
          status={metrics.reportAlignment >= 0.7 ? "good" : metrics.reportAlignment >= 0.5 ? "warning" : "bad"}
        />
      </div>
    </div>
  );
}

// ============================================================================
// RAG Section
// ============================================================================

function RagSection({ metrics }: { metrics: RagMetrics }) {
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-medium">RAG Quality</h4>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <MetricItem
          label="Context Precision"
          value={`${Math.round(metrics.contextPrecision * 100)}%`}
          status={metrics.contextPrecision >= 0.7 ? "good" : metrics.contextPrecision >= 0.4 ? "warning" : "bad"}
        />
        <MetricItem
          label="Domain Coverage"
          value={`${Math.round(metrics.domainCoverageRate * 100)}%`}
          status={metrics.domainCoverageRate >= 0.8 ? "good" : metrics.domainCoverageRate >= 0.5 ? "warning" : "bad"}
        />
        <MetricItem
          label="Phantom Rate"
          value={`${Math.round(metrics.phantomRate * 100)}%`}
          status={metrics.phantomRate === 0 ? "good" : metrics.phantomRate <= 0.1 ? "warning" : "bad"}
        />
        <MetricItem
          label="Grounded Claims"
          value={`${Math.round(metrics.groundedClaimRate * 100)}%`}
          status={metrics.groundedClaimRate >= 0.8 ? "good" : metrics.groundedClaimRate >= 0.5 ? "warning" : "bad"}
        />
      </div>
    </div>
  );
}

// ============================================================================
// Judge Section
// ============================================================================

function JudgeSection({ result }: { result: JudgeResult }) {
  const scoreLabels = {
    coverage: "DSM-5 Coverage",
    relevance: "Clinical Relevance",
    flow: "Flow & Coherence",
    explainability: "Explainability",
    empathy: "Empathy & Tone",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">LLM Judge Rubric</h4>
        <Badge variant="outline" className="text-lg font-bold">
          {result.overallScore.toFixed(1)}/5
        </Badge>
      </div>

      <div className="space-y-2">
        {(Object.entries(result.scores) as [keyof typeof scoreLabels, number][]).map(
          ([key, score]) => (
            <div key={key} className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-28">
                {scoreLabels[key]}
              </span>
              <Progress value={score * 20} className="h-1.5 flex-1" />
              <span className="text-xs font-medium w-8">{score}/5</span>
            </div>
          )
        )}
      </div>

      {result.strengthsTop3.length > 0 && (
        <div className="space-y-1">
          <span className="text-xs font-medium text-green-600">Strengths</span>
          <ul className="text-xs text-muted-foreground list-disc list-inside">
            {result.strengthsTop3.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}

      {result.issuesTop3.length > 0 && (
        <div className="space-y-1">
          <span className="text-xs font-medium text-yellow-600">Issues</span>
          <ul className="text-xs text-muted-foreground list-disc list-inside">
            {result.issuesTop3.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}

      {result.recommendedFixes.length > 0 && (
        <div className="space-y-1">
          <span className="text-xs font-medium text-blue-600">Recommendations</span>
          <ul className="text-xs text-muted-foreground list-disc list-inside">
            {result.recommendedFixes.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Comparison Section
// ============================================================================

function ComparisonSection({ comparisons }: { comparisons: ModelComparison[] }) {
  if (comparisons.length <= 1) return null;

  const driverModel = comparisons[0];
  const comparedModels = comparisons.slice(1);

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-medium">Model Comparison</h4>
      <div className="text-xs text-muted-foreground mb-2">
        Driver: <span className="font-medium">{driverModel.modelId}</span>
      </div>

      {comparedModels.map((model) => (
        <div key={model.modelId} className="border rounded-lg p-3 space-y-2">
          <div className="font-medium text-sm">{model.modelId}</div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <MetricItem
              label="Jaccard Overlap"
              value={model.jaccard !== undefined ? `${Math.round(model.jaccard * 100)}%` : "N/A"}
              status={
                model.jaccard === undefined
                  ? "neutral"
                  : model.jaccard >= 0.7
                    ? "good"
                    : model.jaccard >= 0.4
                      ? "warning"
                      : "bad"
              }
            />
            <MetricItem
              label="Spearman ρ"
              value={model.spearmanRho !== undefined ? model.spearmanRho.toFixed(2) : "N/A"}
              status={
                model.spearmanRho === undefined
                  ? "neutral"
                  : model.spearmanRho >= 0.7
                    ? "good"
                    : model.spearmanRho >= 0.4
                      ? "warning"
                      : "bad"
              }
            />
            <MetricItem
              label="Confidence Drift"
              value={
                model.confidenceDrift !== undefined
                  ? `${Math.round(model.confidenceDrift * 100)}%`
                  : "N/A"
              }
              status={
                model.confidenceDrift === undefined
                  ? "neutral"
                  : model.confidenceDrift <= 0.1
                    ? "good"
                    : model.confidenceDrift <= 0.3
                      ? "warning"
                      : "bad"
              }
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Issues Section
// ============================================================================

function IssuesSection({ deterministic }: { deterministic: DeterministicMetrics }) {
  const hasIssues =
    deterministic.failReasons.length > 0 || deterministic.warnReasons.length > 0;

  if (!hasIssues) return null;

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-medium flex items-center gap-2">
        <AlertCircleIcon className="size-4" />
        Issues
      </h4>

      {deterministic.failReasons.length > 0 && (
        <div className="space-y-1">
          <span className="text-xs font-medium text-red-600">Failures</span>
          <ul className="text-xs text-muted-foreground space-y-1">
            {deterministic.failReasons.map((reason, i) => (
              <li key={i} className="flex items-start gap-2">
                <XCircleIcon className="size-3 text-red-500 mt-0.5 shrink-0" />
                {reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {deterministic.warnReasons.length > 0 && (
        <div className="space-y-1">
          <span className="text-xs font-medium text-yellow-600">Warnings</span>
          <ul className="text-xs text-muted-foreground space-y-1">
            {deterministic.warnReasons.map((reason, i) => (
              <li key={i} className="flex items-start gap-2">
                <AlertTriangleIcon className="size-3 text-yellow-500 mt-0.5 shrink-0" />
                {reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function BenchmarkReportCard({ runId, className }: BenchmarkReportCardProps) {
  const { data, error, isLoading } = useSWR<BenchmarkRunData>(
    `/api/benchmark/${runId}`,
    fetcher,
    { refreshInterval: 5000 } // Poll while running
  );

  if (isLoading) {
    return (
      <div className={cn("w-full flex items-center justify-center py-12", className)}>
        <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className={cn("w-full flex flex-col items-center justify-center py-12 gap-2", className)}>
        <AlertCircleIcon className="size-6 text-destructive" />
        <p className="text-sm text-muted-foreground">Failed to load benchmark</p>
      </div>
    );
  }

  if (data.status === "pending" || data.status === "running") {
    return (
      <div className={cn("w-full", className)}>
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
          <BarChart3Icon className="size-5" />
          <span className="font-medium">Benchmark Running</span>
          <span>— Analyzing your DSM-5 screening session...</span>
        </div>
        <div className="flex items-center justify-center py-8">
          <Loader2Icon className="size-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  if (data.status === "failed") {
    return (
      <div className={cn("w-full rounded-lg border border-destructive p-4", className)}>
        <div className="flex items-center gap-2 text-destructive">
          <XCircleIcon className="size-5" />
          <span className="font-medium">Benchmark Failed</span>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          {data.errorMessage ?? "Unknown error"}
        </p>
      </div>
    );
  }

  return (
    <div className={cn("w-full", className)}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Completed: {new Date(data.createdAt).toLocaleString()}</span>
        </div>
        {data.deterministic && <StatusBadge status={data.deterministic.status} />}
      </div>

      <div className="space-y-6">
        {/* Issues (if any) */}
        {data.deterministic && <IssuesSection deterministic={data.deterministic} />}

        {data.deterministic && (
          <>
            <Separator />
            <CoverageSection metrics={data.deterministic.coverage} />
          </>
        )}

        {data.deterministic && (
          <>
            <Separator />
            <EvidenceSection metrics={data.deterministic.evidence} />
          </>
        )}

        {data.text && (
          <>
            <Separator />
            <ReadabilitySection metrics={data.text.readability} />
          </>
        )}

        {data.text && (
          <>
            <Separator />
            <CoherenceSection metrics={data.text.coherence} />
          </>
        )}

        {data.rag && (
          <>
            <Separator />
            <RagSection metrics={data.rag} />
          </>
        )}

        {data.judge && (
          <>
            <Separator />
            <JudgeSection result={data.judge} />
          </>
        )}

        {data.comparisons && data.comparisons.length > 1 && (
          <>
            <Separator />
            <ComparisonSection comparisons={data.comparisons} />
          </>
        )}

        {/* Snapshot Info */}
        {data.snapshot && (
          <>
            <Separator />
            <div className="text-xs text-muted-foreground space-y-1">
              <div className="flex items-center gap-1">
                <InfoIcon className="size-3" />
                Snapshot Details
              </div>
              <div className="grid grid-cols-2 gap-x-4">
                <span>Items: {data.snapshot.itemCount}</span>
                <span>Turns: {data.snapshot.transcriptLength}</span>
                <span>Status: {data.snapshot.sessionStatus}</span>
                <span className="truncate">Hash: {data.snapshot.hash.slice(0, 12)}...</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
