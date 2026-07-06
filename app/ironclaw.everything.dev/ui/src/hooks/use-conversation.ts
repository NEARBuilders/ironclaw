import { useQuery } from "@tanstack/react-query";
import { type ApiClient, useApiClient } from "@/app";
import { messagesToUIMessages } from "@/lib/conversation-message-parts";

export interface ConversationMessage {
  id: string;
  threadId: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string | null;
  status: "submitted" | "finalized" | "failed";
  sequence: number;
  runId: string | null;
}

export interface ConversationThread {
  threadId: string;
  title: string | null;
  tenantId: string;
  agentId: string;
  projectId: string | null;
  createdByActorId: string;
  createdAt: string | null;
  updatedAt: string | null;
  parentThreadId: string | null;
  isSubagent: boolean;
}

const THREADS_KEY = ["conversation", "threads"] as const;

export function threadMessagesQueryKey(threadId: string) {
  return ["conversation", "messages", threadId] as const;
}

export function threadListQueryOptions(apiClient: ApiClient) {
  return {
    queryKey: THREADS_KEY,
    queryFn: async () => {
      const data = await apiClient.conversation.listThreads();
      return { threads: data?.data ?? [], nextCursor: null };
    },
    staleTime: 5_000,
  } as const;
}

export function threadMessagesQueryOptions(apiClient: ApiClient, threadId: string) {
  return {
    queryKey: threadMessagesQueryKey(threadId),
    queryFn: async () => {
      const page = await apiClient.conversation.getMessages({ threadId, limit: 100 });
      return messagesToUIMessages(page.messages ?? []);
    },
    staleTime: 30_000,
  } as const;
}

export function useConversationThreads() {
  const apiClient = useApiClient();
  return useQuery(threadListQueryOptions(apiClient));
}

export function useThreadMessages(threadId: string) {
  const apiClient = useApiClient();
  return useQuery(threadMessagesQueryOptions(apiClient, threadId));
}
