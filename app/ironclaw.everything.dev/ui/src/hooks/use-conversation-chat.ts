import type { UIMessage } from "@tanstack/ai";
import type { StreamChunk } from "@tanstack/ai/client";
import { useChat } from "@tanstack/ai-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useApiClient } from "@/app";
import type { AuthGate, PendingApproval } from "@/hooks/conversation-chat-types";
import type { StagedAttachment } from "@/lib/attachments";
import { threadMessagesQueryKey } from "@/hooks/use-conversation";
import { createThreadLiveConnection } from "@/chat/thread-live-connection";

export interface UseConversationChatOptions {
  threadId: string;
  initialMessages: UIMessage[];
}

type GateResolution = "approved" | "denied" | "credential_provided" | "cancelled";

function threadResumeCursorKey(threadId: string) {
  return ["conversation", "thread-resume-cursor", threadId] as const;
}

export function useConversationChat({ threadId, initialMessages }: UseConversationChatOptions) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [authGates, setAuthGates] = useState<AuthGate[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [streamInterrupted, setStreamInterrupted] = useState(false);
  const [systemMessages, setSystemMessages] = useState<UIMessage[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(() =>
    queryClient.getQueryData<string>(threadResumeCursorKey(threadId)) ?? undefined,
  );

  const runIdRef = useRef<string | null>(null);
  const runCompletedNormallyRef = useRef(false);
  const runErroredRef = useRef(false);
  const intentionalStopRef = useRef(false);
  const pendingErrorDataRef = useRef<unknown>(null);
  const prevLoadingRef = useRef(false);
  const cursorRef = useRef<string | undefined>(cursor);

  useEffect(() => {
    const cachedCursor = queryClient.getQueryData<string>(threadResumeCursorKey(threadId)) ?? undefined;
    setCursor(cachedCursor);
    cursorRef.current = cachedCursor;
    runIdRef.current = null;
    runCompletedNormallyRef.current = false;
    runErroredRef.current = false;
    intentionalStopRef.current = false;
    pendingErrorDataRef.current = null;
    prevLoadingRef.current = false;
    setSystemMessages([]);
    setPendingApprovals([]);
    setAuthGates([]);
    setRunId(null);
    setStreamInterrupted(false);
  }, [queryClient, threadId]);

  const updateCursor = useCallback(
    (next: string | undefined) => {
      cursorRef.current = next;
      setCursor(next);
      if (next === undefined) {
        queryClient.removeQueries({ queryKey: threadResumeCursorKey(threadId) });
      } else {
        queryClient.setQueryData(threadResumeCursorKey(threadId), next);
      }
    },
    [queryClient, threadId],
  );

  const connection = useMemo(
    () =>
      createThreadLiveConnection({
        apiClient,
        threadId,
        getCursor: () => cursorRef.current,
        setCursor: updateCursor,
      }),
    [apiClient, threadId, updateCursor],
  );

  const chat = useChat({
    connection,
    initialMessages,
    threadId,
    id: threadId,
    live: true,
    devtools: { name: `Thread ${threadId.slice(0, 8)}` },

    onChunk(chunk: StreamChunk) {
      if (chunk.type === "RUN_STARTED") {
        const rid = chunk.runId ?? null;
        runIdRef.current = rid;
        setRunId(rid);
        setStreamInterrupted(false);
        runCompletedNormallyRef.current = false;
        runErroredRef.current = false;
        intentionalStopRef.current = false;
        return;
      }

      if (chunk.type === "RUN_ERROR") {
        runErroredRef.current = true;
        runIdRef.current = null;
        setRunId(null);
        setPendingApprovals([]);
        setAuthGates([]);
        void queryClient.invalidateQueries({ queryKey: threadMessagesQueryKey(threadId) });
        void queryClient.invalidateQueries({ queryKey: ["conversation", "threads"] });

        const errorData = pendingErrorDataRef.current;
        pendingErrorDataRef.current = null;
        const errorParts: UIMessage["parts"] = [{ type: "text" as const, content: chunk.message ?? "Run failed" }];
        if (errorData) {
          (errorParts as unknown[]).push({ type: "error-data" as const, content: errorData });
        }
        setSystemMessages((prev) => [
          ...prev,
          {
            id: `error-${Date.now()}`,
            role: "system" as const,
            parts: errorParts,
          },
        ]);
        return;
      }

      if (chunk.type === "RUN_FINISHED") {
        runCompletedNormallyRef.current = true;
        runIdRef.current = null;
        setRunId(null);
        setPendingApprovals([]);
        setAuthGates([]);
        void queryClient.invalidateQueries({ queryKey: threadMessagesQueryKey(threadId) });
        void queryClient.invalidateQueries({ queryKey: ["conversation", "threads"] });
        return;
      }

      if (chunk.type !== "CUSTOM") return;

      const name = chunk.name ?? "";
      const val = chunk.value as Record<string, unknown> | undefined;

      if (name === "approval-requested") {
        const approvalInfo = (val?.approval as Record<string, unknown>) ?? {};
        setPendingApprovals((prev) => [
          ...prev,
          {
            gateRef: String(approvalInfo.id ?? val?.toolCallId ?? ""),
            headline: String(val?.input ?? "Approval required"),
            toolName: (approvalInfo.toolName ?? val?.toolName) as string | undefined,
            description: approvalInfo.description as string | undefined,
            allowAlways: approvalInfo.allowAlways === true,
            action: approvalInfo.action as { label?: string; method?: string } | undefined,
            scope: approvalInfo.scope as { label?: string; reusable?: boolean } | undefined,
            destination: approvalInfo.destination as
              | { label?: string; url?: string; domain?: string }
              | undefined,
            details: approvalInfo.details as
              | Array<{ label?: string; value?: string }>
              | undefined,
          },
        ]);
        return;
      }

      if (name === "auth-required") {
        const prompt = val ?? {};
        setAuthGates((prev) => [
          ...prev,
          {
            runId: String(prompt.runId ?? prompt.turnRunId ?? ""),
            gateRef: String(prompt.authRequestRef ?? prompt.auth_request_ref ?? ""),
            challengeKind: String(prompt.challengeKind ?? "other"),
            provider: prompt.provider as string | undefined,
            accountLabel: prompt.accountLabel as string | undefined,
            authorizationUrl: prompt.authorizationUrl as string | undefined,
            expiresAt: prompt.expiresAt as string | undefined,
            headline: prompt.headline as string | undefined,
            body: prompt.body as string | undefined,
          },
        ]);
        return;
      }

      if (name === "failed") {
        const details = val?.details ?? val;
        if (details) {
          pendingErrorDataRef.current = details;
        }
        return;
      }

      if (name === "skill-activation") {
        const skillNames: string[] = (val?.skillNames ?? []) as string[];
        const feedback: string[] = (val?.feedback ?? []) as string[];
        const text = [...skillNames.map((n) => `Skill activated: ${n}`), ...feedback]
          .filter(Boolean)
          .join("\n");
        if (text) {
          setSystemMessages((prev) => [
            ...prev,
            {
              id: `skill-${(val?.id as string) ?? Date.now()}`,
              role: "system" as const,
              parts: [{ type: "text" as const, content: text }],
            },
          ]);
        }
        return;
      }

      if (name === "cursor") {
        const c = (val?.cursor as string) ?? undefined;
        if (c) {
          updateCursor(c);
        }
      }
    },
  });

  useEffect(() => {
    if (chat.messages.length === 0 && initialMessages.length > 0) {
      chat.setMessages(initialMessages);
    }
  }, [chat.messages, chat.setMessages, initialMessages]);

  const messages = useMemo(() => [...chat.messages, ...systemMessages], [chat.messages, systemMessages]);

  useEffect(() => {
    if (prevLoadingRef.current && !chat.isLoading) {
      if (!runCompletedNormallyRef.current && !runErroredRef.current && !intentionalStopRef.current) {
        setStreamInterrupted(true);
      }
    }
    prevLoadingRef.current = chat.isLoading;
  }, [chat.isLoading]);

  const sendMessage = useCallback(
    (content: string, attachments?: StagedAttachment[]) => {
      if (!content.trim() || chat.isLoading) return;

      setPendingApprovals([]);
      setAuthGates([]);
      setStreamInterrupted(false);
      intentionalStopRef.current = false;

      if (attachments?.length) {
        void chat
          .sendMessage({
            content: [
              { type: "text", content } as const,
              ...attachments.map((a) => {
                const type: "image" | "document" = a.mimeType.startsWith("image/")
                  ? "image"
                  : "document";
                return {
                  type,
                  source: { type: "data", value: a.dataBase64, mimeType: a.mimeType },
                } as const;
              }),
            ],
          })
          .catch((err) => {
            console.error("[ironclaw] sendMessage stream failed:", err);
          });
        return;
      }

      void chat.sendMessage(content).catch((err) => {
        console.error("[ironclaw] sendMessage stream failed:", err);
      });
    },
    [chat],
  );

  const stop = useCallback(() => {
    intentionalStopRef.current = true;
    const currentRunId = runIdRef.current;
    if (currentRunId) {
      apiClient.conversation.cancelRun({ threadId, runId: currentRunId }).catch(() => {});
    }
    runIdRef.current = null;
    setRunId(null);
    setPendingApprovals([]);
    setAuthGates([]);
    setStreamInterrupted(false);
    chat.stop();
  }, [apiClient, chat, threadId]);

  const resolveGate = useCallback(
    async (
      id: string,
      gateRef: string,
      resolution: GateResolution,
      opts?: { always?: boolean; credentialRef?: string },
    ) => {
      await apiClient.conversation.threadApprove({
        threadId,
        runId: id,
        gateRef,
        resolution,
        always: opts?.always,
        credentialRef: opts?.credentialRef,
      });
      setPendingApprovals((prev) => prev.filter((approval) => approval.gateRef !== gateRef));
    },
    [apiClient, threadId],
  );

  const submitAuthToken = useCallback(
    async (
      runId: string,
      gateRef: string,
      provider: string,
      accountLabel: string,
      token: string,
    ) => {
      const { credentialRef } = await apiClient.conversation.submitManualToken({
        provider,
        accountLabel,
        token,
        threadId,
        runId,
        gateRef,
      });
      await resolveGate(runId, gateRef, "credential_provided", { credentialRef });
    },
    [apiClient, threadId, resolveGate],
  );

  const copyConversation = useCallback(async () => {
    const text = messages
      .map((msg) => {
        const role = msg.role === "user" ? "User" : "Assistant";
        const textParts: string[] = [];
        const toolParts: string[] = [];
        for (const p of msg.parts) {
          if (p.type === "text") {
            textParts.push(p.content);
          } else if (p.type === "tool-call") {
            toolParts.push(`  Tool: ${p.name}(${p.arguments})`);
          } else if (p.type === "tool-result") {
            const summary =
              typeof p.content === "string"
                ? p.content.slice(0, 200)
                : String(p.content).slice(0, 200);
            toolParts.push(`  ${p.state === "error" ? "Error" : "Result"}: ${summary}`);
          }
        }
        return `${role}:\n${[...textParts, ...toolParts].join("\n")}`;
      })
      .join("\n\n---\n\n");
    await navigator.clipboard.writeText(text);
  }, [messages]);

  return {
    messages,
    isLoading: chat.isLoading,
    error: chat.error?.message ?? null,
    runId,
    pendingApprovals,
    authGates,
    streamInterrupted,
    sendMessage,
    stop,
    resolveGate,
    submitAuthToken,
    copyConversation,
    threadId,
    isSubscribed: chat.isSubscribed,
    connectionStatus: chat.connectionStatus,
    sessionGenerating: chat.sessionGenerating,
  };
}
