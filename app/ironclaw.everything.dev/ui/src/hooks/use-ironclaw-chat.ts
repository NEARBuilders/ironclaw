import { consumeEventIterator } from "@orpc/client";
import type { UIMessage } from "@tanstack/ai/client";
import { useChat } from "@tanstack/ai-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "@/app";
import type { StagedAttachment } from "@/lib/attachments";

interface RunState {
  phase:
    | "idle"
    | "submitted"
    | "running"
    | "awaiting_approval"
    | "auth_required"
    | "failed"
    | "cancelled"
    | "disconnected";
  runId?: string;
  message?: string;
  gateRef?: string;
  gateHeadline?: string;
  gateBody?: string;
  authRequestRef?: string;
  authHeadline?: string;
  authBody?: string;
  authUrl?: string;
  activeToolName?: string;
}

export type { RunState };

function messageTextContent(message: UIMessage): string {
  return message.parts
    .filter((part): part is { type: "text"; content: string } => part.type === "text")
    .map((part) => part.content)
    .join(" ");
}

export function useIronclawChat(
  threadId: string,
  apiClient: ApiClient,
  initialMessages: Array<UIMessage>,
) {
  const activeRunIdRef = useRef<string | null>(null);
  const pendingAttachmentsRef = useRef<StagedAttachment[]>([]);
  const [runState, setRunState] = useState<RunState>({ phase: "idle" });
  const onRunStateChangeRef = useRef<(update: Partial<RunState>) => void>(() => {});

  onRunStateChangeRef.current = (update) => {
    setRunState((prev) => ({ ...prev, ...update }));
  };

  const initialMessagesRef = useRef(initialMessages);

  const chat = useChat({
    threadId,
    initialMessages,
    fetcher: async function* ({ messages }, { signal }) {
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      const content = lastUser ? messageTextContent(lastUser) : "";
      const attachments = pendingAttachmentsRef.current;
      pendingAttachmentsRef.current = [];

      onRunStateChangeRef.current({ phase: "submitted", message: undefined });

      const accepted = await apiClient.ironclaw.threads.sendMessage({
        id: threadId,
        content,
        clientActionId: `ui-${crypto.randomUUID()}`,
        attachments: attachments?.map((a) => ({
          mimeType: a.mimeType,
          filename: a.filename,
          dataBase64: a.dataBase64,
        })),
      });

      const runId = accepted.runId ?? accepted.activeRunId ?? crypto.randomUUID();
      activeRunIdRef.current = runId;
      onRunStateChangeRef.current({ phase: "running", runId });

      yield { type: "RUN_STARTED" as const, threadId, runId };

      const replyMessageId = `reply-${runId}`;
      const afterCursor =
        accepted.eventCursor != null ? String(accepted.eventCursor) : undefined;

      const activeToolCalls = new Map<
        string,
        { toolCallId: string; toolName: string }
      >();
      const pendingPreviews = new Map<
        string,
        {
          title?: string;
          inputSummary?: string;
          output: string;
          outputKind?: string;
          truncated?: boolean;
        }
      >();

      let done = false;
      const buffer: any[] = [];
      let resolveNext: (() => void) | null = null;

      function notify() {
        const r = resolveNext;
        resolveNext = null;
        r?.();
      }

      const unsubscribe = consumeEventIterator(
        apiClient.ironclaw.threads.streamEvents({ id: threadId, afterCursor }),
        {
          onEvent: (event: any) => {
            const type = event.type as string;

            switch (type) {
              case "accepted":
              case "running": {
                const crr = event.runState?.runId ?? event.ack?.runId ?? runId;
                onRunStateChangeRef.current({
                  phase: "running",
                  runId: crr,
                  message: undefined,
                  gateRef: undefined,
                  gateHeadline: undefined,
                  gateBody: undefined,
                  authRequestRef: undefined,
                  authHeadline: undefined,
                  authBody: undefined,
                  authUrl: undefined,
                });
                break;
              }

              case "gate": {
                const g = event.prompt ?? {};
                onRunStateChangeRef.current({
                  phase: "awaiting_approval",
                  gateRef: g.gateRef,
                  gateHeadline: g.headline,
                  gateBody: g.body,
                });
                const approvalContext = g.approvalContext ?? {};
                const gateToolName = approvalContext.toolName ?? "";
                const gateToolCallId =
                  g.gateRef ??
                  (gateToolName ? `gate-${gateToolName}-${runId}` : `gate-${runId}`);
                buffer.push({ type: "TOOL_CALL_START" as const, toolCallId: gateToolCallId, toolCallName: gateToolName || "approval", toolName: gateToolName || "approval" });
                buffer.push({ type: "TOOL_CALL_END" as const, toolCallId: gateToolCallId, toolCallName: gateToolName || "approval" });
                buffer.push({
                  type: "CUSTOM" as const,
                  name: "approval-requested",
                  value: {
                    toolCallId: gateToolCallId,
                    toolName: gateToolName || "approval",
                    input: JSON.stringify(approvalContext),
                    approval: { id: g.gateRef, needsApproval: true },
                  },
                });
                activeToolCalls.set(gateToolCallId, { toolCallId: gateToolCallId, toolName: gateToolName || "approval" });
                notify();
                break;
              }

              case "auth_required": {
                const a = event.authPrompt ?? {};
                onRunStateChangeRef.current({
                  phase: "auth_required",
                  authRequestRef: a.authRequestRef,
                  authHeadline: a.headline,
                  authBody: a.body,
                  authUrl: a.authorizationUrl,
                });
                break;
              }

              case "capability_progress":
                break;

              case "capability_activity": {
                const act = event.activity ?? {};
                const invId = act.invocationId as string | undefined;
                const capId = act.capabilityId as string | undefined;
                const actStatus = act.status as string | undefined;
                const errKind = act.errorKind as string | undefined;
                if (!invId || !capId) break;

                if (actStatus === "started" || actStatus === "running") {
                  if (!activeToolCalls.has(invId)) {
                    const displayName = pendingPreviews.get(invId)?.title ?? capId;
                    activeToolCalls.set(invId, { toolCallId: invId, toolName: displayName });
                    onRunStateChangeRef.current({ activeToolName: displayName });
                    buffer.push({ type: "TOOL_CALL_START" as const, toolCallId: invId, toolCallName: displayName, toolName: displayName });
                    notify();
                  }
                } else if (actStatus === "completed" || actStatus === "failed" || actStatus === "killed") {
                  const isToolError = actStatus === "failed" || actStatus === "killed";
                  const toolState = isToolError ? "output-error" : "output-available";
                  const preview = pendingPreviews.get(invId);
                  const displayTitle = preview?.title ?? capId;
                  buffer.push({ type: "TOOL_CALL_END" as const, toolCallId: invId, toolCallName: displayTitle, state: toolState });
                  buffer.push({
                    type: "TOOL_CALL_RESULT" as const,
                    messageId: replyMessageId,
                    toolCallId: invId,
                    content: JSON.stringify({
                      output: preview?.output ?? (errKind ? `Error: ${errKind}` : ""),
                      output_kind: preview?.outputKind ?? null,
                      truncated: preview?.truncated ?? false,
                      input_summary: preview?.inputSummary ?? null,
                      title: displayTitle,
                    }),
                    state: toolState,
                  });
                  pendingPreviews.delete(invId);
                  activeToolCalls.delete(invId);
                  onRunStateChangeRef.current({ activeToolName: undefined });
                  notify();
                }
                break;
              }

              case "capability_display_preview": {
                const prev = event.preview ?? {};
                const prevInvId = prev.invocationId as string | undefined;
                if (prevInvId) {
                  const previewTitle = prev.title as string | undefined;
                  const previewOutput =
                    (prev.outputSummary as string) ?? (prev.outputPreview as string) ?? "";
                  pendingPreviews.set(prevInvId, {
                    title: previewTitle,
                    inputSummary: prev.inputSummary as string | undefined,
                    output: previewOutput,
                    outputKind: prev.outputKind as string | undefined,
                    truncated: !!(prev.truncated as boolean | undefined),
                  });
                  if (!activeToolCalls.has(prevInvId)) {
                    const prevCapId = prev.capabilityId as string | undefined;
                    const displayName = previewTitle ?? prevCapId ?? "unknown";
                    activeToolCalls.set(prevInvId, { toolCallId: prevInvId, toolName: displayName });
                    onRunStateChangeRef.current({ activeToolName: displayName });
                    buffer.push({ type: "TOOL_CALL_START" as const, toolCallId: prevInvId, toolCallName: displayName, toolName: displayName });
                    notify();
                  }
                }
                break;
              }

              case "final_reply": {
                const reply = event.reply ?? {};
                onRunStateChangeRef.current({ activeToolName: undefined });
                if (reply.text) {
                  buffer.push({ type: "TEXT_MESSAGE_START" as const, messageId: replyMessageId, role: "assistant" as const });
                  buffer.push({ type: "TEXT_MESSAGE_CONTENT" as const, messageId: replyMessageId, delta: reply.text });
                  buffer.push({ type: "TEXT_MESSAGE_END" as const, messageId: replyMessageId });
                }
                buffer.push({ type: "RUN_FINISHED" as const, threadId, runId });
                done = true;
                notify();
                break;
              }

              case "failed": {
                const failMsg =
                  event.response?.status ?? event.runState?.failure ?? "Run failed";
                const msg = typeof failMsg === "string" ? failMsg : JSON.stringify(failMsg);
                onRunStateChangeRef.current({ phase: "failed", message: msg, activeToolName: undefined });
                buffer.push({ type: "RUN_ERROR" as const, threadId, message: msg });
                done = true;
                notify();
                break;
              }

              case "cancelled": {
                onRunStateChangeRef.current({ phase: "cancelled", message: "Run was cancelled", activeToolName: undefined });
                buffer.push({ type: "RUN_FINISHED" as const, threadId, runId });
                done = true;
                notify();
                break;
              }

              case "projection_snapshot":
              case "projection_update":
              case "keep_alive":
                break;
            }
          },
          onError: (err: any) => {
            const msg = err instanceof Error ? err.message : String(err);
            onRunStateChangeRef.current({ phase: "disconnected", message: msg, activeToolName: undefined });
            buffer.push({ type: "RUN_ERROR" as const, threadId, message: msg });
            done = true;
            notify();
          },
          onFinish: () => {
            if (!done) {
              buffer.push({ type: "RUN_FINISHED" as const, threadId, runId });
              done = true;
              notify();
            }
          },
        },
      );

      signal.addEventListener("abort", () => { done = true; notify(); void unsubscribe(); }, { once: true });

      try {
        while (true) {
          if (buffer.length > 0) {
            yield buffer.shift();
          } else if (done) {
            break;
          } else {
            await new Promise<void>((resolve) => { resolveNext = resolve; });
          }
        }
        yield* buffer;
      } finally {
        void unsubscribe();
      }
    },
    onError: (error) => {
      console.error("[useIronclawChat]", error);
      setRunState((prev) => ({
        ...prev,
        phase: "failed",
        message: error instanceof Error ? error.message : String(error),
      }));
    },
  });

  useEffect(() => {
    if (initialMessages.length > 0 && initialMessages !== initialMessagesRef.current) {
      initialMessagesRef.current = initialMessages;
      chat.setMessages(initialMessages);
    }
  }, [initialMessages, chat]);

  useEffect(() => {
    if (!chat.isLoading && runState.phase !== "idle" && runState.phase !== "failed" && runState.phase !== "cancelled") {
      setRunState({ phase: "idle" });
    }
  }, [chat.isLoading, runState.phase]);

  const sendMessageWithAttachments = useCallback(
    (content: string, attachments?: StagedAttachment[]) => {
      pendingAttachmentsRef.current = attachments ?? [];
      chat.sendMessage(content);
    },
    [chat.sendMessage],
  );

  const resolveGate = useCallback(
    async (gateRef: string, approved: boolean) => {
      const runId = activeRunIdRef.current;
      if (!runId) throw new Error("Missing run ID for gate resolution");
      await apiClient.ironclaw.threads.resolveGate({
        id: threadId,
        runId,
        gateRef,
        resolution: approved ? "approved" : "denied",
      });
    },
    [apiClient, threadId],
  );

  return {
    messages: chat.messages,
    sendMessage: sendMessageWithAttachments,
    isLoading: chat.isLoading,
    status: chat.status,
    error: chat.error,
    stop: chat.stop,
    setMessages: chat.setMessages,
    resolveGate,
    runState,
  };
}
