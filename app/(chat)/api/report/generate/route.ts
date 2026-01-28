import { auth } from "@/app/(auth)/auth";
import { runDiagnosis } from "@/lib/ai/tools/dsm5";
import {
  getDsmSessionByChatId,
  getItemResponsesBySessionId,
  saveDocument,
} from "@/lib/db/queries";
import { DSM5_LEVEL1_ITEMS } from "@/lib/dsm5/items";
import { isRagAvailable } from "@/lib/dsm5/retriever";
import type {
  DiagnoseOutput,
  DiagnosticMode,
  RagMode,
  RiskFlags,
} from "@/lib/dsm5/schemas";
import {
  DOMAIN_THRESHOLDS,
  evaluateDomainThreshold,
} from "@/lib/dsm5/thresholds";
import { generateUUID } from "@/lib/utils";

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const {
      chatId,
      ragMode = "off",
      diagnosticMode = "screening",
    } = (await request.json()) as {
      chatId: string;
      ragMode?: RagMode;
      diagnosticMode?: DiagnosticMode;
    };

    if (!chatId) {
      return Response.json({ error: "chatId is required" }, { status: 400 });
    }

    // Get DSM session
    const dsmSession = await getDsmSessionByChatId({ chatId });
    if (!dsmSession) {
      return Response.json(
        { error: "No DSM-5 session found for this chat" },
        { status: 404 }
      );
    }

    // Check for safety-terminated sessions
    if (dsmSession.sessionStatus === "terminated_for_safety") {
      return Response.json(
        { error: "Cannot generate report for safety-terminated session" },
        { status: 400 }
      );
    }

    // Run diagnosis if RAG is enabled (single source of truth)
    let diagnosisResult: DiagnoseOutput | null = null;
    let ragAvailable = false;

    if (ragMode !== "off") {
      ragAvailable = await isRagAvailable();
      if (ragAvailable) {
        const result = await runDiagnosis({
          chatId,
          ragMode,
          diagnosticMode,
          skipStateValidation: true, // Report can be generated at any time
          skipSessionUpdate: true, // Don't update session state from report generation
        });

        if (result.success) {
          // Extract DiagnoseOutput from the result (remove success flag)
          const { success: _, ...output } = result;
          diagnosisResult = output as DiagnoseOutput;
        }
      }
    }

    // Get summary data for title (from diagnosis result or calculate from session)
    const summaryData = await getReportSummaryData(chatId, diagnosisResult);

    // Build the report content (pure rendering)
    const reportContent = await buildReportContent(
      chatId,
      diagnosisResult,
      ragMode,
      ragAvailable,
      summaryData
    );

    // Generate document ID and title with mode info
    const documentId = generateUUID();
    const title = buildReportTitle(
      ragMode,
      diagnosticMode,
      summaryData.riskLevel,
      summaryData.flaggedCount
    );

    // Save the document
    await saveDocument({
      id: documentId,
      title,
      content: reportContent,
      kind: "report",
      userId: session.user.id,
      chatId,
    });

    return Response.json({
      success: true,
      documentId,
      title,
      kind: "report",
    });
  } catch (error) {
    console.error("Error generating DSM-5 report:", error);
    return Response.json(
      { error: "Failed to generate report" },
      { status: 500 }
    );
  }
}

type ReportSummaryData = {
  riskLevel: string;
  flaggedCount: number;
};

/**
 * Get summary data for report (risk level and flagged domain count)
 */
async function getReportSummaryData(
  chatId: string,
  diagnosisResult: DiagnoseOutput | null
): Promise<ReportSummaryData> {
  // Use diagnosis result if available
  if (diagnosisResult) {
    const flaggedCount = diagnosisResult.domains.filter(
      (d) => d.meetsThreshold
    ).length;
    return {
      riskLevel:
        diagnosisResult.riskLevel.charAt(0).toUpperCase() +
        diagnosisResult.riskLevel.slice(1),
      flaggedCount,
    };
  }

  // Calculate from session data
  const session = await getDsmSessionByChatId({ chatId });
  if (!session) {
    return { riskLevel: "Unknown", flaggedCount: 0 };
  }

  const itemResponsesRaw = await getItemResponsesBySessionId({
    sessionId: session.id,
  });

  const itemScores = new Map<string, number>();
  for (const response of itemResponsesRaw) {
    itemScores.set(response.itemId, response.score);
  }

  const flaggedCount = DOMAIN_THRESHOLDS.filter((config) => {
    const result = evaluateDomainThreshold(config, itemScores);
    return result.meetsThreshold;
  }).length;

  // DETERMINISTIC risk level - based ONLY on safety flags, not domain count
  const riskFlags = session.riskFlags as RiskFlags;
  let riskLevel = "Low";
  if (riskFlags.suicidalityMentioned || riskFlags.selfHarmIdeation) {
    riskLevel = "Critical";
  } else if (riskFlags.violenceRisk) {
    riskLevel = "High";
  }
  // No "moderate" based on flagged domain count - only safety flags determine risk

  return { riskLevel, flaggedCount };
}

