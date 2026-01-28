"use client";

import { useMemo, useState } from "react";
import {
  AlertCircleIcon,
  AlertTriangleIcon,
  BarChart3Icon,
  BookOpenIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ClipboardListIcon,
  FileTextIcon,
  InfoIcon,
  Loader2Icon,
  ShieldAlertIcon,
  XCircleIcon,
} from "lucide-react";
import { toast } from "sonner";
import useSWR from "swr";
import { BenchmarkReportCard } from "@/components/benchmark-report-card";
import { Artifact } from "@/components/create-artifact";
import { DocumentSkeleton } from "@/components/document-skeleton";
import { ClockRewind, CopyIcon, RedoIcon, UndoIcon } from "@/components/icons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { useArtifact } from "@/hooks/use-artifact";
import type { Document } from "@/lib/db/schema";
import type { EvidenceSpan, TranscriptEntry } from "@/lib/dsm5/schemas";
import { DOMAIN_THRESHOLDS } from "@/lib/dsm5/thresholds";
import { cn, fetcher } from "@/lib/utils";

// Report artifact has no special metadata
type ReportArtifactMetadata = Record<string, never>;

// ============================================================================
// Types for parsed report
// ============================================================================

type ParsedReport = {
  title: string;
  generated: string;
  sessionStatus: string;
  ragGrounding: string | null;
  ragWarning: string | null;
  executiveSummary: string;
  riskLevel: string;
  riskFlags: string[];
  diagnosticImpressions: DiagnosticImpression[];
  dsmReferences: DsmReference[];
  domainSummary: DomainSummaryRow[];
  flaggedDomains: FlaggedDomain[];
  itemAppendix: ItemRow[];
  recommendations: string[];
  limitations: string[];
};

type DiagnosticImpression = {
  label: string;
  confidence: number;
  reasoning: string;
  supportingDomains: string[];
  evidence: string[];
};

type DsmReference = {
  index: number;
  location: string;
  relevance: number;
  snippet: string;
};

type DomainSummaryRow = {
  domain: string;
  severity: string;
  flagged: boolean;
  evidence: string;
};

type FlaggedDomain = {
  domain: string;
  severity: string;
  note: string;
  evidence: string;
};

type ItemRow = {
  itemId: string;
  domain: string;
  score: string;
  ambiguity: string;
  evidence: string;
};

type ItemResponseWithEvidence = {
  itemId: string;
  score: number;
  ambiguity: number;
  evidence?: EvidenceSpan;
};

type EvidenceContext = {
  transcript: TranscriptEntry[];
  evidenceByDomain: Record<string, EvidenceSpan | undefined>;
};

function buildDomainEvidence(
  itemResponses: ItemResponseWithEvidence[]
): Record<string, EvidenceSpan | undefined> {
  const responseById = new Map(
    itemResponses.map((response) => [response.itemId, response])
  );

  return DOMAIN_THRESHOLDS.reduce(
    (acc, config) => {
      const candidates = config.itemIds
        .map((id) => responseById.get(id))
        .filter(Boolean) as ItemResponseWithEvidence[];

      if (candidates.length === 0) {
        acc[config.domain] = undefined;
        return acc;
      }

      candidates.sort((a, b) => b.score - a.score);
      acc[config.domain] = candidates[0]?.evidence;
      return acc;
    },
    {} as Record<string, EvidenceSpan | undefined>
  );
}

function EvidenceHighlight({
  text,
  spans,
  className,
}: {
  text: string;
  spans: Array<{ start: number; end: number }>;
  className?: string;
}) {
  if (spans.length === 0) {
    return <span className={className}>{text}</span>;
  }

  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const parts: React.ReactNode[] = [];
  let lastEnd = 0;

  for (let i = 0; i < sorted.length; i++) {
    const span = sorted[i];

    if (span.start > lastEnd) {
      parts.push(
        <span key={`pre-${i}`}>{text.slice(lastEnd, span.start)}</span>
      );
    }

    parts.push(
      <mark
        className="rounded bg-yellow-200 px-0.5 dark:bg-yellow-800/50"
        key={`mark-${i}`}
      >
        {text.slice(span.start, span.end)}
      </mark>
    );
    lastEnd = span.end;
  }

  if (lastEnd < text.length) {
    parts.push(<span key="post">{text.slice(lastEnd)}</span>);
  }

  return <span className={className}>{parts}</span>;
}

