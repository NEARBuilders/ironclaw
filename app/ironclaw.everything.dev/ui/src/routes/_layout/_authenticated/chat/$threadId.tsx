import { createFileRoute, Outlet, useMatchRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo } from "react";
import { ApprovalCard } from "@/components/approval-card";
import { AuthGenericCard } from "@/components/auth-generic-card";
import { AuthOauthCard } from "@/components/auth-oauth-card";
import { AuthTokenCard } from "@/components/auth-token-card";
import { ChatIdentityBar } from "@/components/chat-identity-bar";
import { useConversationThreads, useThreadMessages } from "@/hooks/use-conversation";
import { useIronclawChat } from "@/hooks/use-ironclaw-chat";
import { useIronclawStatus } from "@/hooks/use-ironclaw-status";
import { useVerboseMode } from "@/hooks/use-verbose-mode";
import type { StagedAttachment } from "@/lib/attachments";
import { useChatLayout } from "../chat";

interface ThreadContextValue {
  threadId: string;
  chat: ReturnType<typeof useIronclawChat>;
  verbose: boolean;
  onToggleVerbose: () => void;
  handleSend: (content: string, attachments?: StagedAttachment[]) => void;
  isBusy: boolean;
  attachmentCapabilities: ReturnType<typeof useIronclawStatus>["attachmentCapabilities"];
}

const ThreadCtx = createContext<ThreadContextValue | null>(null);

export function useThreadContext(): ThreadContextValue {
  const ctx = useContext(ThreadCtx);
  if (!ctx) {
    throw new Error("useThreadContext must be used within a ThreadLayout");
  }
  return ctx;
}

export const Route = createFileRoute("/_layout/_authenticated/chat/$threadId")({
  loader: async ({ context, params }) => {
    try {
      const { threadMessagesQueryOptions } = await import("@/hooks/use-conversation");
      await context.queryClient.ensureQueryData(
        threadMessagesQueryOptions(context.apiClient, params.threadId),
      );
    } catch {
      // IronClaw not available
    }
  },
  component: ThreadLayout,
});

function ThreadLayout() {
  const { threadId } = Route.useParams();
  const { onOpenMobileSidebar, onToggleDesktopSidebar } = useChatLayout();
  const { data: initialMessages = [] } = useThreadMessages(threadId);
  const threadsQuery = useConversationThreads();
  const { attachmentCapabilities } = useIronclawStatus();
  const { verbose, toggle: toggleVerbose } = useVerboseMode();
  const queryClient = useQueryClient();
  const matchRoute = useMatchRoute();

  const chat = useIronclawChat({ threadId, initialMessages });
  const isBusy = chat.isLoading;
  const isLogsRoute = !!matchRoute({ to: "/chat/$threadId/logs" });

  const handleSend = useCallback(
    (content: string, attachments?: StagedAttachment[]) => {
      if (!content.trim() || isBusy) return;
      chat.sendMessage(content, attachments);
      queryClient.invalidateQueries({ queryKey: ["conversation", "threads"] });
    },
    [chat.sendMessage, isBusy, queryClient],
  );

  const threadMeta = useMemo(() => {
    const threads = threadsQuery.data?.threads ?? [];
    const found = threads.find((t) => t.threadId === threadId);
    if (!found) return null;
    return {
      threadId: found.threadId,
      title: found.title,
      scope: {
        tenantId: found.tenantId,
        agentId: found.agentId,
        projectId: found.projectId ?? undefined,
      },
      createdByActorId: found.createdByActorId,
    };
  }, [threadId, threadsQuery.data]);

  const threadState = useMemo(
    () =>
      threadMeta
        ? {
            thread: {
              threadId: threadMeta.threadId,
              title: threadMeta.title,
              scope: {
                tenantId: threadMeta.scope.tenantId,
                agentId: threadMeta.scope.agentId,
                projectId: threadMeta.scope.projectId,
              },
              createdByActorId: threadMeta.createdByActorId,
            },
            messages: [],
          }
        : null,
    [threadMeta],
  );

  const ctx = useMemo<ThreadContextValue>(
    () => ({
      threadId,
      chat,
      verbose,
      onToggleVerbose: toggleVerbose,
      handleSend,
      isBusy,
      attachmentCapabilities,
    }),
    [threadId, chat, verbose, toggleVerbose, handleSend, isBusy, attachmentCapabilities],
  );

  const firstPendingApproval = chat.pendingApprovals[0];
  const firstAuthGate = chat.authGates[0];

  return (
    <ThreadCtx.Provider value={ctx}>
      {isLogsRoute ? (
        <Outlet />
      ) : (
        <>
          <ChatIdentityBar
            threadState={threadState}
            onOpenMobileSidebar={onOpenMobileSidebar}
            onToggleDesktopSidebar={onToggleDesktopSidebar}
            activeThreadTitle={threadMeta?.title ?? `Thread ${threadId.slice(0, 8)}`}
            verbose={verbose}
            onToggleVerbose={toggleVerbose}
            onCopyConversation={chat.copyConversation}
          />
          {chat.streamInterrupted && (
            <div className="flex items-center gap-2 border-b border-amber-500/20 bg-amber-500/5 px-4 py-2 text-xs text-amber-600">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
              Connection lost — messages may be incomplete. Send a new message to continue.
            </div>
          )}
          {firstAuthGate ? (
            firstAuthGate.challengeKind === "oauth_url" ? (
              <div className="border-b border-border px-4 py-3">
                <AuthOauthCard
                  gate={firstAuthGate}
                  onCancel={() =>
                    chat.runId &&
                    chat.resolveGate(chat.runId, firstAuthGate.gateRef, "cancelled")
                  }
                />
              </div>
            ) : firstAuthGate.challengeKind === "manual_token" ? (
              <div className="border-b border-border px-4 py-3">
                <AuthTokenCard
                  gate={firstAuthGate}
                  onSubmit={async (token) => {
                    if (chat.runId) {
                      await chat.submitAuthToken(
                        chat.runId,
                        firstAuthGate.gateRef,
                        firstAuthGate.provider ?? "",
                        firstAuthGate.accountLabel ?? "",
                        token,
                      );
                    }
                  }}
                  onCancel={() =>
                    chat.runId &&
                    chat.resolveGate(chat.runId, firstAuthGate.gateRef, "cancelled")
                  }
                />
              </div>
            ) : (
              <div className="border-b border-border px-4 py-3">
                <AuthGenericCard
                  gate={firstAuthGate}
                  onCancel={() =>
                    chat.runId &&
                    chat.resolveGate(chat.runId, firstAuthGate.gateRef, "cancelled")
                  }
                />
              </div>
            )
          ) : firstPendingApproval ? (
            <div className="border-b border-border px-4 py-3">
              <ApprovalCard
                approval={firstPendingApproval}
                onApprove={() =>
                  chat.runId &&
                  chat.resolveGate(chat.runId, firstPendingApproval.gateRef, "approved")
                }
                onDeny={() =>
                  chat.runId &&
                  chat.resolveGate(chat.runId, firstPendingApproval.gateRef, "denied")
                }
                onAlways={
                  firstPendingApproval.allowAlways
                    ? () =>
                        chat.runId &&
                        chat.resolveGate(
                          chat.runId,
                          firstPendingApproval.gateRef,
                          "approved",
                          { always: true },
                        )
                    : undefined
                }
              />
            </div>
          ) : null}
          <Outlet />
        </>
      )}
    </ThreadCtx.Provider>
  );
}
