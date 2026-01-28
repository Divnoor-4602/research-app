"use client";

import { memo } from "react";
import type { RagMode } from "@/lib/dsm5/schemas";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";

// Database/book icon for RAG mode
export const DatabaseBookIcon = ({ size = 16 }: { size?: number }) => (
  <svg
    height={size}
    strokeLinejoin="round"
    style={{ color: "currentcolor" }}
    viewBox="0 0 16 16"
    width={size}
  >
    <path
      clipRule="evenodd"
      d="M2 2.5C2 1.67157 2.67157 1 3.5 1H12.5C13.3284 1 14 1.67157 14 2.5V13.5C14 14.3284 13.3284 15 12.5 15H3.5C2.67157 15 2 14.3284 2 13.5V2.5ZM3.5 2.5H12.5V13.5H3.5V2.5ZM5 4.5H11V5.5H5V4.5ZM5 7H11V8H5V7ZM5 9.5H9V10.5H5V9.5Z"
      fill="currentColor"
      fillRule="evenodd"
    />
  </svg>
);

const RAG_MODE_CONFIG: Record<
  RagMode,
  { label: string; description: string; detail: string; color: string }
> = {
  off: {
    label: "Off",
    description: "No DSM-5 retrieval",
    detail: "Uses screening responses only. Fastest option.",
    color: "text-muted-foreground",
  },
  citations: {
    label: "Citations",
    description: "Include DSM-5 references",
    detail: "Retrieves relevant DSM passages (65% match). Adds citations to report.",
    color: "text-blue-600 dark:text-blue-400",
  },
  grounded: {
    label: "Grounded",
    description: "Strict criterion anchors",
    detail: "Requires patient quote + DSM criterion per claim. 75% match threshold. Most rigorous.",
    color: "text-green-600 dark:text-green-400",
  },
};

export type RagModeToggleProps = {
  ragMode: RagMode;
  onRagModeChange: (mode: RagMode) => void;
  disabled?: boolean;
  className?: string;
};

function PureRagModeToggle({
  ragMode,
  onRagModeChange,
  disabled = false,
  className,
}: RagModeToggleProps) {
  const config = RAG_MODE_CONFIG[ragMode];
  const isActive = ragMode !== "off";

  if (disabled) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              className={cn(
                "h-8 rounded-lg px-2 cursor-not-allowed opacity-50",
                className
              )}
              data-testid="rag-mode-toggle"
              disabled
              variant="ghost"
            >
              <DatabaseBookIcon size={14} />
              <span className="ml-1 text-xs font-medium">RAG</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p className="text-xs">DSM-5 Knowledge Base (No data ingested)</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <DropdownMenu>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                className={cn(
                  "h-8 rounded-lg px-2 transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary hover:bg-primary/20"
                    : "hover:bg-accent",
                  className
                )}
                data-testid="rag-mode-toggle"
                variant="ghost"
              >
                <DatabaseBookIcon size={14} />
                <span className={cn("ml-1 text-xs font-medium", config.color)}>
                  {config.label}
                </span>
                {isActive && (
                  <span className="ml-1.5 size-1.5 rounded-full bg-primary" />
                )}
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p className="text-xs">{config.description}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <DropdownMenuContent align="start" className="w-72">
        {(Object.keys(RAG_MODE_CONFIG) as RagMode[]).map((mode) => {
          const modeConfig = RAG_MODE_CONFIG[mode];
          const isSelected = mode === ragMode;
          return (
            <DropdownMenuItem
              className={cn("cursor-pointer py-2", isSelected && "bg-accent")}
              key={mode}
              onClick={() => onRagModeChange(mode)}
            >
              <div className="flex flex-col gap-0.5">
                <span className={cn("font-medium", modeConfig.color)}>
                  {modeConfig.label}
                </span>
                <span className="text-xs text-muted-foreground">
                  {modeConfig.description}
                </span>
                <span className="text-[10px] text-muted-foreground/60 leading-tight">
                  {modeConfig.detail}
                </span>
              </div>
              {isSelected && (
                <span className="ml-auto size-2 shrink-0 rounded-full bg-primary" />
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export const RagModeToggle = memo(PureRagModeToggle);
