import type { UseChatHelpers } from "@ai-sdk/react";
import { formatDistance } from "date-fns";
import equal from "fast-deep-equal";
import { AnimatePresence, motion } from "framer-motion";
import {
  type Dispatch,
  memo,
  type SetStateAction,
  useCallback,
  useEffect,
  useState,
} from "react";
import useSWR, { useSWRConfig } from "swr";
import { useDebounceCallback, useWindowSize } from "usehooks-ts";
import { codeArtifact } from "@/artifacts/code/client";
import { imageArtifact } from "@/artifacts/image/client";
import { reportArtifact } from "@/artifacts/report/client";
import { sheetArtifact } from "@/artifacts/sheet/client";
import { textArtifact } from "@/artifacts/text/client";
import { useArtifact } from "@/hooks/use-artifact";
import type { Document, Vote } from "@/lib/db/schema";
import type { Attachment, ChatMessage } from "@/lib/types";
import { fetcher } from "@/lib/utils";
import { ArtifactActions } from "./artifact-actions";
import { ArtifactCloseButton } from "./artifact-close-button";
import { ArtifactMessages } from "./artifact-messages";
import { MultimodalInput } from "./multimodal-input";
import { Toolbar } from "./toolbar";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "./ui/resizable";
import { useSidebar } from "./ui/sidebar";
import { VersionFooter } from "./version-footer";
import type { VisibilityType } from "./visibility-selector";

export const artifactDefinitions = [
  textArtifact,
  codeArtifact,
  imageArtifact,
  sheetArtifact,
  reportArtifact,
];
export type ArtifactKind = (typeof artifactDefinitions)[number]["kind"];

export type UIArtifact = {
  title: string;
  documentId: string;
  kind: ArtifactKind;
  content: string;
  isVisible: boolean;
  status: "streaming" | "idle";
  boundingBox: {
    top: number;
    left: number;
    width: number;
    height: number;
  };
};

