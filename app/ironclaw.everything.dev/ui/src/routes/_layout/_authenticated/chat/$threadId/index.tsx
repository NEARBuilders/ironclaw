import type { UIMessage } from "@tanstack/ai";
import { createFileRoute } from "@tanstack/react-router";
import { ChatInput } from "@/components/chat-input";
import { ChatMessage } from "@/components/chat-message";
import { ChatMessageList } from "@/components/chat-message-list";
import { useThreadContext } from "../$threadId";

export const Route = createFileRoute("/_layout/_authenticated/chat/$threadId/")({
  component: ThreadChatIndex,
});

function ThreadChatIndex() {
  const { threadId, chat, verbose, handleSend, isBusy, attachmentCapabilities } =
    useThreadContext();

  const messagesWithContent = chat.messages.filter(
    (m: UIMessage) => m.parts.length > 0,
  );

  return (
    <>
      <ChatMessageList
        streamLoading={isBusy}
        empty={messagesWithContent.length === 0 && !isBusy}
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

      <ChatInput
        onSend={handleSend}
        onStop={chat.stop}
        threadId={threadId}
        placeholder="Type a message..."
        isSending={isBusy}
        attachmentCapabilities={attachmentCapabilities}
      />
    </>
  );
}
