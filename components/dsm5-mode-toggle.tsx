"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";

// Clinical/Medical clipboard icon for DSM-5 mode
export const ClipboardMedicalIcon = ({ size = 16 }: { size?: number }) => (
  <svg
    height={size}
    strokeLinejoin="round"
    style={{ color: "currentcolor" }}
    viewBox="0 0 16 16"
    width={size}
  >
    <path
      clipRule="evenodd"
      d="M6.5 1.5C6.5 0.671573 7.17157 0 8 0C8.82843 0 9.5 0.671573 9.5 1.5V2H11.5C12.0523 2 12.5 2.44772 12.5 3V14C12.5 14.5523 12.0523 15 11.5 15H4.5C3.94772 15 3.5 14.5523 3.5 14V3C3.5 2.44772 3.94772 2 4.5 2H6.5V1.5ZM8 1.25C7.86193 1.25 7.75 1.36193 7.75 1.5V3.25H6.5H5V13.5H11V3.25H9.5H8.25V1.5C8.25 1.36193 8.13807 1.25 8 1.25ZM7.25 7.25H6.5V8.75H7.25H7.375V8.875V9.5H8.875V8.875V8.75H9H9.5V7.25H9H8.875V7.125V6.5H7.375V7.125V7.25H7.25Z"
      fill="currentColor"
      fillRule="evenodd"
    />
  </svg>
);

export type Dsm5ModeToggleProps = {
  isEnabled: boolean;
  onToggle: (enabled: boolean) => void;
  disabled?: boolean;
  className?: string;
};

function PureDsm5ModeToggle({
  isEnabled,
  onToggle,
  disabled = false,
  className,
}: Dsm5ModeToggleProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className={cn(
              "h-8 rounded-lg px-2 transition-colors",
              isEnabled
                ? "bg-primary/10 text-primary hover:bg-primary/20"
                : "hover:bg-accent",
              className
            )}
            data-testid="dsm5-mode-toggle"
            disabled={disabled}
            onClick={(event) => {
              event.preventDefault();
              onToggle(!isEnabled);
            }}
            variant="ghost"
          >
            <ClipboardMedicalIcon size={14} />
            <span className="ml-1 text-xs font-medium">DSM-5</span>
            {isEnabled && (
              <span className="ml-1.5 size-1.5 rounded-full bg-primary" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p className="text-xs">
            {isEnabled
              ? "DSM-5 Screening Mode Active"
              : "Enable DSM-5 Screening Mode"}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export const Dsm5ModeToggle = memo(PureDsm5ModeToggle);
