"use client";

import { memo, useState } from "react";
import { cn } from "@/lib/utils";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./ui/hover-card";

export type Citation = {
  id: string;
  sectionPath: string | null;
  page: number | null;
  snippet: string;
  relevance: number;
  linkedDomain?: string;
};

/**
 * Format a citation for display as a badge
 */
function formatBadgeText(citation: Citation): string {
  if (citation.page) {
    return `DSM-5 p.${citation.page}`;
  }
  if (citation.sectionPath) {
    // Get the last segment(s) of the section path
    const segments = citation.sectionPath.split(" > ");
    if (segments.length >= 2) {
      return segments.slice(-2).join(" > ");
    }
    return segments.at(-1) ?? "DSM-5";
  }
  return "DSM-5";
}

/**
 * Get color classes based on relevance score
 */
function getRelevanceColors(relevance: number): string {
  if (relevance >= 0.85) {
    return "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800";
  }
  if (relevance >= 0.7) {
    return "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800";
  }
  return "bg-gray-100 dark:bg-gray-800/40 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700";
}

type CitationBadgeProps = {
  citation: Citation;
  className?: string;
};

function PureCitationBadge({ citation, className }: CitationBadgeProps) {
  const [isOpen, setIsOpen] = useState(false);
  const badgeText = formatBadgeText(citation);
  const colorClasses = getRelevanceColors(citation.relevance);

  return (
    <HoverCard onOpenChange={setIsOpen} open={isOpen} openDelay={200}>
      <HoverCardTrigger asChild>
        <button
          className={cn(
            "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition-colors cursor-pointer hover:opacity-80",
            colorClasses,
            className
          )}
          onClick={() => setIsOpen(!isOpen)}
          type="button"
        >
          <svg
            className="size-2.5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path
              d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {badgeText}
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-80 p-3" side="top">
        <div className="space-y-2">
          {citation.sectionPath && (
            <div className="text-xs font-medium text-muted-foreground">
              {citation.sectionPath}
            </div>
          )}
          <p className="text-sm leading-relaxed">{citation.snippet}</p>
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            {citation.page && <span>Page {citation.page}</span>}
            <span
              className={cn(
                "rounded px-1 py-0.5",
                citation.relevance >= 0.85
                  ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400"
                  : citation.relevance >= 0.7
                    ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                    : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400"
              )}
            >
              {Math.round(citation.relevance * 100)}% match
            </span>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

export const CitationBadge = memo(PureCitationBadge);

/**
 * Render a list of citation badges inline
 */
type CitationBadgeListProps = {
  citations: Citation[];
  maxVisible?: number;
  className?: string;
};

function PureCitationBadgeList({
  citations,
  maxVisible = 3,
  className,
}: CitationBadgeListProps) {
  if (citations.length === 0) return null;

  const visibleCitations = citations.slice(0, maxVisible);
  const remainingCount = citations.length - maxVisible;

  return (
    <div className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {visibleCitations.map((citation) => (
        <CitationBadge citation={citation} key={citation.id} />
      ))}
      {remainingCount > 0 && (
        <span className="text-[10px] text-muted-foreground">
          +{remainingCount} more
        </span>
      )}
    </div>
  );
}

export const CitationBadgeList = memo(PureCitationBadgeList);
