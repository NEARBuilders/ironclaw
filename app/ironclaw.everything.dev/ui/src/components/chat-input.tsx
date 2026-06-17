import { Paperclip, Send, Square, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { type AttachmentLimits, type StagedAttachment, stageFiles } from "@/lib/attachments";

interface ChatInputProps {
  onSend: (content: string, attachments?: StagedAttachment[]) => void;
  onStop?: () => void;
  disabled?: boolean;
  placeholder?: string;
  isSending?: boolean;
  attachmentCapabilities?: AttachmentLimits | null;
}

export function ChatInput({
  onSend,
  onStop,
  disabled,
  placeholder = "Type a message...",
  isSending,
  attachmentCapabilities,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const [staged, setStaged] = useState<StagedAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled || isSending) return;
    onSend(trimmed, staged.length > 0 ? staged : undefined);
    setValue("");
    setStaged([]);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const limits = attachmentCapabilities ?? {
      accept: ["*/*"],
      maxCount: 10,
      maxFileBytes: 10_485_760,
      maxTotalBytes: 52_428_800,
    };

    const { staged: newStaged, errors } = await stageFiles(Array.from(files), limits, staged);
    if (newStaged.length > 0) {
      setStaged((prev) => [...prev, ...newStaged]);
    }
    for (const err of errors) {
      toast.error(err);
    }

    e.target.value = "";
  };

  const removeStaged = (id: string) => {
    setStaged((prev) => prev.filter((a) => a.id !== id));
  };

  return (
    <div className="border-t border-border p-2 sm:p-4 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-4xl">
        {staged.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {staged.map((att) => (
              <div
                key={att.id}
                className="flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2 py-1 text-xs"
              >
                <span className="max-w-28 truncate text-foreground" title={att.filename}>
                  {att.filename}
                </span>
                <span className="shrink-0 text-muted-foreground">{att.sizeLabel}</span>
                <button
                  type="button"
                  onClick={() => removeStaged(att.id)}
                  className="ml-0.5 shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive transition-colors"
                  title={`Remove ${att.filename}`}
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="flex items-end gap-2">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="shrink-0 h-10 w-10 sm:h-9 sm:w-9 text-muted-foreground hover:text-foreground"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || isSending}
            title="Attach file"
          >
            <Paperclip size={14} />
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            hidden
            multiple
            accept={attachmentCapabilities?.accept?.join(",") ?? "*/*"}
            onChange={handleFilePick}
          />
          <Textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            className="min-h-0 resize-none text-base sm:text-sm"
            rows={1}
          />
          {isSending && onStop ? (
            <Button size="icon" variant="secondary" onClick={onStop} title="Stop generating" className="h-10 w-10 sm:h-9 sm:w-9">
              <Square size={14} className="fill-current" />
            </Button>
          ) : (
            <Button
              size="icon"
              onClick={handleSend}
              disabled={!value.trim() || isSending || disabled}
              className="h-10 w-10 sm:h-9 sm:w-9"
            >
              <Send size={14} />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
