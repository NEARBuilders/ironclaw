import type { RunAgentInputContext, SubscribeConnectionAdapter } from "@tanstack/ai-react";
import type { ModelMessage, StreamChunk, UIMessage } from "@tanstack/ai/client";
import type { ApiClient } from "@/lib/api";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function extractUserMessage(messages: Array<UIMessage> | Array<ModelMessage>) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!isRecord(message) || message.role !== "user") continue;
    return message;
  }
  return null;
}

function extractOutgoingContent(message: Record<string, unknown>) {
  const parts = Array.isArray(message.parts)
    ? (message.parts as Array<Record<string, unknown>>)
    : [];
  const content = message.content;

  const attachments: Array<{ mimeType: string; filename?: string; dataBase64: string }> = [];
  for (const part of parts) {
    if (part.type !== "image" && part.type !== "file" && part.type !== "document") continue;
    const source = isRecord(part.source) ? part.source : undefined;
    if (source?.type === "data" && typeof source.value === "string") {
      attachments.push({
        mimeType:
          typeof source.mimeType === "string"
            ? source.mimeType
            : part.type === "image"
              ? "image/png"
              : "application/octet-stream",
        filename: typeof source.filename === "string" ? source.filename : undefined,
        dataBase64: source.value,
      });
    }
  }

  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .filter(
              (part): part is Record<string, unknown> => isRecord(part) && part.type === "text",
            )
            .map((part) => String(part.content ?? part.text ?? ""))
            .join("")
        : parts
            .filter((part) => part.type === "text")
            .map((part) => String(part.content ?? ""))
            .join("");

  return { text, attachments };
}

export function createThreadLiveConnection({
  apiClient,
  threadId,
  pluginId,
  getCursor,
  setCursor,
}: {
  apiClient: ApiClient;
  threadId: string;
  pluginId?: string;
  getCursor: () => string | undefined;
  setCursor?: (cursor: string | undefined) => void;
}): SubscribeConnectionAdapter {
  return {
    async *subscribe(abortSignal?: AbortSignal) {
      const stream = await apiClient.conversation.subscribeThread({
        threadId,
        afterCursor: getCursor(),
        pluginId,
      });

      for await (const chunk of stream as AsyncIterable<StreamChunk>) {
        if (abortSignal?.aborted) return;
        yield chunk;
      }
    },

    async send(
      messages: Array<UIMessage> | Array<ModelMessage>,
      _data?: Record<string, any>,
      abortSignal?: AbortSignal,
      runContext?: RunAgentInputContext,
    ) {
      if (abortSignal?.aborted) return;

      const userMessage = extractUserMessage(messages);
      if (!userMessage) return;

      const { text, attachments } = extractOutgoingContent(userMessage);
      if (!text.trim() && attachments.length === 0) return;

      const eventCursor = await apiClient.conversation.sendMessage({
        threadId,
        content: text,
        attachments: attachments.length > 0 ? attachments : undefined,
        clientActionId: runContext?.runId ?? crypto.randomUUID(),
        pluginId,
      });
      if (setCursor) {
        const nextCursor = eventCursor.eventCursor;
        setCursor(nextCursor === undefined ? undefined : String(nextCursor));
      }
    },
  };
}
