import type { UIMessageStreamWriter } from "ai";
import { tool } from "ai";
import { z } from "zod";
import {
  getDsmSessionByChatId,
  getItemResponsesBySessionId,
  saveDocument,
} from "@/lib/db/queries";
import { DSM5_LEVEL1_ITEMS } from "@/lib/dsm5/items";
import type { RiskFlags } from "@/lib/dsm5/schemas";
import {
  DOMAIN_THRESHOLDS,
  evaluateDomainThreshold,
} from "@/lib/dsm5/thresholds";
import type { ChatMessage } from "@/lib/types";
import { generateUUID } from "@/lib/utils";

type GenerateReportProps = {
  chatId: string;
  userId: string;
  dataStream: UIMessageStreamWriter<ChatMessage>;
};

// Input schema
const generateReportInputSchema = z.object({
  regenerate: z
    .boolean()
    .optional()
    .default(false)
    .describe("Whether to regenerate an existing report"),
});

/**
 * Build the markdown report from session data
 */
async function buildReportContent(chatId: string): Promise<string> {
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

  // 3. Evaluate domains
  const domainResults = DOMAIN_THRESHOLDS.map((config) => {
    const result = evaluateDomainThreshold(config, itemScores);

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

    return {
      domain: config.domain,
      severity: result.severity,
      meetsThreshold: result.meetsThreshold,
      maxScore: result.maxScore,
      evidenceSummary,
      evidenceType,
      clinicalNote: config.clinicalNote,
    };
  });

  // 4. Calculate risk level
  const riskFlags = session.riskFlags as RiskFlags;
  const flaggedDomains = domainResults.filter((d) => d.meetsThreshold);

  let riskLevel: "Low" | "Moderate" | "High" | "Critical" = "Low";
  if (riskFlags.suicidalityMentioned || riskFlags.selfHarmIdeation) {
    riskLevel = "Critical";
  } else if (riskFlags.violenceRisk) {
    riskLevel = "High";
  } else if (flaggedDomains.length >= 5) {
    riskLevel = "High";
  } else if (flaggedDomains.length >= 3) {
    riskLevel = "Moderate";
  } else if (flaggedDomains.length >= 1) {
    riskLevel = "Moderate";
  }

  // 5. Build the report
  const report: string[] = [];

  // Header
  report.push("# DSM-5 Level-1 Screening Report");
  report.push("");
  report.push(`**Generated:** ${new Date().toLocaleDateString()}`);
  report.push(`**Session Status:** ${session.sessionStatus}`);
  report.push("");

  // Executive Summary
  report.push("## Executive Summary");
  report.push("");
  report.push(buildSummary(flaggedDomains, riskLevel, riskFlags));
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
  if (flaggedDomains.length > 0) {
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
  report.push(
    "- This is a **screening tool only**, not a diagnostic instrument"
  );
  report.push(
    "- Results should be validated by a qualified mental health professional"
  );
  report.push(
    "- Does not account for medical conditions that may cause similar symptoms"
  );
  report.push("- Based on self-reported symptoms over a specified time period");
  report.push(
    "- High ambiguity scores indicate uncertain responses that may need clarification"
  );
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

  parts.push(
    `This screening identified **${flaggedDomains.length}** symptom domain(s) meeting clinical thresholds for further evaluation.`
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

/**
 * Tool to generate the DSM-5 screening report
 */
export const generateReport = ({
  chatId,
  userId,
  dataStream,
}: GenerateReportProps) =>
  tool({
    description:
      "Generate the DSM-5 Level-1 Screening Report after the diagnostic analysis is complete. " +
      "This creates a structured clinical report with executive summary, risk assessment, " +
      "symptom domain summary, item-level appendix, and recommendations.",
    inputSchema: generateReportInputSchema,
    execute: async ({ regenerate }) => {
      console.log("[SERVER] generateReport called for chatId:", chatId);
      
      // 1. Check session exists and is complete
      const session = await getDsmSessionByChatId({ chatId });
      if (!session) {
        console.log("[SERVER] No session found for chatId:", chatId);
        return {
          success: false,
          error: "No DSM-5 session found for this chat",
        };
      }

      console.log("[SERVER] Session found, status:", session.sessionStatus);

      // Session should be completed or at least in DONE state
      if (
        session.sessionStatus !== "completed" &&
        session.sessionStatus !== "active"
      ) {
        console.log("[SERVER] Invalid session status:", session.sessionStatus);
        return {
          success: false,
          error: `Session is not in a valid state for report generation. Status: ${session.sessionStatus}`,
        };
      }

      // 2. Build the report content
      console.log("[SERVER] Building report content...");
      const reportContent = await buildReportContent(chatId);
      console.log("[SERVER] Report content built, length:", reportContent.length);

      // 3. Generate document ID and title
      const documentId = generateUUID();
      const title = `DSM-5 Screening Report - ${new Date().toLocaleDateString()}`;

      // 4. Stream artifact data to UI so it auto-opens
      console.log("[SERVER] Streaming artifact data, documentId:", documentId);
      dataStream.write({ type: "data-id", data: documentId });
      dataStream.write({ type: "data-title", data: title });
      dataStream.write({ type: "data-kind", data: "report" });
      dataStream.write({ type: "data-clear", data: null });

      // Stream content in chunks for visual effect
      const chunkSize = 100;
      for (let i = 0; i < reportContent.length; i += chunkSize) {
        const chunk = reportContent.slice(i, i + chunkSize);
        dataStream.write({
          type: "data-reportDelta",
          data: chunk,
        });
      }

      dataStream.write({ type: "data-finish", data: null });
      console.log("[SERVER] Finished streaming report data");

      // 5. Save the document to database (with chatId for sidebar linking)
      console.log("[SERVER] Saving document to database...");
      await saveDocument({
        id: documentId,
        title,
        content: reportContent,
        kind: "report",
        userId,
        chatId,
      });
      console.log("[SERVER] Document saved successfully");

      // 6. Return success with document info
      console.log("[SERVER] Returning success");
      return {
        success: true,
        documentId,
        title,
        message: regenerate
          ? "Report has been regenerated successfully."
          : "Screening report has been generated successfully.",
        summary: {
          generatedAt: new Date().toISOString(),
          sessionStatus: session.sessionStatus,
        },
      };
    },
  });
