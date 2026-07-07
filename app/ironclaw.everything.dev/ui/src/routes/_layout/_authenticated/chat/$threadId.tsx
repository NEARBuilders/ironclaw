import type { UIMessage } from "@tanstack/ai";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Outlet, useMatchRoute } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { ApprovalCard } from "@/components/approval-card";
import { AuthGenericCard } from "@/components/auth-generic-card";
import { AuthOauthCard } from "@/components/auth-oauth-card";
import { AuthTokenCard } from "@/components/auth-token-card";
import { ChatIdentityBar } from "@/components/chat-identity-bar";
import { ChatInput } from "@/components/chat-input";
import { ChatMessage } from "@/components/chat-message";
import { ChatMessageList } from "@/components/chat-message-list";
import { KoreaPromptEmptyState } from "@/components/korea-prompt-empty-state";
import { useConversationThreads, useThreadMessages } from "@/hooks/use-conversation";
import { useConversationChat } from "@/hooks/use-conversation-chat";
import { useIronclawStatus } from "@/hooks/use-ironclaw-status";
import { useVerboseMode } from "@/hooks/use-verbose-mode";
import type { StagedAttachment } from "@/lib/attachments";
import { useChatLayout } from "../chat";

export const Route = createFileRoute("/_layout/_authenticated/chat/$threadId")({
  remountDeps: ({ params }) => ({ threadId: params.threadId }),
  loader: async ({ context, params }) => {
    try {
      const { threadMessagesQueryOptions } = await import("@/hooks/use-conversation");
      await context.queryClient.fetchQuery(
        threadMessagesQueryOptions(context.apiClient, params.threadId),
      );
    } catch (err) {
      console.error("[chat] Failed to pre-fetch thread messages:", err);
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

  const chat = useConversationChat({ threadId, initialMessages });
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

  if (isLogsRoute) return <Outlet />;

  const firstPendingApproval = chat.pendingApprovals[0];
  const firstAuthGate = chat.authGates[0];

  const messagesWithContent = chat.messages.filter((m: UIMessage) => m.parts.length > 0);

  return (
    <>
      <ChatIdentityBar
        threadState={
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
              }
            : null
        }
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
                chat.runId && chat.resolveGate(chat.runId, firstAuthGate.gateRef, "cancelled")
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
                chat.runId && chat.resolveGate(chat.runId, firstAuthGate.gateRef, "cancelled")
              }
            />
          </div>
        ) : (
          <div className="border-b border-border px-4 py-3">
            <AuthGenericCard
              gate={firstAuthGate}
              onCancel={() =>
                chat.runId && chat.resolveGate(chat.runId, firstAuthGate.gateRef, "cancelled")
              }
            />
          </div>
        )
      ) : firstPendingApproval ? (
        <div className="border-b border-border px-4 py-3">
          <ApprovalCard
            approval={firstPendingApproval}
            onApprove={() =>
              chat.runId && chat.resolveGate(chat.runId, firstPendingApproval.gateRef, "approved")
            }
            onDeny={() =>
              chat.runId && chat.resolveGate(chat.runId, firstPendingApproval.gateRef, "denied")
            }
            onAlways={
              firstPendingApproval.allowAlways
                ? () =>
                    chat.runId &&
                    chat.resolveGate(chat.runId, firstPendingApproval.gateRef, "approved", {
                      always: true,
                    })
                : undefined
            }
          />
        </div>
      ) : null}

      {messagesWithContent.length === 0 && !isBusy ? (
        <KoreaPromptEmptyState onSelect={handleSend} disabled={isBusy} />
      ) : (
        <ChatMessageList
          threadId={threadId}
          streamLoading={isBusy}
          empty={false}
          emptyMessage="No messages yet. Send a message to start."
        >
          {messagesWithContent.map((message) => (
            <ChatMessage key={message.id} message={message} verbose={verbose} />
          ))}
          {chat.isLoading ? (
            <div className="flex items-end gap-2">
              <img
                src="/logo.png"
                alt="IronClaw"
                className="shrink-0 w-6 h-6 sm:w-7 sm:h-7 mb-0.5 transition-transform duration-300 ease-out hover:scale-125 hover:-rotate-12 hover:drop-shadow-[0_0_8px_rgba(17,145,240,0.6)] cursor-pointer"
              />
              <div className="rounded-2xl rounded-bl-sm bg-muted px-4 py-2.5">
                <div className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/40 [animation-delay:0ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/40 [animation-delay:150ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/40 [animation-delay:300ms]" />
                </div>
              </div>
            </div>
          ) : null}
        </ChatMessageList>
      )}

      <ChatInput
        onSend={handleSend}
        onStop={chat.stop}
        threadId={threadId}
        placeholder="Ask about Seoul..."
        isSending={isBusy}
        attachmentCapabilities={attachmentCapabilities}
      />
    </>
  );
}
