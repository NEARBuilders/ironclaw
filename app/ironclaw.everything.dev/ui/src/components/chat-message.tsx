import type { UIMessage } from "@tanstack/ai-react";
import { ChatMessage as UiChatMessage } from "@tanstack/ai-react-ui";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  File,
  FileText,
  Globe,
  Image,
  Loader2,
  Monitor,
  Music,
  ShieldCheck,
  ShieldX,
  Terminal,
  Wrench,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { formatBytes } from "@/lib/attachments";
import { cn } from "@/lib/utils";

interface ChatMessageProps {
  message: UIMessage;
  isOptimistic?: boolean;
  status?: string;
  onApproveTool?: (toolCallId: string, approved: boolean) => void;
  verbose?: boolean;
}

function toolIcon(name: string) {
  const n = name.toLowerCase();
  if (n.includes("file") || n.includes("read") || n.includes("write") || n.includes("path"))
    return FileText;
  if (n.includes("web") || n.includes("search") || n.includes("fetch") || n.includes("http") || n.includes("url"))
    return Globe;
  if (n.includes("shell") || n.includes("bash") || n.includes("terminal") || n.includes("exec") || n.includes("code") || n.includes("run"))
    return Terminal;
  if (n.includes("browser") || n.includes("screenshot") || n.includes("page") || n.includes("click"))
    return Monitor;
  if (n.includes("approval") || n.includes("gate") || n.includes("shield"))
    return ShieldCheck;
  return Wrench;
}

