import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, RefreshCw, Unplug, Zap } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useApiClient } from "@/app";
import { ChatInput } from "@/components/chat-input";
import { KoreaPromptEmptyState } from "@/components/korea-prompt-empty-state";
import { ironclawStatusQueryKey, useIronclawStatus } from "@/hooks/use-ironclaw-status";
import type { StagedAttachment } from "@/lib/attachments";

export const Route = createFileRoute("/_layout/_authenticated/chat/")({
  beforeLoad: async ({ context }) => {
    const cached = context.queryClient.getQueryData(ironclawStatusQueryKey);
    if (cached && !(cached as { connected?: boolean }).connected) {
      throw redirect({ to: "/setup" });
    }
  },
  component: ChatIndex,
});

function ChatIndex() {
  const apiClient = useApiClient();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { status: connectionStatus, attachmentCapabilities } = useIronclawStatus();
  const [isCreating, setIsCreating] = useState(false);

  const isDisconnected =
    connectionStatus === "disconnected" || connectionStatus === "never-connected";

  const handleSend = useCallback(
    async (content: string, attachments?: StagedAttachment[]) => {
      if (!content.trim() || isCreating) return;
      setIsCreating(true);
      try {
        const result = await apiClient.conversation.createThread({
          clientActionId: `ui-${crypto.randomUUID()}`,
        });
        queryClient.setQueryData(["pending-initial-message"], { content, attachments });
        navigate({
          to: "/chat/$threadId",
          params: { threadId: result.threadId },
        });
      } catch {
        toast.error("Failed to create thread");
      } finally {
        setIsCreating(false);
      }
    },
    [apiClient, navigate, queryClient, isCreating],
  );

  if (isDisconnected) {
    return (
      <div className="flex h-full items-center justify-center px-4">
        <div className="text-center space-y-4 max-w-xs w-full">
          <div className="flex h-14 w-14 items-center justify-center rounded-full border border-border bg-muted mx-auto">
            <Unplug className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-semibold text-foreground">
              {connectionStatus === "never-connected"
                ? "IronClaw not connected"
                : "Connection lost"}
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {connectionStatus === "never-connected"
                ? "Run the IronClaw binary locally, then return here to start chatting."
                : "The IronClaw binary stopped responding. Check that it's still running."}
            </p>
          </div>
          <Link
            to="/setup"
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:border-border-strong transition-colors touch-manipulation"
          >
            <Zap size={14} />
            Setup guide
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col min-h-0">
      <div className="flex-1 min-h-0">
        <KoreaPromptEmptyState onSelect={handleSend} disabled={isCreating} />
      </div>
      <ChatInput
        onSend={handleSend}
        placeholder="Ask about Seoul..."
        isSending={isCreating}
        attachmentCapabilities={attachmentCapabilities}
      />
    </div>
  );
}