function PureArtifact({
  addToolApprovalResponse,
  chatId,
  input,
  setInput,
  status,
  stop,
  attachments,
  setAttachments,
  sendMessage,
  messages,
  setMessages,
  regenerate,
  votes,
  isReadonly,
  selectedVisibilityType,
  selectedModelId,
}: {
  addToolApprovalResponse: UseChatHelpers<ChatMessage>["addToolApprovalResponse"];
  chatId: string;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  status: UseChatHelpers<ChatMessage>["status"];
  stop: UseChatHelpers<ChatMessage>["stop"];
  attachments: Attachment[];
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
  messages: ChatMessage[];
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  votes: Vote[] | undefined;
  sendMessage: UseChatHelpers<ChatMessage>["sendMessage"];
  regenerate: UseChatHelpers<ChatMessage>["regenerate"];
  isReadonly: boolean;
  selectedVisibilityType: VisibilityType;
  selectedModelId: string;
}) {
  const { artifact, setArtifact, metadata, setMetadata } = useArtifact();

  const {
    data: documents,
    isLoading: isDocumentsFetching,
    mutate: mutateDocuments,
  } = useSWR<Document[]>(
    artifact.documentId !== "init" && artifact.status !== "streaming"
      ? `/api/document?id=${artifact.documentId}`
      : null,
    fetcher
  );

  const [mode, setMode] = useState<"edit" | "diff">("edit");
  const [document, setDocument] = useState<Document | null>(null);
  const [currentVersionIndex, setCurrentVersionIndex] = useState(-1);

  const { open: isSidebarOpen } = useSidebar();

  useEffect(() => {
    if (documents && documents.length > 0) {
      const mostRecentDocument = documents.at(-1);

      if (mostRecentDocument) {
        setDocument(mostRecentDocument);
        setCurrentVersionIndex(documents.length - 1);
        setArtifact((currentArtifact) => ({
          ...currentArtifact,
          content: mostRecentDocument.content ?? "",
        }));
      }
    }
  }, [documents, setArtifact]);

  useEffect(() => {
    mutateDocuments();
  }, [mutateDocuments]);

  const { mutate } = useSWRConfig();
  const [isContentDirty, setIsContentDirty] = useState(false);

  const handleContentChange = useCallback(
    (updatedContent: string) => {
      if (!artifact) {
        return;
      }

      mutate<Document[]>(
        `/api/document?id=${artifact.documentId}`,
        async (currentDocuments) => {
          if (!currentDocuments) {
            return [];
          }

          const currentDocument = currentDocuments.at(-1);

          if (!currentDocument || !currentDocument.content) {
            setIsContentDirty(false);
            return currentDocuments;
          }

          if (currentDocument.content !== updatedContent) {
            await fetch(`/api/document?id=${artifact.documentId}`, {
              method: "POST",
              body: JSON.stringify({
                title: artifact.title,
                content: updatedContent,
                kind: artifact.kind,
              }),
            });

            setIsContentDirty(false);

            const newDocument = {
              ...currentDocument,
              content: updatedContent,
              createdAt: new Date(),
            };

            return [...currentDocuments, newDocument];
          }
          return currentDocuments;
        },
        { revalidate: false }
      );
    },
    [artifact, mutate]
  );

  const debouncedHandleContentChange = useDebounceCallback(
    handleContentChange,
    2000
  );

  const saveContent = useCallback(
    (updatedContent: string, debounce: boolean) => {
      if (document && updatedContent !== document.content) {
        setIsContentDirty(true);

        if (debounce) {
          debouncedHandleContentChange(updatedContent);
        } else {
          handleContentChange(updatedContent);
        }
      }
    },
    [document, debouncedHandleContentChange, handleContentChange]
  );

  function getDocumentContentById(index: number) {
    if (!documents) {
      return "";
    }
    if (!documents[index]) {
      return "";
    }
    return documents[index].content ?? "";
  }

  const handleVersionChange = (type: "next" | "prev" | "toggle" | "latest") => {
    if (!documents) {
      return;
    }

    if (type === "latest") {
      setCurrentVersionIndex(documents.length - 1);
      setMode("edit");
    }

    if (type === "toggle") {
      setMode((currentMode) => (currentMode === "edit" ? "diff" : "edit"));
    }

    if (type === "prev") {
      if (currentVersionIndex > 0) {
        setCurrentVersionIndex((index) => index - 1);
      }
    } else if (type === "next" && currentVersionIndex < documents.length - 1) {
      setCurrentVersionIndex((index) => index + 1);
    }
  };

  const [isToolbarVisible, setIsToolbarVisible] = useState(false);

  /*
   * NOTE: if there are no documents, or if
   * the documents are being fetched, then
   * we mark it as the current version.
   */

  const isCurrentVersion =
    documents && documents.length > 0
      ? currentVersionIndex === documents.length - 1
      : true;

  const { width: windowWidth, height: windowHeight } = useWindowSize();
  const isMobile = windowWidth ? windowWidth < 768 : false;

  const artifactDefinition = artifactDefinitions.find(
    (definition) => definition.kind === artifact.kind
  );

  if (!artifactDefinition) {
    throw new Error("Artifact definition not found!");
  }

  useEffect(() => {
    if (artifact.documentId !== "init" && artifactDefinition.initialize) {
      artifactDefinition.initialize({
        documentId: artifact.documentId,
        setMetadata,
      });
    }
  }, [artifact.documentId, artifactDefinition, setMetadata]);

  // Shared artifact content renderer
  const renderArtifactContent = () => (
    <>
      <div className="flex flex-row items-start justify-between p-2">
        <div className="flex flex-row items-start gap-4">
          <ArtifactCloseButton />

          <div className="flex flex-col">
            <div className="font-medium">{artifact.title}</div>

            {isContentDirty ? (
              <div className="text-muted-foreground text-sm">
                Saving changes...
              </div>
            ) : document ? (
              <div className="text-muted-foreground text-sm">
                {`Updated ${formatDistance(
                  new Date(document.createdAt),
                  new Date(),
                  {
                    addSuffix: true,
                  }
                )}`}
              </div>
            ) : (
              <div className="mt-2 h-3 w-32 animate-pulse rounded-md bg-muted-foreground/20" />
            )}
          </div>
        </div>

        <ArtifactActions
          artifact={artifact}
          currentVersionIndex={currentVersionIndex}
          handleVersionChange={handleVersionChange}
          isCurrentVersion={isCurrentVersion}
          metadata={metadata}
          mode={mode}
          setMetadata={setMetadata}
        />
      </div>

      <div className="h-full max-w-full! items-center overflow-y-scroll bg-background dark:bg-muted">
        <artifactDefinition.content
          content={
            isCurrentVersion
              ? artifact.content
              : getDocumentContentById(currentVersionIndex)
          }
          currentVersionIndex={currentVersionIndex}
          getDocumentContentById={getDocumentContentById}
          isCurrentVersion={isCurrentVersion}
          isInline={false}
          isLoading={isDocumentsFetching && !artifact.content}
          metadata={metadata}
          mode={mode}
          onSaveContent={saveContent}
          setMetadata={setMetadata}
          status={artifact.status}
          suggestions={[]}
          title={artifact.title}
        />

        <AnimatePresence>
          {isCurrentVersion && (
            <Toolbar
              artifactKind={artifact.kind}
              isToolbarVisible={isToolbarVisible}
              sendMessage={sendMessage}
              setIsToolbarVisible={setIsToolbarVisible}
              setMessages={setMessages}
              status={status}
              stop={stop}
            />
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {!isCurrentVersion && (
          <VersionFooter
            currentVersionIndex={currentVersionIndex}
            documents={documents}
            handleVersionChange={handleVersionChange}
          />
        )}
      </AnimatePresence>
    </>
  );

  // Shared chat panel renderer
  const renderChatPanel = () => (
    <div className="relative flex h-full flex-col bg-muted dark:bg-background">
      <AnimatePresence>
        {!isCurrentVersion && (
          <motion.div
            animate={{ opacity: 1 }}
            className="absolute top-0 left-0 z-50 h-full w-full bg-zinc-900/50"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
          />
        )}
      </AnimatePresence>

      <div className="flex h-full flex-col items-center justify-between">
        <ArtifactMessages
          addToolApprovalResponse={addToolApprovalResponse}
          artifactStatus={artifact.status}
          chatId={chatId}
          isReadonly={isReadonly}
          messages={messages}
          regenerate={regenerate}
          setMessages={setMessages}
          status={status}
          votes={votes}
        />

        <div className="relative flex w-full flex-row items-end gap-2 px-4 pb-4">
          <MultimodalInput
            attachments={attachments}
            chatId={chatId}
            className="bg-background dark:bg-muted"
            input={input}
            messages={messages}
            selectedModelId={selectedModelId}
            selectedVisibilityType={selectedVisibilityType}
            sendMessage={sendMessage}
            setAttachments={setAttachments}
            setInput={setInput}
            setMessages={setMessages}
            status={status}
            stop={stop}
          />
        </div>
      </div>
    </div>
  );

  return (
    <AnimatePresence>
      {artifact.isVisible && (
        <motion.div
          animate={{ opacity: 1 }}
          className="fixed top-0 left-0 z-50 flex h-dvh w-dvw flex-row bg-background"
          data-testid="artifact"
          exit={{ opacity: 0, transition: { delay: 0.4 } }}
          initial={{ opacity: 1 }}
        >
          {isMobile ? (
            // Mobile: Full-screen artifact only
            <motion.div
              animate={{
                opacity: 1,
                x: 0,
                y: 0,
                height: windowHeight,
                width: windowWidth ? windowWidth : "calc(100dvw)",
                borderRadius: 0,
                transition: {
                  delay: 0,
                  type: "spring",
                  stiffness: 300,
                  damping: 30,
                  duration: 0.8,
                },
              }}
              className="fixed flex h-dvh flex-col overflow-y-scroll border-zinc-200 bg-background md:border-l dark:border-zinc-700 dark:bg-muted"
              exit={{
                opacity: 0,
                scale: 0.5,
                transition: {
                  delay: 0.1,
                  type: "spring",
                  stiffness: 600,
                  damping: 30,
                },
              }}
              initial={{
                opacity: 1,
                x: artifact.boundingBox.left,
                y: artifact.boundingBox.top,
                height: artifact.boundingBox.height,
                width: artifact.boundingBox.width,
                borderRadius: 50,
              }}
            >
              {renderArtifactContent()}
            </motion.div>
          ) : (
            // Desktop: Resizable panels
            <ResizablePanelGroup
              className="h-dvh w-dvw"
              direction="horizontal"
            >
              <ResizablePanel
                className="h-dvh"
                defaultSize={30}
                minSize={20}
                maxSize={50}
              >
                {renderChatPanel()}
              </ResizablePanel>

              <ResizableHandle withHandle />

              <ResizablePanel
                className="flex h-dvh flex-col overflow-y-scroll border-zinc-200 bg-background dark:border-zinc-700 dark:bg-muted"
                defaultSize={70}
                minSize={50}
              >
                {renderArtifactContent()}
              </ResizablePanel>
            </ResizablePanelGroup>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export const Artifact = memo(PureArtifact, (prevProps, nextProps) => {
  if (prevProps.status !== nextProps.status) {
    return false;
  }
  if (!equal(prevProps.votes, nextProps.votes)) {
    return false;
  }
  if (prevProps.input !== nextProps.input) {
    return false;
  }
  if (!equal(prevProps.messages, nextProps.messages.length)) {
    return false;
  }
  if (prevProps.selectedVisibilityType !== nextProps.selectedVisibilityType) {
    return false;
  }

  return true;
});
