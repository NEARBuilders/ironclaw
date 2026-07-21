import { Mic, MicOff, Paperclip, Send, Square, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { type AttachmentLimits, type StagedAttachment, stageFiles } from "@/lib/attachments";
import { clearDraft, loadDraft, saveDraft } from "@/lib/draft-store";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";

interface ChatInputProps {
  onSend: (content: string, attachments?: StagedAttachment[]) => void;
  onStop?: () => void;
  disabled?: boolean;
  placeholder?: string;
  isSending?: boolean;
  attachmentCapabilities?: AttachmentLimits | null;
  threadId?: string;
}

export function ChatInput({
  onSend,
  onStop,
  disabled,
  placeholder = "Type a message...",
  isSending,
  attachmentCapabilities,
  threadId,
}: ChatInputProps) {
  const [value, setValue] = useState(() => (threadId ? loadDraft(threadId) : ""));
  const [staged, setStaged] = useState<StagedAttachment[]>([]);
  const [focused, setFocused] = useState(false);
  const [displayedValue, setDisplayedValue] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const activeValue = displayedValue ?? value;
  const setActiveValue = useCallback((v: string) => {
    setDisplayedValue(null);
    setValue(v);
  }, []);

  const speechRec = useSpeechRecognition({
    language: "en-US",
    continuous: true,
    interimResults: true,
    onResult: (_transcript: string, _isFinal: boolean) => {
      const base = displayTextRef.current;
      setDisplayedValue(base ? `${base} ${_transcript}` : _transcript);
    },
    onError: (_err: string) => {
      toast.error(`Speech recognition: ${_err}`);
    },
    onEnd: () => {},
  });

  const displayTextRef = useRef("");

  useEffect(() => {
    if (!threadId) return;
    setValue(loadDraft(threadId));
    setStaged([]);
    setDisplayedValue(null);
  }, [threadId]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [activeValue]);

  useEffect(() => {
    if (!threadId) return;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      saveDraft(threadId, displayedValue ?? value);
    }, 500);
    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    };
  }, [threadId, value, displayedValue]);

  const handleSend = useCallback(() => {
    if (speechRec.isListening) speechRec.stop();
    const trimmed = activeValue.trim();
    if (!trimmed || disabled || isSending) return;
    onSend(trimmed, staged.length > 0 ? staged : undefined);
    setValue("");
    setStaged([]);
    setDisplayedValue(null);
    displayTextRef.current = "";
    if (threadId) clearDraft(threadId);
  }, [activeValue, disabled, isSending, onSend, staged, threadId, speechRec]);

  const handleStaging = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      const limits = attachmentCapabilities ?? {
        accept: ["*/*"],
        maxCount: 10,
        maxFileBytes: 10_485_760,
        maxTotalBytes: 52_428_800,
      };
      const { staged: newStaged, errors } = await stageFiles(files, limits, staged);
      if (newStaged.length > 0) {
        setStaged((prev) => [...prev, ...newStaged]);
      }
      for (const err of errors) {
        toast.error(err);
      }
    },
    [attachmentCapabilities, staged],
  );

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        await handleStaging(files);
      }
    },
    [handleStaging],
  );

  const handleFilePick = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      await handleStaging(Array.from(files));
      e.target.value = "";
    },
    [handleStaging],
  );

  const removeStaged = (id: string) => {
    setStaged((prev) => prev.filter((a) => a.id !== id));
  };

  const handleMicClick = useCallback(() => {
    if (speechRec.isListening) {
      speechRec.stop();
      if (speechRec.finalTranscript) {
        setActiveValue(
          displayTextRef.current
            ? `${displayTextRef.current} ${speechRec.finalTranscript}`
            : speechRec.finalTranscript,
        );
      }
      displayTextRef.current = "";
    } else {
      displayTextRef.current = value;
      setDisplayedValue(value);
      speechRec.reset();
      speechRec.start();
    }
  }, [speechRec, value, setActiveValue]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
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
          {speechRec.isSupported ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    variant={speechRec.isListening ? "secondary" : "ghost"}
                    className={`shrink-0 h-10 w-10 sm:h-9 sm:w-9 ${
                      speechRec.isListening
                        ? "text-destructive animate-pulse"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    onClick={handleMicClick}
                    disabled={disabled || isSending}
                    title={speechRec.isListening ? "Stop recording" : "Voice input"}
                  >
                    {speechRec.isListening ? <MicOff size={14} /> : <Mic size={14} />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {speechRec.isListening ? "Stop recording" : "Voice input"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : null}
          <Textarea
            ref={textareaRef}
            value={activeValue}
            onChange={(e) => setActiveValue(e.target.value)}
            placeholder={
              speechRec.isListening
                ? "Listening..."
                : focused && !activeValue
                  ? "Enter to send, Shift+Enter for newline"
                  : placeholder
            }
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            disabled={disabled}
            className="min-h-0 resize-none text-base sm:text-sm"
            rows={1}
          />
          {isSending && onStop ? (
            <Button
              size="icon"
              variant="secondary"
              onClick={onStop}
              title="Stop generating"
              className="h-10 w-10 sm:h-9 sm:w-9"
            >
              <Square size={14} className="fill-current" />
            </Button>
          ) : (
            <Button
              size="icon"
              onClick={handleSend}
              disabled={!activeValue.trim() || isSending || disabled}
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
