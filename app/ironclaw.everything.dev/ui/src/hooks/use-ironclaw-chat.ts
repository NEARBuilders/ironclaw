import type { UIMessage } from "@tanstack/ai";
import { ChatClient } from "@tanstack/ai-client";
import { createChatDevtoolsBridge } from "@tanstack/ai-client/devtools";
import { fetchServerSentEvents } from "@tanstack/ai-react";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useApiClient } from "@/app";
import type { StagedAttachment } from "@/lib/attachments";
import { clearThreadStatus, setThreadStatus } from "@/lib/ironclaw-thread-status";

export interface PendingApproval {
  gateRef: string;
  headline: string;
  toolName?: string;
  description?: string;
  allowAlways?: boolean;
  action?: { label?: string; method?: string };
  scope?: { label?: string; reusable?: boolean };
  destination?: { label?: string; url?: string; domain?: string };
  details?: Array<{ label?: string; value?: string }>;
}

export interface AuthGate {
  runId: string;
  gateRef: string;
  challengeKind: string;
  provider?: string;
  accountLabel?: string;
  authorizationUrl?: string;
  expiresAt?: string;
  headline?: string;
  body?: string;
}

type GateResolution = "approved" | "denied" | "credential_provided" | "cancelled";

interface UseIronclawChatOptions {
  threadId: string;
  initialMessages: UIMessage[];
}

interface ChatSnapshot {
  messages: UIMessage[];
  isLoading: boolean;
  error: string | null;
  runId: string | null;
  pendingApprovals: PendingApproval[];
  authGates: AuthGate[];
  streamInterrupted: boolean;
}

function stagedToBridgeFormat(a: StagedAttachment) {
  return {
    mimeType: a.mimeType,
    filename: a.filename ?? undefined,
    dataBase64: a.dataBase64,
  };
}

