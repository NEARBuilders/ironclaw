import { useChat } from "@tanstack/ai-react";
import type { StreamChunk } from "@tanstack/ai/client";
import type { ApiClient } from "@/app";

function messageTextContent(m: {
  role: string;
  parts: Array<{ type: string; content?: string }>;
}): string {
  return m.parts
    .filter(
      (p): p is { type: "text"; content: string } => p.type === "text" && p.content !== undefined,
    )
    .map((p) => p.content)
    .join(" ");
}

export function useIronclawChat(
  threadId: string,
  apiClient: ApiClient,
  initialMessages?: Array<{
    id: string;
    role: "user" | "assistant";
    parts: Array<{ type: "text"; content: string }>;
    createdAt?: Date;
  }>,
) {
  return useChat({
    threadId,
    initialMessages: initialMessages as any,
    fetcher: async ({ messages }) => {
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      const mapped = messages.map((m) => ({
        role: m.role,
        content: messageTextContent(
          m as unknown as { role: string; parts: Array<{ type: string; content?: string }> },
        ),
      }));
      return apiClient.ironclaw.threads.chatStream({
        id: threadId,
        content: messageTextContent(
          lastUser as unknown as {
            role: string;
            parts: Array<{ type: string; content?: string }>;
          },
        ),
        clientActionId: `ui-${crypto.randomUUID()}`,
        messages: mapped,
      }) as unknown as AsyncIterable<StreamChunk>;
    },
    onError: (error) => {
      console.error("[useIronclawChat]", error);
    },
  });
}