function DomainEvidenceSection({
  evidence,
  transcript,
}: {
  evidence: EvidenceSpan;
  transcript: TranscriptEntry[];
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const patientMessage = transcript[evidence.messageIndex];

  return (
    <div className="mt-2">
      <p className="text-sm text-muted-foreground">
        {evidence.summary ?? "Evidence summary unavailable."}
      </p>

      {evidence.type === "direct_span" && patientMessage && (
        <Collapsible onOpenChange={setIsExpanded} open={isExpanded}>
          <CollapsibleTrigger asChild>
            <Button className="mt-2 h-7 px-2 text-xs" variant="ghost">
              {isExpanded ? "Hide" : "Show"} transcript evidence
              <ChevronDownIcon
                className={cn(
                  "ml-1 size-3 transition-transform",
                  isExpanded && "rotate-180"
                )}
              />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 rounded bg-muted/50 p-2 text-sm">
              <p className="mb-1 text-xs text-muted-foreground">
                Patient message #{evidence.messageIndex + 1}
              </p>
              <blockquote className="border-l-2 border-primary/30 pl-2">
                <EvidenceHighlight
                  spans={evidence.spans}
                  text={patientMessage.text}
                />
              </blockquote>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

// ============================================================================
// Parser Functions
// ============================================================================

function parseReport(content: string): ParsedReport {
  const lines = content.split("\n");
  const report: ParsedReport = {
    title: "",
    generated: "",
    sessionStatus: "",
    ragGrounding: null,
    ragWarning: null,
    executiveSummary: "",
    riskLevel: "Unknown",
    riskFlags: [],
    diagnosticImpressions: [],
    dsmReferences: [],
    domainSummary: [],
    flaggedDomains: [],
    itemAppendix: [],
    recommendations: [],
    limitations: [],
  };

  let currentSection = "";
  let currentImpression: Partial<DiagnosticImpression> | null = null;
  let currentReference: Partial<DsmReference> | null = null;
  let inDetailsBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip details block markers
    if (line.includes("<details>")) {
      inDetailsBlock = true;
      continue;
    }
    if (line.includes("</details>")) {
      inDetailsBlock = false;
      continue;
    }
    if (line.includes("<summary>")) {
      continue;
    }

    // Parse title
    if (line.startsWith("# ")) {
      report.title = line.slice(2).trim();
      continue;
    }

    // Parse metadata
    if (line.startsWith("**Generated:**")) {
      report.generated = line.replace("**Generated:**", "").trim();
      continue;
    }
    if (line.startsWith("**Session Status:**")) {
      report.sessionStatus = line.replace("**Session Status:**", "").trim();
      continue;
    }
    if (line.startsWith("**RAG Grounding:**")) {
      report.ragGrounding = line.replace("**RAG Grounding:**", "").trim();
      continue;
    }

    // Parse RAG warning
    if (line.startsWith("> **Note:**")) {
      report.ragWarning = line.replace("> **Note:**", "").trim();
      continue;
    }

    // Section headers
    if (line.startsWith("## ")) {
      currentSection = line.slice(3).trim();
      continue;
    }

    // Parse based on current section
    switch (currentSection) {
      case "Executive Summary":
        if (line.trim()) {
          report.executiveSummary += (report.executiveSummary ? " " : "") + line.trim();
        }
        break;

      case "Risk Assessment":
        if (line.startsWith("**Overall Risk Level:**")) {
          report.riskLevel = line.replace("**Overall Risk Level:**", "").trim();
        } else if (line.startsWith("- ")) {
          report.riskFlags.push(line.slice(2).trim());
        } else if (line.trim() && !line.startsWith("No immediate")) {
          // Non-list item that's not empty and not the "no flags" message
        }
        break;

      case "Diagnostic Impressions":
        if (line.startsWith("### ")) {
          // Save previous impression
          if (currentImpression?.label) {
            report.diagnosticImpressions.push(currentImpression as DiagnosticImpression);
          }
          // Parse new impression header: "### Label (XX% confidence)"
          const match = line.match(/### (.+?) \((\d+)% confidence\)/);
          if (match) {
            currentImpression = {
              label: match[1],
              confidence: Number.parseInt(match[2], 10),
              reasoning: "",
              supportingDomains: [],
              evidence: [],
            };
          }
        } else if (currentImpression) {
          if (line.startsWith("**Reasoning:**")) {
            currentImpression.reasoning = line.replace("**Reasoning:**", "").trim();
          } else if (line.startsWith("**Supporting Domains:**")) {
            currentImpression.supportingDomains = line
              .replace("**Supporting Domains:**", "")
              .trim()
              .split(", ");
          } else if (line.startsWith("- <quote>")) {
            const quote = line.replace(/- <quote>(.*?)<\/quote>/, "$1").trim();
            currentImpression.evidence = currentImpression.evidence ?? [];
            currentImpression.evidence.push(quote);
          }
        }
        break;

      case "DSM-5 References":
        if (line.startsWith("**[")) {
          // Save previous reference
          if (currentReference?.index) {
            report.dsmReferences.push(currentReference as DsmReference);
          }
          // Parse: **[1] p. 3** (65% relevance)
          const match = line.match(/\*\*\[(\d+)\] (.+?)\*\* \((\d+)% relevance\)/);
          if (match) {
            currentReference = {
              index: Number.parseInt(match[1], 10),
              location: match[2],
              relevance: Number.parseInt(match[3], 10),
              snippet: "",
            };
          }
        } else if (currentReference && line.startsWith(">")) {
          currentReference.snippet = line.slice(1).trim();
        }
        break;

      case "Symptom Domain Summary":
        if (line.startsWith("|") && !line.includes("---") && !line.includes("Domain")) {
          const cells = line.split("|").filter((c) => c.trim());
          if (cells.length >= 4) {
            report.domainSummary.push({
              domain: cells[0].trim(),
              severity: cells[1].trim(),
              flagged: cells[2].trim().toLowerCase() === "yes",
              evidence: cells[3]?.trim()
                .replace(/<quote>(.*?)<\/quote>/, "$1")
                .replace(/"/g, "") ?? "",
            });
          }
        }
        break;

      case "Recommendations":
        if (line.startsWith("- ")) {
          report.recommendations.push(line.slice(2).trim());
        }
        break;

      case "Limitations":
        if (line.startsWith("- ")) {
          report.limitations.push(
            line.slice(2).replace(/\*\*/g, "").trim()
          );
        }
        break;
    }

    // Parse flagged domains section
    if (line.startsWith("### ") && currentSection === "Symptom Domain Summary") {
      // Skip the "Flagged Domains Requiring Follow-up" header
    }
    if (line.startsWith("**") && line.includes("(") && currentSection === "Symptom Domain Summary") {
      const match = line.match(/\*\*(.+?)\*\* \((.+?)\)/);
      if (match && !match[1].includes("Overall")) {
        const domain: FlaggedDomain = {
          domain: match[1],
          severity: match[2],
          note: "",
          evidence: "",
        };
        // Look ahead for note and evidence
        for (let j = i + 1; j < lines.length && j < i + 4; j++) {
          if (lines[j].startsWith("- ") && !lines[j].includes("Evidence:")) {
            domain.note = lines[j].slice(2).trim();
          }
          if (lines[j].includes("Evidence:")) {
            domain.evidence = lines[j]
              .replace(/.*Evidence:/, "")
              .replace(/<quote>(.*?)<\/quote>/, "$1")
              .trim();
          }
        }
        report.flaggedDomains.push(domain);
      }
    }

    // Parse item appendix
    if (inDetailsBlock && line.startsWith("|") && !line.includes("---") && !line.includes("Item ID")) {
      const cells = line.split("|").filter((c) => c.trim());
      if (cells.length >= 5) {
        report.itemAppendix.push({
          itemId: cells[0].trim(),
          domain: cells[1].trim(),
          score: cells[2].trim(),
          ambiguity: cells[3].trim(),
          evidence: cells[4]?.trim()
            .replace(/<quote>(.*?)<\/quote>/, "$1")
            .replace(/"/g, "") ?? "",
        });
      }
    }
  }

  // Save final impression/reference if pending
  if (currentImpression?.label) {
    report.diagnosticImpressions.push(currentImpression as DiagnosticImpression);
  }
  if (currentReference?.index) {
    report.dsmReferences.push(currentReference as DsmReference);
  }

  return report;
}

// ============================================================================
// UI Components
// ============================================================================

function RiskBadge({ level }: { level: string }) {
  const config: Record<string, { color: string; icon: React.ReactNode }> = {
    critical: {
      color: "bg-red-500 text-white hover:bg-red-600",
      icon: <XCircleIcon className="size-3 mr-1" />,
    },
    high: {
      color: "bg-orange-500 text-white hover:bg-orange-600",
      icon: <AlertTriangleIcon className="size-3 mr-1" />,
    },
    moderate: {
      color: "bg-yellow-500 text-white hover:bg-yellow-600",
      icon: <AlertCircleIcon className="size-3 mr-1" />,
    },
    low: {
      color: "bg-green-500 text-white hover:bg-green-600",
      icon: <CheckCircleIcon className="size-3 mr-1" />,
    },
  };

  const lowerLevel = level.toLowerCase();
  const { color, icon } = config[lowerLevel] ?? {
    color: "bg-gray-500 text-white",
    icon: <InfoIcon className="size-3 mr-1" />,
  };

  return (
    <Badge className={cn("flex items-center", color)}>
      {icon}
      {level}
    </Badge>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    none: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    mild: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    moderate: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
    elevated: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
    severe: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  };

  return (
    <Badge className={cn("text-xs", colors[severity.toLowerCase()] ?? colors.none)}>
      {severity}
    </Badge>
  );
}

function SeverityProgress({ severity }: { severity: string }) {
  const values: Record<string, number> = {
    none: 0,
    mild: 25,
    moderate: 50,
    elevated: 75,
    severe: 100,
  };
  const colors: Record<string, string> = {
    none: "bg-gray-200",
    mild: "bg-blue-400",
    moderate: "bg-yellow-400",
    elevated: "bg-orange-400",
    severe: "bg-red-500",
  };

  const value = values[severity.toLowerCase()] ?? 0;
  const color = colors[severity.toLowerCase()] ?? "bg-gray-200";

  return (
    <div className="w-16">
      <Progress
        className="h-2"
        value={value}
        style={{ ["--progress-background" as string]: color }}
      />
    </div>
  );
}

// ============================================================================
// Inline Formatting Helper
// ============================================================================

/**
 * Render inline formatting tags like <sym>, <quote>, <med>
 */
function renderFormattedText(text: string): React.ReactNode {
  // Replace custom tags with markers
  let result = text;
  result = result.replace(/<sym>(.*?)<\/sym>/g, "{{SYM:$1}}");
  result = result.replace(/<quote>(.*?)<\/quote>/g, "{{QUOTE:$1}}");
  result = result.replace(/<med>(.*?)<\/med>/g, "{{MED:$1}}");
  result = result.replace(/\*\*(.*?)\*\*/g, "{{BOLD:$1}}");

  // Split by markers and render
  const parts = result.split(/({{SYM:.*?}}|{{QUOTE:.*?}}|{{MED:.*?}}|{{BOLD:.*?}})/);

  return parts.map((part, idx) => {
    if (part.startsWith("{{SYM:")) {
      const content = part.slice(6, -2);
      return (
        <span
          className="rounded bg-purple-100 px-1.5 py-0.5 font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-400"
          key={idx}
        >
          {content}
        </span>
      );
    }
    if (part.startsWith("{{QUOTE:")) {
      const content = part.slice(8, -2);
      return (
        <span
          className="rounded bg-blue-100 px-1.5 py-0.5 italic text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
          key={idx}
        >
          "{content}"
        </span>
      );
    }
    if (part.startsWith("{{MED:")) {
      const content = part.slice(6, -2);
      return (
        <span
          className="rounded bg-green-100 px-1.5 py-0.5 font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400"
          key={idx}
        >
          {content}
        </span>
      );
    }
    if (part.startsWith("{{BOLD:")) {
      const content = part.slice(7, -2);
      return <strong key={idx}>{content}</strong>;
    }
    return part;
  });
}

// ============================================================================
// Section Components
// ============================================================================

function ReportHeader({ report }: { report: ParsedReport }) {
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{report.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>Generated: {report.generated}</span>
            <Separator className="h-4" orientation="vertical" />
            <Badge variant="outline">{report.sessionStatus}</Badge>
            {report.ragGrounding && (
              <>
                <Separator className="h-4" orientation="vertical" />
                <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                  <BookOpenIcon className="size-3 mr-1" />
                  RAG: {report.ragGrounding.replace("Enabled (", "").replace(")", "").replace(" mode", "")}
                </Badge>
              </>
            )}
          </div>
        </div>
      </div>

      {report.ragWarning && (
        <Alert className="border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950">
          <AlertTriangleIcon className="size-4 text-yellow-600" />
          <AlertTitle>RAG Unavailable</AlertTitle>
          <AlertDescription className="text-yellow-700 dark:text-yellow-300">
            {report.ragWarning}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function ExecutiveSummaryCard({ summary }: { summary: string }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <FileTextIcon className="size-5" />
          Executive Summary
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {renderFormattedText(summary)}
        </p>
      </CardContent>
    </Card>
  );
}

function RiskAssessmentCard({
  riskLevel,
  riskFlags,
}: {
  riskLevel: string;
  riskFlags: string[];
}) {
  const hasFlags = riskFlags.length > 0 && !riskFlags[0]?.includes("No immediate");

  return (
    <Card className={cn(
      hasFlags && "border-red-200 dark:border-red-900"
    )}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldAlertIcon className="size-5" />
            Risk Assessment
          </CardTitle>
          <RiskBadge level={riskLevel} />
        </div>
      </CardHeader>
      <CardContent>
        {hasFlags ? (
          <ul className="space-y-2">
            {riskFlags.map((flag, idx) => (
              <li className="flex items-start gap-2 text-sm" key={idx}>
                <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-red-500" />
                <span dangerouslySetInnerHTML={{ 
                  __html: flag
                    .replace(/<sym>(.*?)<\/sym>/g, '<span class="font-medium text-red-600 dark:text-red-400">$1</span>')
                    .replace(/<med>(.*?)<\/med>/g, '<span class="font-medium text-orange-600 dark:text-orange-400">$1</span>')
                }} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
            <CheckCircleIcon className="size-4" />
            No immediate risk flags detected during screening.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function DiagnosticImpressionsCard({
  impressions,
}: {
  impressions: DiagnosticImpression[];
}) {
  if (impressions.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <ClipboardListIcon className="size-5" />
          Diagnostic Impressions
        </CardTitle>
        <CardDescription>
          LLM-generated analysis grounded in DSM-5 criteria
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {impressions.map((impression, idx) => (
          <div className="rounded-lg border p-4" key={idx}>
            <div className="flex items-start justify-between">
              <h4 className="font-semibold">{impression.label}</h4>
              <Badge variant="outline" className="ml-2">
                {impression.confidence}% confidence
              </Badge>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {impression.reasoning}
            </p>
            {impression.supportingDomains.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1">
                {impression.supportingDomains.map((domain, dIdx) => (
                  <Badge className="text-xs" key={dIdx} variant="secondary">
                    {domain}
                  </Badge>
                ))}
              </div>
            )}
            {impression.evidence.length > 0 && (
              <div className="mt-3 space-y-1">
                {impression.evidence.map((quote, qIdx) => (
                  <p
                    className="text-xs italic text-blue-600 dark:text-blue-400"
                    key={qIdx}
                  >
                    "{quote}"
                  </p>
                ))}
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function DsmReferencesCard({ references }: { references: DsmReference[] }) {
  if (references.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <BookOpenIcon className="size-5" />
          DSM-5 References
        </CardTitle>
        <CardDescription>
          Retrieved passages used to ground the analysis
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {references.map((ref) => (
          <div
            className="rounded-lg border-l-4 border-blue-400 bg-blue-50 p-3 dark:bg-blue-950"
            key={ref.index}
          >
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-blue-700 dark:text-blue-300">
                [{ref.index}] {ref.location}
              </span>
              <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                {ref.relevance}% match
              </Badge>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{ref.snippet}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function DomainSummaryCard({ domains }: { domains: DomainSummaryRow[] }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Symptom Domain Summary</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border">
          {/* Header */}
          <div className="grid grid-cols-12 gap-2 border-b bg-muted/50 p-3 text-xs font-medium">
            <div className="col-span-4">Domain</div>
            <div className="col-span-2">Severity</div>
            <div className="col-span-2 text-center">Status</div>
            <div className="col-span-4">Evidence</div>
          </div>
          {/* Rows */}
          {domains.map((domain, idx) => (
            <div
              className={cn(
                "grid grid-cols-12 gap-2 p-3 text-sm items-center",
                idx !== domains.length - 1 && "border-b",
                domain.flagged && "bg-orange-50 dark:bg-orange-950/30"
              )}
              key={idx}
            >
              <div className="col-span-4 font-medium">{domain.domain}</div>
              <div className="col-span-2">
                <SeverityBadge severity={domain.severity} />
              </div>
              <div className="col-span-2 text-center">
                {domain.flagged ? (
                  <Badge className="bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300">
                    Flagged
                  </Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </div>
              <div className="col-span-4 truncate text-xs text-muted-foreground">
                {domain.evidence ? `"${domain.evidence}"` : "—"}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function FlaggedDomainsCard({
  domains,
  evidenceContext,
}: {
  domains: FlaggedDomain[];
  evidenceContext?: EvidenceContext;
}) {
  if (domains.length === 0) return null;

  return (
    <Card className="border-orange-200 dark:border-orange-900">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <AlertTriangleIcon className="size-5 text-orange-500" />
          Flagged Domains Requiring Follow-up
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {domains.map((domain, idx) => {
          const domainEvidence =
            evidenceContext?.evidenceByDomain[domain.domain];
          const transcript = evidenceContext?.transcript ?? [];

          return (
          <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 dark:border-orange-800 dark:bg-orange-950/50" key={idx}>
            <div className="flex items-center gap-2">
              <span className="font-semibold">{domain.domain}</span>
              <SeverityBadge severity={domain.severity} />
            </div>
            {domain.note && (
              <p className="mt-2 text-sm text-muted-foreground">
                {renderFormattedText(domain.note)}
              </p>
            )}
            {domainEvidence ? (
              <DomainEvidenceSection
                evidence={domainEvidence}
                transcript={transcript}
              />
            ) : (
              domain.evidence && (
                <p className="mt-2 text-xs italic text-blue-600 dark:text-blue-400">
                  Evidence: "{domain.evidence}"
                </p>
              )
            )}
          </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function RecommendationsCard({ recommendations }: { recommendations: string[] }) {
  if (recommendations.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Recommendations</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {recommendations.map((rec, idx) => (
            <li className="flex items-start gap-2 text-sm" key={idx}>
              <CheckCircleIcon className="mt-0.5 size-4 shrink-0 text-green-500" />
              <span>{renderFormattedText(rec)}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function LimitationsCard({ limitations }: { limitations: string[] }) {
  if (limitations.length === 0) return null;

  return (
    <Card className="bg-muted/30">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg text-muted-foreground">
          <InfoIcon className="size-5" />
          Limitations
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1.5">
          {limitations.map((lim, idx) => (
            <li className="text-xs text-muted-foreground" key={idx}>
              • {renderFormattedText(lim)}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function ItemAppendixCollapsible({ items }: { items: ItemRow[] }) {
  if (items.length === 0) return null;

  return (
    <Collapsible>
      <Card>
        <CollapsibleTrigger className="w-full">
          <CardHeader className="flex-row items-center justify-between pb-3">
            <CardTitle className="text-lg">Item-Level Appendix</CardTitle>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>{items.length} items</span>
              <ChevronDownIcon className="size-4 transition-transform data-[state=open]:rotate-180" />
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent>
            <div className="rounded-lg border text-xs">
              {/* Header */}
              <div className="grid grid-cols-12 gap-2 border-b bg-muted/50 p-2 font-medium">
                <div className="col-span-2">Item ID</div>
                <div className="col-span-3">Domain</div>
                <div className="col-span-2">Score</div>
                <div className="col-span-2">Ambiguity</div>
                <div className="col-span-3">Evidence</div>
              </div>
              {/* Rows */}
              {items.map((item, idx) => (
                <div
                  className={cn(
                    "grid grid-cols-12 gap-2 p-2",
                    idx !== items.length - 1 && "border-b"
                  )}
                  key={idx}
                >
                  <div className="col-span-2 font-mono">{item.itemId}</div>
                  <div className="col-span-3">{item.domain}</div>
                  <div className="col-span-2">{item.score}</div>
                  <div className="col-span-2">{item.ambiguity}</div>
                  <div className="col-span-3 truncate text-muted-foreground">
                    {item.evidence}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

// ============================================================================
// Main Report Viewer
// ============================================================================

function ReportViewer({
  content,
  status,
}: {
  content: string;
  status: "streaming" | "idle";
}) {
  const report = parseReport(content);
  const { artifact } = useArtifact();
  const [benchmarkRunId, setBenchmarkRunId] = useState<string | null>(null);
  const [isRunningBenchmark, setIsRunningBenchmark] = useState(false);

  const { data: documents } = useSWR<Document[]>(
    artifact.documentId !== "init" ? `/api/document?id=${artifact.documentId}` : null,
    fetcher
  );

  const document = documents?.at(-1);
  const chatId = document?.chatId ?? null;

  const { data: dsmData } = useSWR<{
    session: { transcript: TranscriptEntry[] };
    itemResponses: ItemResponseWithEvidence[];
  }>(chatId ? `/api/dsm/session?chatId=${chatId}` : null, fetcher);

  const evidenceContext = useMemo<EvidenceContext | undefined>(() => {
    if (!dsmData) {
      return undefined;
    }

    return {
      transcript: dsmData.session.transcript ?? [],
      evidenceByDomain: buildDomainEvidence(dsmData.itemResponses ?? []),
    };
  }, [dsmData]);

  const handleRunBenchmark = async () => {
    if (!chatId || isRunningBenchmark) return;

    setIsRunningBenchmark(true);
    try {
      const response = await fetch("/api/benchmark/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId,
          compareModels: [],
          ragMode: "off",
          diagnosticMode: "diagnostic",
        }),
      });

      const raw = await response.text();
      const data = raw ? JSON.parse(raw) : {};

      if (!response.ok) {
        toast.error(data.error ?? "Failed to run benchmark");
        return;
      }

      if (data.status === "fail") {
        toast.warning("Benchmark completed with failures", {
          description: "Check the report for details",
        });
      } else if (data.status === "completed") {
        toast.success("Benchmark completed successfully");
      }

      if (data.runId) {
        setBenchmarkRunId(data.runId);
      }
    } catch (error) {
      console.error("Benchmark error:", error);
      toast.error("Failed to run benchmark");
    } finally {
      setIsRunningBenchmark(false);
    }
  };

  return (
    <div className="space-y-6">
      <ReportHeader report={report} />
      
      <div className="grid gap-6 md:grid-cols-2">
        <ExecutiveSummaryCard summary={report.executiveSummary} />
        <RiskAssessmentCard
          riskFlags={report.riskFlags}
          riskLevel={report.riskLevel}
        />
      </div>

      <DiagnosticImpressionsCard impressions={report.diagnosticImpressions} />
      <DsmReferencesCard references={report.dsmReferences} />
      <DomainSummaryCard domains={report.domainSummary} />
      <FlaggedDomainsCard
        domains={report.flaggedDomains}
        evidenceContext={evidenceContext}
      />
      <RecommendationsCard recommendations={report.recommendations} />
      <ItemAppendixCollapsible items={report.itemAppendix} />
      <LimitationsCard limitations={report.limitations} />

      {/* Benchmark Section */}
      {status === "idle" && chatId && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-lg">
                <BarChart3Icon className="size-5" />
                Benchmark Evaluation
              </CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRunBenchmark}
                disabled={isRunningBenchmark}
              >
                {isRunningBenchmark ? (
                  <>
                    <Loader2Icon className="mr-2 size-4 animate-spin" />
                    Running...
                  </>
                ) : (
                  <>
                    <BarChart3Icon className="mr-2 size-4" />
                    {benchmarkRunId ? "Re-run Benchmark" : "Run Benchmark"}
                  </>
                )}
              </Button>
            </div>
            <CardDescription>
              Evaluate conversation quality, evidence integrity, and diagnostic performance
            </CardDescription>
          </CardHeader>
          {benchmarkRunId && (
            <CardContent>
              <BenchmarkReportCard runId={benchmarkRunId} />
            </CardContent>
          )}
        </Card>
      )}

      {status === "streaming" && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="animate-pulse">●</span>
          Generating report...
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Artifact Export
// ============================================================================

export const reportArtifact = new Artifact<"report", ReportArtifactMetadata>({
  kind: "report",
  description: "DSM-5 screening report with structured clinical findings.",
  onStreamPart: ({ streamPart, setArtifact }) => {
    if (streamPart.type === "data-reportDelta") {
      setArtifact((draftArtifact) => ({
        ...draftArtifact,
        content: draftArtifact.content + streamPart.data,
        isVisible:
          draftArtifact.content.length > 50 ? true : draftArtifact.isVisible,
        status: "streaming",
      }));
    }
  },
  content: ({ content, status, isLoading }) => {
    if (isLoading) {
      return <DocumentSkeleton artifactKind="text" />;
    }

    return (
      <div className="flex flex-col p-6 md:p-8">
        <ReportViewer content={content} status={status} />
      </div>
    );
  },
  actions: [
    {
      icon: <ClockRewind size={18} />,
      description: "View changes",
      onClick: ({ handleVersionChange }) => {
        handleVersionChange("toggle");
      },
      isDisabled: ({ currentVersionIndex }) => currentVersionIndex === 0,
    },
    {
      icon: <UndoIcon size={18} />,
      description: "View Previous version",
      onClick: ({ handleVersionChange }) => {
        handleVersionChange("prev");
      },
      isDisabled: ({ currentVersionIndex }) => currentVersionIndex === 0,
    },
    {
      icon: <RedoIcon size={18} />,
      description: "View Next version",
      onClick: ({ handleVersionChange }) => {
        handleVersionChange("next");
      },
      isDisabled: ({ isCurrentVersion }) => isCurrentVersion,
    },
    {
      icon: <CopyIcon size={18} />,
      description: "Copy report to clipboard",
      onClick: ({ content }) => {
        const plainText = content
          .replace(/<details>|<\/details>/g, "")
          .replace(/<summary>(.*?)<\/summary>/g, "[$1]")
          .replace(/<sym>(.*?)<\/sym>/g, "$1")
          .replace(/<quote>(.*?)<\/quote>/g, '"$1"')
          .replace(/<med>(.*?)<\/med>/g, "$1");
        navigator.clipboard.writeText(plainText);
        toast.success("Report copied to clipboard!");
      },
    },
  ],
  toolbar: [
    {
      icon: <RedoIcon />,
      description: "Regenerate report",
      onClick: ({ sendMessage }) => {
        sendMessage({
          role: "user",
          parts: [
            {
              type: "text",
              text: "Please regenerate the screening report with the latest data.",
            },
          ],
        });
      },
    },
  ],
});
