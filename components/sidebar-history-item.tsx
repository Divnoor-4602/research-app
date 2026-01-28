import { formatDistanceToNow } from "date-fns";
import { ChevronDownIcon } from "lucide-react";
import Link from "next/link";
import { memo } from "react";
import useSWR from "swr";
import { useChatVisibility } from "@/hooks/use-chat-visibility";
import type { Chat } from "@/lib/db/schema";
import { fetcher } from "@/lib/utils";
import {
  CheckCircleFillIcon,
  GlobeIcon,
  LockIcon,
  MoreHorizontalIcon,
  ShareIcon,
  TrashIcon,
} from "./icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "./ui/sidebar";

type ChatReport = {
  id: string;
  title: string;
  kind: string;
  createdAt: string;
};

const ReportIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    fill="none"
    height="16"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="2"
    viewBox="0 0 24 24"
    width="16"
  >
    <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
  </svg>
);

type ParsedReportInfo = {
  mode: string;
  riskLevel: string;
  flagCount: number;
  hasRag: boolean;
};

/**
 * Parse metadata from report title
 * @example "DSM-5 Report | RAG:citations, diagnostic | Risk: High | 5 flags - 1/27/2026"
 * @example "DSM-5 Report | screening | Risk: Low | 0 flags - 1/27/2026"
 * Legacy: "DSM-5 Report (Mode: screening)" or "DSM-5 Screening Report - 1/27/2026"
 */
function parseReportInfo(title: string): ParsedReportInfo {
  // New format: "DSM-5 Report | mode | Risk: level | N flags - date"
  const newFormatMatch = title.match(
    /DSM-5 Report \| ([^|]+) \| Risk: (\w+) \| (\d+) flags/
  );
  if (newFormatMatch) {
    const modeStr = newFormatMatch[1].trim();
    const hasRag = modeStr.startsWith("RAG:");
    return {
      mode: modeStr,
      riskLevel: newFormatMatch[2],
      flagCount: Number.parseInt(newFormatMatch[3], 10),
      hasRag,
    };
  }

  // Legacy format: "DSM-5 Report (RAG: citations, Mode: diagnostic)"
  const legacyMatch = title.match(/\(([^)]+)\)/);
  if (legacyMatch) {
    const inner = legacyMatch[1];
    const hasRag = inner.includes("RAG:");
    return {
      mode: inner,
      riskLevel: "Unknown",
      flagCount: -1, // Unknown
      hasRag,
    };
  }

  // Very old format: "DSM-5 Screening Report - date"
  return {
    mode: "Standard",
    riskLevel: "Unknown",
    flagCount: -1,
    hasRag: false,
  };
}

/**
 * Get risk level badge color
 */
function getRiskColor(risk: string): string {
  switch (risk.toLowerCase()) {
    case "critical":
      return "text-red-600 dark:text-red-400";
    case "high":
      return "text-orange-600 dark:text-orange-400";
    case "moderate":
      return "text-yellow-600 dark:text-yellow-400";
    case "low":
      return "text-green-600 dark:text-green-400";
    default:
      return "text-muted-foreground";
  }
}

const PureChatItem = ({
  chat,
  isActive,
  onDelete,
  setOpenMobile,
}: {
  chat: Chat;
  isActive: boolean;
  onDelete: (chatId: string) => void;
  setOpenMobile: (open: boolean) => void;
}) => {
  const { visibilityType, setVisibilityType } = useChatVisibility({
    chatId: chat.id,
    initialVisibilityType: chat.visibility,
  });

  // Fetch reports for this chat
  const { data: reports } = useSWR<ChatReport[]>(
    `/api/document?chatId=${chat.id}&kind=report`,
    fetcher,
    { revalidateOnFocus: false }
  );

  const hasReport = reports && reports.length > 0;

  const handleOpenReport = (report: ChatReport) => {
    const event = new CustomEvent("open-artifact", {
      detail: {
        documentId: report.id,
        title: report.title,
        kind: "report",
      },
    });
    window.dispatchEvent(event);
  };

  return (
    <SidebarMenuItem className="group/item relative">
      <SidebarMenuButton asChild isActive={isActive}>
        <Link href={`/chat/${chat.id}`} onClick={() => setOpenMobile(false)}>
          <span className="flex-1 truncate pr-6">{chat.title}</span>
        </Link>
      </SidebarMenuButton>

      {/* Reports dropdown outside Link to prevent navigation conflicts */}
      {hasReport && reports && (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              className="absolute right-8 top-1/2 -translate-y-1/2 flex items-center justify-center px-1 py-0.5 rounded hover:bg-sidebar-accent text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 transition-colors z-10"
              onClick={(e) => e.stopPropagation()}
              type="button"
            >
              <ReportIcon className="size-4" />
              <ChevronDownIcon className="size-3 ml-0.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Reports ({reports.length})
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {reports.map((report) => {
              const info = parseReportInfo(report.title);
              return (
                <DropdownMenuItem
                  className="cursor-pointer flex flex-col items-start gap-1 py-2.5"
                  key={report.id}
                  onClick={() => handleOpenReport(report)}
                >
                  {/* Mode line */}
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{info.mode}</span>
                    {info.hasRag && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300">
                        RAG
                      </span>
                    )}
                  </div>
                  {/* Risk and flags line */}
                  <div className="flex items-center gap-3 text-xs">
                    {info.riskLevel !== "Unknown" && (
                      <span className={getRiskColor(info.riskLevel)}>
                        Risk: {info.riskLevel}
                      </span>
                    )}
                    {info.flagCount >= 0 && (
                      <span className="text-muted-foreground">
                        {info.flagCount} domain{info.flagCount !== 1 ? "s" : ""}{" "}
                        flagged
                      </span>
                    )}
                  </div>
                  {/* Timestamp */}
                  <span className="text-[10px] text-muted-foreground">
                    {formatDistanceToNow(new Date(report.createdAt), {
                      addSuffix: true,
                    })}
                  </span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <DropdownMenu modal={true}>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction
            className="mr-0.5 data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            showOnHover={!isActive}
          >
            <MoreHorizontalIcon />
            <span className="sr-only">More</span>
          </SidebarMenuAction>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" side="bottom">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="cursor-pointer">
              <ShareIcon />
              <span>Share</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent>
                <DropdownMenuItem
                  className="cursor-pointer flex-row justify-between"
                  onClick={() => {
                    setVisibilityType("private");
                  }}
                >
                  <div className="flex flex-row items-center gap-2">
                    <LockIcon size={12} />
                    <span>Private</span>
                  </div>
                  {visibilityType === "private" ? (
                    <CheckCircleFillIcon />
                  ) : null}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="cursor-pointer flex-row justify-between"
                  onClick={() => {
                    setVisibilityType("public");
                  }}
                >
                  <div className="flex flex-row items-center gap-2">
                    <GlobeIcon />
                    <span>Public</span>
                  </div>
                  {visibilityType === "public" ? <CheckCircleFillIcon /> : null}
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>

          <DropdownMenuItem
            className="cursor-pointer text-destructive focus:bg-destructive/15 focus:text-destructive dark:text-red-500"
            onSelect={() => onDelete(chat.id)}
          >
            <TrashIcon />
            <span>Delete</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
};

export const ChatItem = memo(PureChatItem, (prevProps, nextProps) => {
  if (prevProps.isActive !== nextProps.isActive) {
    return false;
  }
  return true;
});
