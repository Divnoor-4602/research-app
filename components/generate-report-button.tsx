"use client";

import { FileTextIcon, Loader2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { DiagnosticMode, RagMode } from "@/lib/dsm5/schemas";
import { Button } from "./ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";

type GenerateReportButtonProps = {
  chatId: string;
  ragMode?: RagMode;
  diagnosticMode?: DiagnosticMode;
  disabled?: boolean;
  className?: string;
};

export function GenerateReportButton({
  chatId,
  ragMode = "off",
  diagnosticMode = "screening",
  disabled = false,
  className,
}: GenerateReportButtonProps) {
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerateReport = async () => {
    if (isGenerating || disabled) return;

    setIsGenerating(true);

    try {
      const response = await fetch("/api/report/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ chatId, ragMode, diagnosticMode }),
      });

      const raw = await response.text();
      const data = raw ? (JSON.parse(raw) as { error?: string; documentId?: string; title?: string; kind?: string }) : {};

      if (!response.ok) {
        toast.error(data.error || "Failed to generate report");
        return;
      }

      // Dispatch event to open the artifact
      const event = new CustomEvent("open-artifact", {
        detail: {
          documentId: data.documentId,
          title: data.title,
          kind: data.kind,
        },
      });
      window.dispatchEvent(event);

      toast.success("Report generated successfully");
    } catch (error) {
      console.error("Error generating report:", error);
      toast.error("Failed to generate report");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className={className}
            disabled={disabled || isGenerating}
            onClick={handleGenerateReport}
            size="sm"
            variant="outline"
          >
            {isGenerating ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <FileTextIcon className="size-4" />
            )}
            <span className="ml-2">Generate Report</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>
            Generate Report
            {ragMode !== "off" && ` (RAG: ${ragMode})`}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
