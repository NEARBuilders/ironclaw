import { useRef, useEffect, type ReactNode } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageSquare } from "lucide-react";

interface ChatMessageListProps {
  children: ReactNode;
  loading?: boolean;
  empty?: boolean;
  emptyMessage?: string;
}

export function ChatMessageList({
  children,
  loading,
  empty,
  emptyMessage = "No messages yet",
}: ChatMessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [children]);

  if (loading) {
    return (
      <div className="flex-1 p-4">
        <div className="mx-auto max-w-3xl space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className={`flex ${i % 2 === 0 ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`space-y-2 ${i % 2 === 0 ? "max-w-[60%]" : "max-w-[75%]"}`}
              >
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-16 w-full rounded-xl" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (empty) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="flex flex-col items-center gap-2 text-center">
          <MessageSquare size={24} className="text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        {children}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
