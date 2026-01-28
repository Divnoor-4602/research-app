import type { EvidenceSpan } from "./schemas";

type Span = { start: number; end: number };

function isInterviewerText(text: string): boolean {
  if (text.includes("?")) {
    return true;
  }

  const interviewerPatterns = [
    /^have you/i,
    /^do you/i,
    /^are you/i,
    /^how often/i,
    /^in the past/i,
    /^during the past/i,
    /^would you say/i,
  ];

  return interviewerPatterns.some((pattern) => pattern.test(text));
}

function deduplicateSpans(spans: Span[]): Span[] {
  if (spans.length <= 1) {
    return spans;
  }

  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const result: Span[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = result.at(-1);
    if (!last) {
      result.push(current);
      continue;
    }

    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
    } else {
      result.push(current);
    }
  }

  return result;
}

function generateSummaryFromSpans(text: string, spans: Span[]): string {
  if (spans.length === 0) {
    return "(inferred from response pattern)";
  }

  const firstSpan = spans[0];
  const extracted = text.slice(firstSpan.start, firstSpan.end);
  const truncated = extracted.length > 50 ? `${extracted.slice(0, 47)}...` : extracted;

  return `Patient: "${truncated}"`;
}

export function extractEvidenceSpans(
  patientText: string,
  llmQuotes: string[],
  messageIndex: number,
  llmSummary?: string
): EvidenceSpan {
  const spans: Span[] = [];
  const normalizedText = patientText.toLowerCase();

  for (const quote of llmQuotes) {
    const cleanQuote = quote
      .toLowerCase()
      .replace(/^["']|["']$/g, "")
      .replace(/^patient:\s*/i, "")
      .trim();

    if (!cleanQuote || cleanQuote.length < 3) {
      continue;
    }

    if (isInterviewerText(cleanQuote)) {
      continue;
    }

    const startIdx = normalizedText.indexOf(cleanQuote);
    if (startIdx !== -1) {
      spans.push({
        start: startIdx,
        end: startIdx + cleanQuote.length,
      });
    }
  }

  const dedupedSpans = deduplicateSpans(spans);

  return {
    type: dedupedSpans.length > 0 ? "direct_span" : "inferred",
    messageIndex,
    spans: dedupedSpans.slice(0, 3),
    strength: dedupedSpans.length > 0 ? 0.9 : 0.5,
    summary: llmSummary ?? generateSummaryFromSpans(patientText, dedupedSpans),
  };
}

export function validateEvidenceSpan(
  evidence: EvidenceSpan,
  patientText: string
): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  if (evidence.type === "inferred" || evidence.type === "none") {
    return { valid: true, issues: [] };
  }

  for (const span of evidence.spans) {
    if (span.start < 0) {
      issues.push(`Span start ${span.start} is negative`);
    }
    if (span.end > patientText.length) {
      issues.push(
        `Span end ${span.end} exceeds text length ${patientText.length}`
      );
    }
    if (span.start >= span.end) {
      issues.push(`Span start ${span.start} >= end ${span.end}`);
    }
  }

  return { valid: issues.length === 0, issues };
}

export function getEvidenceText(evidence: EvidenceSpan, patientText: string): string[] {
  if (evidence.type !== "direct_span") {
    return [];
  }

  return evidence.spans.map((span) => patientText.slice(span.start, span.end));
}

export function scoreEvidenceIntegrity(
  itemResponses: Array<{
    itemId: string;
    evidence?: EvidenceSpan;
  }>,
  transcript: Array<{ role: string; text: string }>
): {
  score: number;
  details: {
    totalItems: number;
    directSpanItems: number;
    inferredItems: number;
    noEvidenceItems: number;
    validSpans: number;
    invalidSpans: number;
  };
  issues: string[];
} {
  const issues: string[] = [];
  let directSpanItems = 0;
  let inferredItems = 0;
  let noEvidenceItems = 0;
  let validSpans = 0;
  let invalidSpans = 0;

  for (const response of itemResponses) {
    if (!response.evidence) {
      noEvidenceItems++;
      issues.push(`${response.itemId}: no evidence recorded`);
      continue;
    }

    const evidence = response.evidence;

    switch (evidence.type) {
      case "direct_span": {
        directSpanItems++;
        const message = transcript[evidence.messageIndex];
        if (!message) {
          invalidSpans++;
          issues.push(
            `${response.itemId}: messageIndex ${evidence.messageIndex} out of bounds`
          );
          break;
        }

        if (message.role !== "patient") {
          invalidSpans++;
          issues.push(
            `${response.itemId}: evidence references non-patient message`
          );
          break;
        }

        const validation = validateEvidenceSpan(evidence, message.text);
        if (validation.valid) {
          validSpans++;
        } else {
          invalidSpans++;
          issues.push(`${response.itemId}: ${validation.issues.join(", ")}`);
        }
        break;
      }
      case "inferred":
        inferredItems++;
        break;
      case "none":
        noEvidenceItems++;
        break;
    }
  }

  const totalItems = itemResponses.length;
  const score =
    totalItems > 0
      ? (validSpans * 1.0 + inferredItems * 0.5) / totalItems
      : 1.0;

  return {
    score,
    details: {
      totalItems,
      directSpanItems,
      inferredItems,
      noEvidenceItems,
      validSpans,
      invalidSpans,
    },
    issues,
  };
}
