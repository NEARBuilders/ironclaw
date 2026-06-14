import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useApiClient } from "@/app";
import type { ApiClient } from "@/app";

type ThreadState = Awaited<ReturnType<ApiClient["ironclaw"]["threads"]["getState"]>>;

export type { ThreadState };

export function useThreadState(threadId: string | null) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  const queryKey = useMemo(() => ["thread-state", threadId] as const, [threadId]);

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      if (!threadId) return null;
      return apiClient.ironclaw.threads.getState({ id: threadId });
    },
    enabled: !!threadId,
    staleTime: 30_000,
  });

  const rebuild = useCallback(async () => {
    if (!threadId) return;
    await queryClient.invalidateQueries({ queryKey: ["thread-state", threadId] });
    await queryClient.refetchQueries({ queryKey: ["thread-state", threadId] });
  }, [threadId, queryClient]);

  return {
    state: query.data ?? null,
    loading: query.isLoading,
    error: query.error ? (query.error as Error).message ?? "Failed to load thread state" : null,
    rebuild,
  };
}
