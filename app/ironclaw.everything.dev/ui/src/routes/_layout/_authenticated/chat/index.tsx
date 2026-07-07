import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Unplug, Zap } from "lucide-react";
import { threadListQueryOptions } from "@/hooks/use-conversation";
import { ironclawStatusQueryKey, useIronclawStatus } from "@/hooks/use-ironclaw-status";

export const Route = createFileRoute("/_layout/_authenticated/chat/")({
  beforeLoad: async ({ context }) => {
    const cached = context.queryClient.getQueryData(ironclawStatusQueryKey);
    if (cached && !(cached as { connected?: boolean }).connected) {
      throw redirect({ to: "/setup" });
    }

    let threads: Array<{
      threadId: string;
      isSubagent?: boolean;
      updatedAt?: string;
      createdAt?: string;
    }> = [];
    try {
      const data = await context.queryClient.ensureQueryData(
        threadListQueryOptions(context.apiClient),
      );
      threads = (data?.threads ?? []) as typeof threads;
    } catch {
      return;
    }

    const nonSubagent = threads.filter((t) => !t.isSubagent);
    if (nonSubagent.length > 0) {
      const sorted = [...nonSubagent].sort((a, b) => {
        const at = a.updatedAt ?? a.createdAt ?? "";
        const bt = b.updatedAt ?? b.createdAt ?? "";
        return bt.localeCompare(at);
      });
      throw redirect({
        to: "/chat/$threadId",
        params: { threadId: sorted[0].threadId },
      });
    }

    try {
      const result = await context.apiClient.conversation.createThread({
        clientActionId: `ui-${crypto.randomUUID()}`,
      });
      context.queryClient.invalidateQueries({ queryKey: ["conversation", "threads"] });
      throw redirect({
        to: "/chat/$threadId",
        params: { threadId: result.threadId },
      });
    } catch (err) {
      if (err && typeof err === "object" && "to" in err) throw err;
    }
  },
  component: ChatIndex,
});

function ChatIndex() {
  const { status: connectionStatus } = useIronclawStatus();

  const isDisconnected =
    connectionStatus === "disconnected" || connectionStatus === "never-connected";

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
    <div className="flex h-full items-center justify-center px-4">
      <div className="text-center space-y-3">
        <div className="h-8 w-8 mx-auto animate-spin rounded-full border-2 border-border border-t-foreground" />
        <p className="text-sm text-muted-foreground">Preparing your chat...</p>
      </div>
    </div>
  );
}
