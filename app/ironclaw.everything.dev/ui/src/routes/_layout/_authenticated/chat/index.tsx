import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, RefreshCw, Unplug, Zap } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApiClient } from "@/app";
import { ironclawStatusQueryKey, useIronclawStatus } from "@/hooks/use-ironclaw-status";

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
  const { status: connectionStatus } = useIronclawStatus();
  const [error, setError] = useState(false);
  const creatingRef = useRef(false);
  const attemptRef = useRef(0);

  const isDisconnected =
    connectionStatus === "disconnected" || connectionStatus === "never-connected";

  const createAndEnter = useCallback(() => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setError(false);
    const attempt = ++attemptRef.current;

    apiClient.conversation
      .createThread({
        clientActionId: `ui-${crypto.randomUUID()}`,
      })
      .then((result) => {
        queryClient.invalidateQueries({ queryKey: ["conversation", "threads"] });
        navigate({
          to: "/chat/$threadId",
          params: { threadId: result.threadId },
        });
      })
      .catch(() => {
        if (attempt !== attemptRef.current) return;
        creatingRef.current = false;
        setError(true);
      });
  }, [apiClient, navigate, queryClient]);

  useEffect(() => {
    if (isDisconnected) return;
    createAndEnter();
  }, [isDisconnected, createAndEnter]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center px-4">
        <div className="text-center space-y-4 max-w-xs w-full">
          <div className="flex h-14 w-14 items-center justify-center rounded-full border border-border bg-muted mx-auto">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-semibold text-foreground">
              Couldn't prepare your chat
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              The IronClaw binary may not be running, or something went wrong. Try again or check
              your setup.
            </p>
          </div>
          <div className="flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={createAndEnter}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors touch-manipulation"
            >
              <RefreshCw size={14} />
              Try again
            </button>
            <Link
              to="/"
              className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors touch-manipulation"
            >
              Back home
            </Link>
          </div>
        </div>
      </div>
    );
  }

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