function ToolCallCard({
  name,
  state,
  result,
  approval,
  onApprove,
  verbose,
}: {
  name: string;
  state: string;
  result?: { content: string | unknown[]; state: string } | null;
  approval?: { id: string; needsApproval: boolean; approved?: boolean };
  onApprove?: (approved: boolean) => void;
  verbose?: boolean;
}) {
  const isApproval = state === "approval-requested" && approval?.needsApproval;
  const [expanded, setExpanded] = useState(isApproval);

  const isLoading = state === "input-streaming" || state === "input-complete";
  const isComplete = state === "complete" || state === "output-available";
  const isError = state === "output-error" || state === "error";
  const isKilled = state === "killed";

  let displayOutput = "";
  let inputSummary: string | null = null;
  let outputKind: string | null = null;
  let isTruncated = false;
  let titleFromEnvelope: string | null = null;

  if (result) {
    const raw = typeof result.content === "string" ? result.content : "";
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          displayOutput = parsed.output ?? parsed.text ?? parsed.result ?? "";
          outputKind = parsed.output_kind ?? null;
          isTruncated = !!parsed.truncated;
          inputSummary = parsed.input_summary ?? null;
          titleFromEnvelope = parsed.title ?? null;
        }
      } catch {
        displayOutput = raw;
      }
    }
  }

  const displayName = titleFromEnvelope || name;
  const hasOutput = !!displayOutput;
  const hasInput = !!inputSummary;
  const Icon = toolIcon(displayName);

  return (
    <div className={cn(
      "rounded-md border text-xs overflow-hidden",
      isApproval
        ? "border-amber-500/30 bg-amber-500/5"
        : isError || isKilled
          ? "border-destructive/20 bg-destructive/5"
          : "border-border bg-muted/30"
    )}>
      <button
        type="button"
        onClick={() => !isApproval && setExpanded(!expanded)}
        className={cn(
          "flex w-full items-center gap-2 px-2.5 py-1.5 text-left",
          isApproval && "cursor-default"
        )}
      >
        <Icon
          size={12}
          className={cn(
            "shrink-0",
            isApproval
              ? "text-amber-500"
              : isError || isKilled
                ? "text-destructive"
                : "text-muted-foreground"
          )}
        />
        <span className={cn(
          "flex-1 truncate font-medium",
          isApproval ? "text-amber-700 dark:text-amber-400" : "text-foreground/80"
        )}>
          {displayName}
        </span>
        <span className="shrink-0 ml-auto">
          {isLoading && <Loader2 size={10} className="animate-spin text-muted-foreground" />}
          {isComplete && <CheckCircle2 size={10} className="text-[color:var(--near-green)]" />}
          {(isError || isKilled) && <AlertCircle size={10} className="text-destructive" />}
          {isApproval && <ShieldCheck size={10} className="text-amber-500" />}
        </span>
        {!isApproval && (
          expanded
            ? <ChevronDown size={10} className="shrink-0 text-muted-foreground/50" />
            : <ChevronRight size={10} className="shrink-0 text-muted-foreground/50" />
        )}
      </button>

      {isApproval && (
        <div className="border-t border-amber-500/20 px-2.5 py-2 space-y-2">
          {result?.content && (
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              {(() => {
                try {
                  const p = JSON.parse(result.content as string);
                  return p.body ?? p.headline ?? "";
                } catch {
                  return typeof result.content === "string" ? result.content : "";
                }
              })()}
            </p>
          )}
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="default"
              className="h-6 px-2.5 text-[11px]"
              onClick={() => onApprove?.(true)}
            >
              <ShieldCheck size={10} className="mr-1" />
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2.5 text-[11px]"
              onClick={() => onApprove?.(false)}
            >
              <ShieldX size={10} className="mr-1" />
              Deny
            </Button>
          </div>
        </div>
      )}

      {!isApproval && expanded && (hasInput || hasOutput || (verbose && result)) && (
        <div className="border-t border-border divide-y divide-border/50">
          {hasInput && (
            <div className="px-2.5 py-1.5">
              <p className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wide mb-0.5">Input</p>
              <p className="text-muted-foreground/80 leading-relaxed">{inputSummary}</p>
            </div>
          )}
          {hasOutput && (
            <div className="px-2.5 py-1.5">
              <div className="flex items-center gap-1.5 mb-0.5">
                <p className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wide">Output</p>
                {outputKind && (
                  <span className="rounded bg-muted-foreground/10 px-1 py-0 text-[9px] uppercase font-mono text-muted-foreground/60">
                    {outputKind}
                  </span>
                )}
                {isTruncated && (
                  <span className="rounded bg-amber-500/10 px-1 py-0 text-[9px] text-amber-600">
                    truncated
                  </span>
                )}
              </div>
              <pre className="max-h-36 overflow-y-auto whitespace-pre-wrap font-mono text-muted-foreground/80 text-[11px] leading-relaxed">
                {displayOutput}
              </pre>
            </div>
          )}
          {verbose && result && (
            <div className="px-2.5 py-1.5 text-[10px] text-muted-foreground/50 font-mono space-y-0.5">
              <div>state: {result.state}</div>
              {outputKind && <div>kind: {outputKind}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AttachmentCard({ attachment }: { attachment: any }) {
  const kind = attachment.kind as string;
  const isImage = kind === "image" || attachment.mimeType?.startsWith("image/");
  const isAudio = kind === "audio" || attachment.mimeType?.startsWith("audio/");
  const previewUrl =
    (attachment.previewUrl ?? attachment.dataBase64)
      ? `data:${attachment.mimeType};base64,${attachment.dataBase64}`
      : null;

  const icon = isImage ? Image : isAudio ? Music : File;
  const Icon = icon;

  const body = (
    <div className="flex items-center gap-2 overflow-hidden rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-xs">
      <Icon size={14} className="shrink-0 text-muted-foreground" />
      <span
        className="min-w-0 flex-1 truncate text-foreground"
        title={attachment.filename ?? attachment.id}
      >
        {attachment.filename ?? "Unknown file"}
      </span>
      {attachment.mimeType ? (
        <span className="shrink-0 text-muted-foreground/70">{attachment.mimeType}</span>
      ) : null}
      {attachment.sizeBytes != null ? (
        <span className="shrink-0 text-muted-foreground/70">
          {formatBytes(attachment.sizeBytes)}
        </span>
      ) : null}
      {attachment.extractedText ? (
        <span className="max-w-40 truncate text-muted-foreground/50 italic">
          {attachment.extractedText}
        </span>
      ) : null}
    </div>
  );

  if (isImage && previewUrl) {
    return (
      <a href={previewUrl} target="_blank" rel="noreferrer" className="group block">
        <div className="overflow-hidden rounded-md border border-border bg-muted/20">
          <img
            src={previewUrl}
            alt={attachment.filename ?? "attachment"}
            className="max-h-32 w-auto object-contain transition-opacity group-hover:opacity-80"
          />
        </div>
        {body}
      </a>
    );
  }

  return body;
}

export function ChatMessage({ message, isOptimistic, status, onApproveTool, verbose }: ChatMessageProps) {
  const isUser = message.role === "user";
  const isFailed = status === "failed";
  const [copied, setCopied] = useState(false);

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const textContent = message.parts?.length
    ? message.parts
        .filter((p) => p.type === "text")
        .map((p) => (p as any).content ?? (p as any).text ?? "")
        .join(" ")
    : ((message as any).content ?? "");

  const attachments = (message as any).attachments as any[] | undefined;

  const toolResults = useMemo(() => {
    const map = new Map<string, { content: string | unknown[]; state: string }>();
    for (const part of message.parts) {
      if (part.type === "tool-result") {
        map.set(part.toolCallId, { content: part.content, state: part.state });
      }
    }
    return map;
  }, [message.parts]);

  const hasToolCalls = message.parts.some((p) => p.type === "tool-call");

  return (
    <div className={cn("group flex w-full", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[90%] sm:max-w-[80%] lg:max-w-[70%] min-w-0",
          isUser
            ? "rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground space-y-2"
            : cn(
                "rounded-2xl rounded-bl-md text-sm text-foreground",
                hasToolCalls
                  ? "bg-muted/20 px-3 py-2 space-y-1"
                  : "bg-muted px-4 py-2.5 space-y-2"
              ),
          isOptimistic && "opacity-70",
          isFailed && "border border-destructive/50 bg-destructive/5",
        )}
      >
        {isFailed && (
          <div className="flex items-center gap-1.5 text-xs text-destructive">
            <AlertCircle size={12} />
            <span>Failed to send</span>
          </div>
        )}
        {isUser ? (
          <p className="whitespace-pre-wrap break-words">{textContent}</p>
        ) : (
          <UiChatMessage
            message={message}
            className={hasToolCalls ? "space-y-1" : "space-y-2"}
            defaultToolRenderer={({ id, name, state, approval }) => (
              <ToolCallCard
                name={name}
                state={state}
                result={toolResults.get(id)}
                approval={approval}
                onApprove={onApproveTool ? (approved) => onApproveTool(id, approved) : undefined}
                verbose={verbose}
              />
            )}
            toolResultRenderer={() => null}
            thinkingPartRenderer={({ content }) => (
              <div className="rounded-lg border border-dashed border-muted-foreground/20 bg-muted/30 px-3 py-2 text-xs italic text-muted-foreground">
                {content}
              </div>
            )}
            textPartRenderer={({ content }) => (
              <Markdown
                content={content}
                className="[&_p]:mb-0 [&_ul]:mb-0 [&_ol]:mb-0 [&_pre]:mb-0 [&_h1]:mt-0 [&_h1]:mb-0 [&_h2]:mt-0 [&_h2]:mb-0 [&_h3]:mt-0 [&_h3]:mb-0 [&_blockquote]:mb-0 [&_hr]:my-2"
              />
            )}
          />
        )}
        {attachments && attachments.length > 0 ? (
          <div className="space-y-1">
            {attachments.map((att: any) => (
              <AttachmentCard key={att.id ?? att.filename} attachment={att} />
            ))}
          </div>
        ) : null}
        {!isUser && message.createdAt ? (
          <div className="flex items-center gap-1.5 justify-start pt-0.5">
            {textContent && (
              <button
                type="button"
                onClick={() => handleCopy(textContent)}
                className="opacity-0 group-hover:opacity-100 transition-opacity"
                title={copied ? "Copied!" : "Copy message"}
              >
                <Copy
                  size={10}
                  className={cn(
                    "text-muted-foreground/60 hover:text-muted-foreground transition-colors",
                    copied && "text-muted-foreground",
                  )}
                />
              </button>
            )}
            <span className="text-[10px] text-muted-foreground/60">
              {new Date(message.createdAt).toLocaleTimeString(undefined, {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
