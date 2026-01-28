"use client";

import { useCallback, useEffect } from "react";
import { useSWRConfig } from "swr";
import { unstable_serialize } from "swr/infinite";
import { initialArtifactData, useArtifact } from "@/hooks/use-artifact";
import type { ArtifactKind } from "./artifact";
import { artifactDefinitions } from "./artifact";
import { useDataStream } from "./data-stream-provider";
import { getChatHistoryPaginationKey } from "./sidebar-history";

export function DataStreamHandler() {
  const { dataStream, setDataStream } = useDataStream();
  const { mutate } = useSWRConfig();

  const { artifact, setArtifact, setMetadata } = useArtifact();

  // Handle custom event to open artifact from clickable links
  const handleOpenArtifact = useCallback(
    (
      event: CustomEvent<{
        documentId: string;
        title: string;
        kind: ArtifactKind;
      }>
    ) => {
      const { documentId, title, kind } = event.detail;
      setArtifact({
        ...initialArtifactData,
        documentId,
        title,
        kind,
        isVisible: true,
        status: "idle",
      });
    },
    [setArtifact]
  );

  useEffect(() => {
    window.addEventListener(
      "open-artifact",
      handleOpenArtifact as EventListener
    );
    return () => {
      window.removeEventListener(
        "open-artifact",
        handleOpenArtifact as EventListener
      );
    };
  }, [handleOpenArtifact]);

  useEffect(() => {
    if (!dataStream?.length) {
      return;
    }

    const newDeltas = dataStream.slice();
    setDataStream([]);

    console.log("[DEBUG] DataStreamHandler processing", newDeltas.length, "deltas");

    // Track kind from stream events to handle timing issues
    let streamKind = artifact.kind;

    for (const delta of newDeltas) {
      console.log("[DEBUG] Processing delta:", delta.type, delta);
      // Handle chat title updates
      if (delta.type === "data-chat-title") {
        mutate(unstable_serialize(getChatHistoryPaginationKey));
        continue;
      }

      // Update streamKind if we receive a kind event
      if (delta.type === "data-kind") {
        streamKind = delta.data;
      }

      // Use streamKind instead of artifact.kind for proper timing
      const artifactDefinition = artifactDefinitions.find(
        (currentArtifactDefinition) =>
          currentArtifactDefinition.kind === streamKind
      );

      if (artifactDefinition?.onStreamPart) {
        artifactDefinition.onStreamPart({
          streamPart: delta,
          setArtifact,
          setMetadata,
        });
      }

      setArtifact((draftArtifact) => {
        if (!draftArtifact) {
          return { ...initialArtifactData, status: "streaming" };
        }

        switch (delta.type) {
          case "data-id":
            console.log("[DEBUG] Setting artifact visible with documentId:", delta.data);
            return {
              ...draftArtifact,
              documentId: delta.data,
              status: "streaming",
              isVisible: true, // Auto-open artifact when streaming starts
            };

          case "data-title":
            return {
              ...draftArtifact,
              title: delta.data,
              status: "streaming",
            };

          case "data-kind":
            return {
              ...draftArtifact,
              kind: delta.data,
              status: "streaming",
            };

          case "data-clear":
            return {
              ...draftArtifact,
              content: "",
              status: "streaming",
            };

          case "data-finish":
            return {
              ...draftArtifact,
              status: "idle",
            };

          default:
            return draftArtifact;
        }
      });
    }
  }, [dataStream, setArtifact, setMetadata, artifact, setDataStream, mutate]);

  return null;
}
