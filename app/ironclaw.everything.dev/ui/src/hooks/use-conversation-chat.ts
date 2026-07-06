import type { StreamChunk, UIMessage } from "@tanstack/ai";
import { useChat, fetchServerSentEvents } from "@tanstack/ai-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApiClient } from "@/app";
import type { AuthGate, PendingApproval } from "@/hooks/conversation-chat-types";
import type { StagedAttachment } from "@/lib/attachments";
import { clearThreadStatus, setThreadStatus } from "@/lib/conversation-thread-status";

type GateResolution = "approved" | "denied" | "credential_provided" | "cancelled";

interface UseConversationChatOptions {
  threadId: string;
  initialMessages: UIMessage[];
}

export function useConversationChat({ threadId, initialMessages }: UseConversationChatOptions) {
  const apiClient = useApiClient();

  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [authGates, setAuthGates] = useState<AuthGate[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [streamInterrupted, setStreamInterrupted] = useState(false);
  const [systemMessages, setSystemMessages] = useState<UIMessage[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();

  const runIdRef = useRef<string | null>(null);
  const runCompletedNormallyRef = useRef(false);
  const runErroredRef = useRef(false);
  const intentionalStopRef = useRef(false);
  const pendingErrorDataRef = useRef<unknown>(null);
  const prevLoadingRef = useRef(false);

  const connection = useMemo(
    () =>
      fetchServerSentEvents(
        () => `/api/conversation/threads/${encodeURIComponent(threadId)}/chat`,
      ),
    [threadId],
  );

  const persistence = useMemo(
    () => ({
      getItem: (id: string) => {
        try {
          const raw = sessionStorage.getItem(`ic:msg:${id}`);
          return raw ? (JSON.parse(raw) as UIMessage[]) : null;
        } catch {
          return null;
        }
      },
      setItem: (id: string, messages: UIMessage[]) => {
        try {
          sessionStorage.setItem(`ic:msg:${id}`, JSON.stringify(messages));
        } catch {}
      },
      removeItem: (id: string) => {
        try {
          sessionStorage.removeItem(`ic:msg:${id}`);
        } catch {}
      },
    }),
    [],
  );

  const forwardedProps = useMemo(() => ({ afterCursor: cursor }), [cursor]);

  const chat = useChat({
    connection,
    initialMessages,
    threadId,
    id: threadId,
    persistence,
    forwardedProps,
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
        setThreadStatus(threadId, {
          hasActiveRun: true,
          isLoading: true,
          hasPendingApprovals: false,
        });
        return;
      }

      if (chunk.type === "RUN_ERROR") {
        runErroredRef.current = true;
        runIdRef.current = null;
        setRunId(null);
        setPendingApprovals([]);
        setAuthGates([]);
        setThreadStatus(threadId, { hasActiveRun: false, isLoading: false, hasPendingApprovals: false });

        const errorData = pendingErrorDataRef.current;
        pendingErrorDataRef.current = null;
        const errorParts: UIMessage["parts"] = [
          { type: "text" as const, content: chunk.message ?? "Run failed" },
        ];
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
        setThreadStatus(threadId, { hasActiveRun: false, isLoading: false, hasPendingApprovals: false });
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
        setThreadStatus(threadId, { hasPendingApprovals: true });
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
        if (c) setCursor(c);
        return;
      }
    },
  });

  useEffect(() => {
    if (prevLoadingRef.current && !chat.isLoading) {
      if (
        !runCompletedNormallyRef.current &&
        !runErroredRef.current &&
        !intentionalStopRef.current
      ) {
        setStreamInterrupted(true);
      }
    }
    prevLoadingRef.current = chat.isLoading;
  }, [chat.isLoading]);

  useEffect(() => {
    setSystemMessages([]);
    setPendingApprovals([]);
    setAuthGates([]);
    setRunId(null);
    setStreamInterrupted(false);
    setCursor(undefined);
  }, [threadId]);

  useEffect(() => {
    return () => {
      clearThreadStatus(threadId);
    };
  }, [threadId]);

  const sendMessage = useCallback(
    (content: string, attachments?: StagedAttachment[]) => {
      if (!content.trim() || chat.isLoading) return;

      setPendingApprovals([]);
      setAuthGates([]);
      setStreamInterrupted(false);
      intentionalStopRef.current = false;
      setThreadStatus(threadId, { hasPendingApprovals: false });

      if (attachments?.length) {
        chat
          .sendMessage({
            content: [
              { type: "text", content } as const,
              ...attachments.map(
                (a) =>
                  ({
                    type: "image",
                    source: { type: "data", value: a.dataBase64, mimeType: a.mimeType },
                  }) as const,
              ),
            ],
          })
          .catch((err) => {
            console.error("[ironclaw] sendMessage stream failed:", err);
          });
      } else {
        chat.sendMessage(content).catch((err) => {
          console.error("[ironclaw] sendMessage stream failed:", err);
        });
      }
    },
    [chat, threadId],
  );

  const stop = useCallback(() => {
    intentionalStopRef.current = true;
    const currentRunId = runIdRef.current;
    if (currentRunId) {
      apiClient.conversation.cancelRun({ threadId, runId: currentRunId }).catch(() => {});
    }
    setThreadStatus(threadId, { hasActiveRun: false, isLoading: false, hasPendingApprovals: false });
    chat.stop();
  }, [chat, apiClient, threadId]);

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
      setPendingApprovals((prev) => {
        const next = prev.filter((approval) => approval.gateRef !== gateRef);
        setThreadStatus(threadId, { hasPendingApprovals: next.length > 0 });
        return next;
      });
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
    const all = [...chat.messages, ...systemMessages];
    const text = all
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
  }, [chat.messages, systemMessages]);

  return {
    messages: [...chat.messages, ...systemMessages],
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
  };
}
