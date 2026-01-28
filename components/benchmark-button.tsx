"use client";

import { BarChart3Icon, Loader2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "./ui/button";

interface BenchmarkButtonProps {
  chatId: string;
  onBenchmarkComplete?: (runId: string) => void;
  disabled?: boolean;
  className?: string;
}

export function BenchmarkButton({
  chatId,
  onBenchmarkComplete,
  disabled = false,
  className,
}: BenchmarkButtonProps) {
  const [isRunning, setIsRunning] = useState(false);

  const handleRunBenchmark = async () => {
    if (isRunning || disabled) return;

    setIsRunning(true);

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

      if (data.runId && onBenchmarkComplete) {
        onBenchmarkComplete(data.runId);
      }
    } catch (error) {
      console.error("Benchmark error:", error);
      toast.error("Failed to run benchmark");
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleRunBenchmark}
      disabled={isRunning || disabled}
      className={className}
    >
      {isRunning ? (
        <>
          <Loader2Icon className="mr-2 size-4 animate-spin" />
          Running...
        </>
      ) : (
        <>
          <BarChart3Icon className="mr-2 size-4" />
          Run Benchmark
        </>
      )}
    </Button>
  );
}