export function useIronclawChat({ threadId, initialMessages }: UseIronclawChatOptions) {
  const apiClient = useApiClient();

  const storeRef = useRef({
    messages: initialMessages,
    isLoading: false,
    error: null as string | null,
    runId: null as string | null,
    pendingApprovals: [] as PendingApproval[],
    authGates: [] as AuthGate[],
    streamInterrupted: false,
    intentionalStop: false,
    version: 0,
  });

  const listenersRef = useRef(new Set<() => void>());
  const versionRef = useRef(-1);
  const snapshotRef = useRef<ChatSnapshot | null>(null);
  const clientRef = useRef<ChatClient | null>(null);
  const activeThreadIdRef = useRef(threadId);

  const notify = useCallback(() => {
    for (const l of listenersRef.current) {
      try {
        l();
      } catch {}
    }
  }, []);

  if (!clientRef.current || activeThreadIdRef.current !== threadId) {
    if (clientRef.current) {
      clientRef.current.dispose();
      clearThreadStatus(activeThreadIdRef.current);
    }
    activeThreadIdRef.current = threadId;

    const store = storeRef.current;
    store.messages = initialMessages;
    store.isLoading = false;
    store.error = null;
    store.runId = null;
    store.pendingApprovals = [];
    store.authGates = [];
    store.streamInterrupted = false;
    store.intentionalStop = false;
    store.version = 0;

    const pendingThinking: string[] = [];
    const pendingSkillMessages: UIMessage[] = [];
    const pendingErrorData: Array<{ content: unknown }> = [];
    let runCompletedNormally = false;
    let runErrored = false;

    function endRun() {
      store.runId = null;
      store.pendingApprovals = [];
      store.authGates = [];
    }

    clientRef.current = new ChatClient({
      threadId,
      initialMessages,
      connection: fetchServerSentEvents(
        () => `/api/conversation/threads/${encodeURIComponent(threadId)}/chat`,
      ),
      devtools: {
        name: `Thread ${threadId.slice(0, 8)}`,
        framework: "react",
        hookName: "useIronclawChat",
      },
      devtoolsBridgeFactory: createChatDevtoolsBridge,

      onMessagesChange(msgs) {
        let updated = msgs;

        const thinkingQueue = pendingThinking.splice(0);
        if (thinkingQueue.length > 0) {
          const copy = [...msgs];
          for (let i = copy.length - 1; i >= 0; i--) {
            if (copy[i].role === "assistant") {
              copy[i] = {
                ...copy[i],
                parts: [
                  ...copy[i].parts,
                  ...thinkingQueue.map((body) => ({ type: "thinking" as const, content: body })),
                ],
              };
              break;
            }
          }
          updated = copy;
          clientRef.current?.setMessagesManually(updated);
          return;
        }

        const skillQueue = pendingSkillMessages.splice(0);
        if (skillQueue.length > 0) {
          updated = [...msgs, ...skillQueue];
          clientRef.current?.setMessagesManually(updated);
          return;
        }

        const errorDataQueue = pendingErrorData.splice(0);
        if (errorDataQueue.length > 0) {
          const copy = [...msgs];
          for (let i = copy.length - 1; i >= 0; i--) {
            if (copy[i].role === "system") {
              const parts = [...copy[i].parts];
              for (const e of errorDataQueue) {
                parts.push({ type: "error-data" as const, content: e.content } as any);
              }
              copy[i] = { ...copy[i], parts };
              break;
            }
          }
          updated = copy;
          clientRef.current?.setMessagesManually(updated);
          return;
        }

        store.messages = updated;
        store.version++;
        notify();
      },

      onLoadingChange(loading) {
        if (!loading && store.isLoading) return;
        store.isLoading = loading;
        if (!loading && !runCompletedNormally && !runErrored && !store.intentionalStop) {
          store.streamInterrupted = true;
        }
        store.version++;
        notify();
        setThreadStatus(threadId, { isLoading: loading });
      },

      onErrorChange(err) {
        store.error = err?.message ?? null;
        store.version++;
        notify();
      },

      onFinish() {
        runCompletedNormally = true;
        endRun();
        store.version++;
        notify();
      },

      onError() {
        runErrored = true;
        endRun();
        store.version++;
        notify();
      },

      onChunk(chunk) {
        if (chunk.type === "RUN_STARTED") {
          store.runId = chunk.runId ?? null;
          store.streamInterrupted = false;
          setThreadStatus(threadId, {
            hasActiveRun: true,
            isLoading: true,
            hasPendingApprovals: false,
          });
          return;
        }

        if (chunk.type === "RUN_ERROR") {
          if (chunk.details) {
            pendingErrorData.push({ content: chunk.details });
          }
          store.error = chunk.message ?? "Run failed";
          return;
        }

        if (chunk.type === "RUN_FINISHED") {
          return;
        }

        if (chunk.type !== "CUSTOM") return;

        const name = chunk.name ?? "";
        const val = chunk.value as Record<string, unknown> | undefined;

        if (name === "approval-requested") {
          const approvalInfo = (val?.approval as Record<string, unknown>) ?? {};
          store.pendingApprovals.push({
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
            details: approvalInfo.details as Array<{ label?: string; value?: string }> | undefined,
          });
          store.version++;
          notify();
          setThreadStatus(threadId, { hasPendingApprovals: true });
          return;
        }

        if (name === "ironclaw.auth-required") {
          const prompt = val ?? {};
          store.authGates.push({
            runId: String(prompt.runId ?? prompt.turnRunId ?? ""),
            gateRef: String(prompt.authRequestRef ?? prompt.auth_request_ref ?? ""),
            challengeKind: String(prompt.challengeKind ?? "other"),
            provider: prompt.provider as string | undefined,
            accountLabel: prompt.accountLabel as string | undefined,
            authorizationUrl: prompt.authorizationUrl as string | undefined,
            expiresAt: prompt.expiresAt as string | undefined,
            headline: prompt.headline as string | undefined,
            body: prompt.body as string | undefined,
          });
          store.version++;
          notify();
          return;
        }

        if (name === "ironclaw.failed") {
          const details = (val as any)?.details ?? val;
          if (details) {
            pendingErrorData.push({ content: details });
          }
          return;
        }

        if (name === "ironclaw.thinking") {
          const body = String((val as any)?.body ?? "");
          if (body) {
            pendingThinking.push(body);
          }
          return;
        }

        if (name === "ironclaw.skill-activation") {
          const skillNames: string[] = (val?.skillNames ?? []) as string[];
          const feedback: string[] = (val?.feedback ?? []) as string[];
          const content = [...skillNames.map((n) => `Skill activated: ${n}`), ...feedback]
            .filter(Boolean)
            .join("\n");
          if (content) {
            pendingSkillMessages.push({
              id: `skill-${(val?.id as string) ?? Date.now()}`,
              role: "system" as const,
              parts: [{ type: "text" as const, content }],
            });
          }
          return;
        }

        if (
          name === "ironclaw.capability-activity" ||
          name === "ironclaw.capability-display-preview"
        ) {
          store.version++;
          notify();
          return;
        }
      },
    });
    clientRef.current.mountDevtools();
  }

  const client = clientRef.current!;

  useEffect(() => {
    return () => {
      if (clientRef.current && activeThreadIdRef.current === threadId) {
        clientRef.current.dispose();
        clearThreadStatus(threadId);
        clientRef.current = null;
      }
    };
  }, [threadId]);

  const initialKeyRef = useRef<string>(threadId);
  useEffect(() => {
    if (initialMessages.length === 0) return;
    if (initialKeyRef.current !== threadId) {
      initialKeyRef.current = threadId;
      client.setMessagesManually(initialMessages);
    }
  }, [initialMessages, threadId]);

  const getSnapshot = useCallback((): ChatSnapshot => {
    const s = storeRef.current;
    if (versionRef.current === s.version && snapshotRef.current) {
      return snapshotRef.current;
    }
    versionRef.current = s.version;
    snapshotRef.current = {
      messages: s.messages,
      isLoading: s.isLoading,
      error: s.error,
      runId: s.runId,
      pendingApprovals: s.pendingApprovals,
      authGates: s.authGates,
      streamInterrupted: s.streamInterrupted,
    };
    return snapshotRef.current!;
  }, []);

  const subscribe = useCallback((cb: () => void) => {
    listenersRef.current.add(cb);
    return () => {
      listenersRef.current.delete(cb);
    };
  }, []);

  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const sendMessage = useCallback(
    (content: string, attachments?: StagedAttachment[]) => {
      if (!content.trim() || state.isLoading) return;

      storeRef.current.pendingApprovals = [];
      storeRef.current.authGates = [];
      storeRef.current.streamInterrupted = false;
      storeRef.current.intentionalStop = false;
      storeRef.current.version++;
      notify();
      setThreadStatus(threadId, { hasPendingApprovals: false });

      const body: Record<string, unknown> = {};
      if (attachments?.length) {
        body.attachments = attachments.map(stagedToBridgeFormat);
      }

      client.sendMessage(content, Object.keys(body).length > 0 ? body : undefined).catch((err) => {
        console.error("[ironclaw] sendMessage stream failed:", err);
      });
    },
    [client, threadId, state.isLoading, notify],
  );

  const stop = useCallback(() => {
    storeRef.current.intentionalStop = true;
    const runId = storeRef.current.runId;
    if (runId) {
      apiClient.conversation.cancelRun({ threadId, runId }).catch(() => {});
    }
    client.stop();
  }, [client, apiClient, threadId]);

  const resolveGate = useCallback(
    async (
      runId: string,
      gateRef: string,
      resolution: GateResolution,
      opts?: { always?: boolean; credentialRef?: string },
    ) => {
      await apiClient.conversation.threadApprove({
        threadId,
        runId,
        gateRef,
        resolution,
        always: opts?.always,
        credentialRef: opts?.credentialRef,
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
    const msgs = client.getMessages();
    const text = msgs
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
  }, [client]);

  return {
    messages: state.messages,
    isLoading: state.isLoading,
    error: state.error,
    runId: state.runId,
    pendingApprovals: state.pendingApprovals,
    authGates: state.authGates,
    streamInterrupted: state.streamInterrupted,
    sendMessage,
    stop,
    resolveGate,
    submitAuthToken,
    copyConversation,
    threadId,
  };
}