/**
 * Build report title with mode and summary information
 */
function buildReportTitle(
  ragMode: RagMode,
  diagnosticMode: DiagnosticMode,
  riskLevel: string,
  flaggedCount: number
): string {
  const date = new Date().toLocaleDateString();
  const modeStr =
    ragMode === "off" ? diagnosticMode : `RAG:${ragMode}, ${diagnosticMode}`;
  return `DSM-5 Report | ${modeStr} | Risk: ${riskLevel} | ${flaggedCount} flags - ${date}`;
}

/**
 * Build the markdown report from session data
 */
async function buildReportContent(
  chatId: string,
  diagnosisResult: DiagnoseOutput | null,
  ragMode: RagMode,
  ragAvailable: boolean,
  _summaryData: ReportSummaryData
): Promise<string> {
  // 1. Get session
  const session = await getDsmSessionByChatId({ chatId });
  if (!session) {
    return "# Error\n\nNo DSM-5 session found for this chat.";
  }

  // 2. Get item responses
  const itemResponsesRaw = await getItemResponsesBySessionId({
    sessionId: session.id,
  });

  // Build maps for easy lookup
  const itemScores = new Map<string, number>();
  const itemResponses = new Map<
    string,
    {
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
    }
  >();

  for (const response of itemResponsesRaw) {
    itemScores.set(response.itemId, response.score);
    itemResponses.set(response.itemId, {
      score: response.score,
      ambiguity: response.ambiguity,
      evidenceQuotes: (response.evidenceQuotes as string[]) ?? [],
      evidence: response.evidence as
        | {
            type: "direct_span" | "inferred" | "none";
            messageIndex: number;
            spans: Array<{ start: number; end: number }>;
            strength: number;
            summary?: string;
          }
        | undefined,
    });
  }

  // 3. Evaluate domains (from session data for base report)
  // Select evidence from the HIGHEST-SCORING item in each domain (not random items)
  const domainResults = DOMAIN_THRESHOLDS.map((config) => {
    const result = evaluateDomainThreshold(config, itemScores);
    
    // Find highest-scoring item in this domain for evidence selection
    const sortedItems = config.itemIds
      .map((id) => ({
        id,
        score: itemScores.get(id) ?? 0,
        response: itemResponses.get(id),
      }))
      .sort((a, b) => b.score - a.score);

    const bestResponse = sortedItems[0]?.response;
    const evidenceSummary =
      bestResponse?.evidence?.summary ??
      bestResponse?.evidenceQuotes?.[0] ??
      null;
    const evidenceType = bestResponse?.evidence?.type ?? "none";
    const highestItemId = sortedItems[0]?.id ?? null;

    return {
      domain: config.domain,
      severity: result.severity,
      meetsThreshold: result.meetsThreshold,
      maxScore: result.maxScore,
      evidenceSummary,
      evidenceType,
      highestItemId,
      clinicalNote: config.clinicalNote,
    };
  });

  // 4. Calculate risk level - DETERMINISTIC based on safety flags only
  const riskFlags = session.riskFlags as RiskFlags;
  const flaggedDomains = domainResults.filter((d) => d.meetsThreshold);

  let riskLevel: string;
  if (diagnosisResult) {
    // Use diagnosis result's risk level (already deterministic)
    riskLevel =
      diagnosisResult.riskLevel.charAt(0).toUpperCase() +
      diagnosisResult.riskLevel.slice(1);
  } else {
    // DETERMINISTIC: only safety flags determine risk, not domain count
    riskLevel = "Low";
    if (riskFlags.suicidalityMentioned || riskFlags.selfHarmIdeation) {
      riskLevel = "Critical";
    } else if (riskFlags.violenceRisk) {
      riskLevel = "High";
    }
    // No "moderate" based on flagged count - prevents arbitrary risk inflation
  }

  // 5. Build the report
  const report: string[] = [];

  // Header
  report.push("# DSM-5 Level-1 Screening Report");
  report.push("");
  report.push(`**Generated:** ${new Date().toLocaleDateString()}`);
  report.push(`**Session Status:** ${session.sessionStatus}`);
  if (diagnosisResult?.ragUsed) {
    report.push(`**RAG Grounding:** Enabled (${ragMode} mode)`);
  }
  report.push("");

  // RAG unavailable warning
  if (ragMode !== "off" && !ragAvailable) {
    report.push(
      "> **Note:** DSM-5 citation index not available. Report generated without RAG grounding."
    );
    report.push("");
  }

  // Executive Summary (use LLM summary if available)
  report.push("## Executive Summary");
  report.push("");
  if (diagnosisResult) {
    report.push(diagnosisResult.overallSummary);
  } else {
    report.push(buildSummary(flaggedDomains, riskLevel, riskFlags));
  }
  report.push("");

  // Risk Assessment
  report.push("## Risk Assessment");
  report.push("");
  report.push(`**Overall Risk Level:** ${riskLevel}`);
  report.push("");
  if (riskFlags.suicidalityMentioned) {
    report.push(
      "- <sym>Suicidal ideation mentioned</sym> - Requires immediate attention"
    );
  }
  if (riskFlags.selfHarmIdeation) {
    report.push(
      "- <sym>Self-harm ideation detected</sym> - Requires follow-up"
    );
  }
  if (riskFlags.violenceRisk) {
    report.push("- <sym>Violence risk indicated</sym> - Requires assessment");
  }
  if (riskFlags.substanceAbuseSignal) {
    report.push("- <med>Substance use signals detected</med>");
  }
  if (
    !riskFlags.suicidalityMentioned &&
    !riskFlags.selfHarmIdeation &&
    !riskFlags.violenceRisk &&
    !riskFlags.substanceAbuseSignal
  ) {
    report.push("No immediate risk flags detected during screening.");
  }
  report.push("");

  // Diagnostic Impressions (from RAG-enriched diagnosis, if available)
  if (diagnosisResult && diagnosisResult.impressions.length > 0) {
    report.push("## Diagnostic Impressions");
    report.push("");
    report.push(
      "*The following impressions are generated from LLM analysis" +
        (diagnosisResult.ragUsed ? " grounded in DSM-5 criteria" : "") +
        ":*"
    );
    report.push("");
    for (const impression of diagnosisResult.impressions) {
      const confidence = Math.round(impression.confidence * 100);
      report.push(
        `### ${impression.label} (${confidence}% confidence)`
      );
      report.push("");
      report.push(`**Reasoning:** ${impression.reasoning}`);
      report.push("");
      if (impression.supportingDomains.length > 0) {
        report.push(
          `**Supporting Domains:** ${impression.supportingDomains.join(", ")}`
        );
      }
      if (impression.evidenceQuotes.length > 0) {
        report.push("");
        report.push("**Key Evidence:**");
        for (const quote of impression.evidenceQuotes.slice(0, 3)) {
          report.push(`- <quote>${quote}</quote>`);
        }
      }
      report.push("");
    }
  }

  // DSM-5 References (from RAG citations, if available)
  if (
    diagnosisResult &&
    diagnosisResult.ragUsed &&
    diagnosisResult.citations.length > 0
  ) {
    report.push("## DSM-5 References");
    report.push("");
    report.push(
      "*The following DSM-5 passages were retrieved to ground this analysis:*"
    );
    report.push("");
    for (const [index, citation] of diagnosisResult.citations.entries()) {
      const location = citation.page
        ? `p. ${citation.page}`
        : citation.sectionPath ?? "DSM-5";
      const relevance = Math.round(citation.relevance * 100);
      report.push(`**[${index + 1}] ${location}** (${relevance}% relevance)`);
      report.push("");
      report.push(`> ${citation.snippet}`);
      report.push("");
    }
  }

  // Symptom Domain Summary Table
  report.push("## Symptom Domain Summary");
  report.push("");
  report.push("| Domain | Severity | Flagged | Key Evidence |");
  report.push("|--------|----------|---------|--------------|");

  for (const domain of domainResults) {
    const flagged = domain.meetsThreshold ? "Yes" : "No";
    const evidence = domain.evidenceSummary
      ? `${domain.evidenceSummary.slice(0, 50)}${domain.evidenceSummary.length > 50 ? "..." : ""}`
      : "-";
    report.push(
      `| ${domain.domain} | ${domain.severity} | ${flagged} | ${evidence} |`
    );
  }
  report.push("");

  // Flagged Domains Detail
  if (flaggedDomains.length > 0) {
    report.push("### Flagged Domains Requiring Follow-up");
    report.push("");
    for (const domain of flaggedDomains) {
      report.push(`**${domain.domain}** (${domain.severity})`);
      report.push(`- ${domain.clinicalNote}`);
      if (domain.evidenceSummary) {
        report.push(`- Evidence: ${domain.evidenceSummary}`);
      }
      report.push("");
    }
  }

  // Item-Level Appendix (collapsible)
  report.push("<details>");
  report.push("<summary>Item-Level Appendix (23 items)</summary>");
  report.push("");
  report.push("| Item ID | Domain | Score | Ambiguity | Evidence |");
  report.push("|---------|--------|-------|-----------|----------|");

  for (const item of DSM5_LEVEL1_ITEMS) {
    const response = itemResponses.get(item.itemId);
    if (response) {
      const evidence =
        response.evidence?.summary ??
        (response.evidenceQuotes.length > 0
          ? `${response.evidenceQuotes[0].slice(0, 30)}...`
          : "-");
      report.push(
        `| ${item.itemId} | ${item.domain} | ${response.score}/4 | ${response.ambiguity}/10 | ${evidence} |`
      );
    } else {
      report.push(`| ${item.itemId} | ${item.domain} | - | - | Not assessed |`);
    }
  }
  report.push("");
  report.push("</details>");
  report.push("");

  // Recommendations
  report.push("## Recommendations");
  report.push("");
  if (diagnosisResult && diagnosisResult.recommendations.length > 0) {
    // Use LLM-generated recommendations
    report.push(
      "Based on the analysis, the following follow-up assessments are recommended:"
    );
    report.push("");
    for (const rec of diagnosisResult.recommendations) {
      report.push(`- ${rec}`);
    }
  } else if (flaggedDomains.length > 0) {
    report.push(
      "Based on the screening results, the following follow-up assessments are recommended:"
    );
    report.push("");
    const recommendations = [
      ...new Set(flaggedDomains.map((d) => d.clinicalNote)),
    ];
    for (const rec of recommendations) {
      report.push(`- ${rec}`);
    }
  } else {
    report.push(
      "No specific follow-up assessments indicated based on screening results."
    );
  }
  report.push("");

  // Limitations
  report.push("## Limitations");
  report.push("");
  if (diagnosisResult && diagnosisResult.limitations.length > 0) {
    // Use diagnosis-provided limitations
    for (const limitation of diagnosisResult.limitations) {
      report.push(`- ${limitation}`);
    }
  } else {
    // Default limitations
    report.push(
      "- This is a **screening tool only**, not a diagnostic instrument"
    );
    report.push(
      "- Results should be validated by a qualified mental health professional"
    );
    report.push(
      "- Does not account for medical conditions that may cause similar symptoms"
    );
    report.push(
      "- Based on self-reported symptoms over a specified time period"
    );
    report.push(
      "- High ambiguity scores indicate uncertain responses that may need clarification"
    );
  }
  report.push("");

  return report.join("\n");
}

/**
 * Build a summary paragraph
 */
function buildSummary(
  flaggedDomains: Array<{ domain: string; severity: string }>,
  riskLevel: string,
  riskFlags: RiskFlags
): string {
  const parts: string[] = [];

  // Use "screen-positive" instead of "clinical thresholds" (screening tool, not diagnostic)
  parts.push(
    `This screening identified **${flaggedDomains.length}** symptom domain(s) as **screen-positive**, warranting further clinical evaluation.`
  );

  if (flaggedDomains.length > 0) {
    const domains = flaggedDomains
      .map((d) => `<sym>${d.domain}</sym>`)
      .join(", ");
    parts.push(`Elevated domains include: ${domains}.`);
  }

  parts.push(`Overall risk level is assessed as **${riskLevel}**.`);

  if (riskFlags.suicidalityMentioned || riskFlags.selfHarmIdeation) {
    parts.push(
      "**Immediate safety assessment is recommended due to detected risk indicators.**"
    );
  }

  return parts.join(" ");
}
