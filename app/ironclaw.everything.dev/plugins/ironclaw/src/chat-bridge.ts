import { Effect } from "every-plugin/effect";
import type { z } from "every-plugin/zod";
import type { ChatEvent, AcceptedResponse } from "./contract";
import type { ConversationLiveChunkSchema } from "./contract";
import { IronclawService } from "./service";

type LiveChunk = z.infer<typeof ConversationLiveChunkSchema>;

export interface BridgeService {
  sendMessage(input: {
    id: string;
    content: string;
    clientActionId?: string;
    attachments?: Array<{ mimeType: string; filename?: string; dataBase64: string }>;
  }): Promise<AcceptedResponse>;
  streamEvents(input: { id: string; afterCursor?: string; signal?: AbortSignal }): AsyncGenerator<ChatEvent>;
  getTimeline(input: { id: string; limit?: number }): Promise<{ data: any[] }>;
}

function normalizeMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  return typeof value === "string" ? value : String(value);
}

function normalizeDetails(value: unknown): string | undefined {
  if (!value) return undefined;
  if (value instanceof Error) {
    const stack = value.stack;
    const msg = value.message;
    if (stack && stack !== msg) return stack;
    return msg;
  }
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function serializeToolResultEnvelope(envelope: {
  output: string;
  outputKind: string | null;
  truncated: boolean;
  inputSummary: string | null;
  title: string;
}): string {
  return JSON.stringify(envelope);
}

function resolveToolCallId(
  preview: ChatEvent["preview"],
  activity: ChatEvent["activity"],
): string | undefined {
  return (
    preview?.invocationId ??
    preview?.timelineMessageId ??
    activity?.invocationId ??
    (activity as Record<string, string | undefined> | undefined)?.timelineMessageId ??
    (activity as Record<string, string | undefined> | undefined)?.invocation_id ??
    undefined
  );
}

function extractEventRunId(event: ChatEvent): string | undefined {
  const ack = event.ack;
  const ackRunId = ack
    ? ack.outcome === "rejected_busy"
      ? ack.activeRunId
      : ack.runId
    : undefined;
  return (
    ackRunId ??
    (event.response?.runId ||
      event.reply?.turnRunId ||
      event.progress?.turnRunId ||
      event.activity?.turnRunId ||
      event.preview?.turnRunId ||
      event.prompt?.turnRunId ||
      undefined)
  );
}

function projVal(item: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    const v = item[key];
    if (v !== undefined) return v;
  }
  return undefined;
}

function getProjectionRunStatus(
  item: Record<string, unknown>,
): Record<string, unknown> | undefined {
  return projVal(item, "runStatus", "run_status") as Record<string, unknown> | undefined;
}

function getProjectionText(item: Record<string, unknown>): Record<string, unknown> | undefined {
  return projVal(item, "text", "Text") as Record<string, unknown> | undefined;
}

function getProjectionThinking(item: Record<string, unknown>): Record<string, unknown> | undefined {
  return projVal(item, "thinking", "Thinking") as Record<string, unknown> | undefined;
}

function getProjectionCapabilityActivity(
  item: Record<string, unknown>,
): Record<string, unknown> | undefined {
  return projVal(item, "capabilityActivity", "capability_activity") as
    | Record<string, unknown>
    | undefined;
}

function getProjectionGate(item: Record<string, unknown>): Record<string, unknown> | undefined {
  return projVal(item, "gate", "Gate") as Record<string, unknown> | undefined;
}

function getProjectionSkillActivation(
  item: Record<string, unknown>,
): Record<string, unknown> | undefined {
  return projVal(item, "skillActivation", "skill_activation") as
    | Record<string, unknown>
    | undefined;
}

function findAssistantTextForRun(entries: any[], runId: string): string | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    const eRunId = e.turnRunId ?? e.turn_run_id ?? e.runId ?? e.run_id;
    if (eRunId === runId) {
      const lower = (e.kind ?? "").toLowerCase();
      const role = e.role ?? "";
      if (role === "assistant" || lower === "assistant" || lower === "assistant_message") {
        if (e.content) return e.content as string;
      }
    }
  }
  return undefined;
}

function extractUserInput(
  lastUserMsg: Record<string, unknown> | undefined,
  forwardedAttachments: unknown[] | undefined,
): { text: string; attachments: unknown[] | undefined } {
  if (!lastUserMsg) return { text: "", attachments: undefined };

  const attachments: unknown[] = [];
  const parts = (lastUserMsg.parts ?? []) as Array<Record<string, unknown>>;
  const content = lastUserMsg.content;

  for (const part of parts) {
    if (part.type === "image" || part.type === "file" || part.type === "document") {
      const src = part.source;
      if (src?.type === "data" && src.value) {
        attachments.push({
          mimeType: src.mimeType ?? (part.type === "image" ? "image/png" : "application/octet-stream"),
          filename: src.filename,
          dataBase64: src.value,
        });
      }
    }
  }

  if (attachments.length === 0 && Array.isArray(content)) {
    for (const part of content) {
      if (part.type === "image" || part.type === "file" || part.type === "document") {
        const src = part.source;
        if (src?.type === "data" && src.value) {
          attachments.push({
            mimeType: src.mimeType ?? (part.type === "image" ? "image/png" : "application/octet-stream"),
            filename: src.filename,
            dataBase64: src.value,
          });
        }
      }
    }
  }

  if (attachments.length === 0 && forwardedAttachments?.length) {
    attachments.push(...forwardedAttachments);
  }

  let text = "";
  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    text = (content as Array<Record<string, unknown>>)
      .filter((p) => p.type === "text")
      .map((p) => String(p.content ?? p.text ?? ""))
      .join("");
  }
  if (!text) {
    text = parts
      .filter((p) => p.type === "text")
      .map((p) => String(p.content ?? ""))
      .join("");
  }

  return { text, attachments: attachments.length > 0 ? attachments : undefined };
}

interface ThreadChatInput {
  threadId: string;
  messages?: Array<Record<string, unknown>>;
  forwardedProps?: Record<string, unknown>;
  clientActionId?: string;
}

export function createThreadChatBridge(svc: BridgeService) {
  return async function* (
    { input, signal }: { input: ThreadChatInput; signal?: AbortSignal },
  ) {
    const threadId = input.threadId;
    const messages = input.messages ?? [];
    const clientActionId =
      input.clientActionId ?? `bridge-${crypto.randomUUID()}`;
    const forwardedProps = input.forwardedProps;

    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    const { text, attachments } = extractUserInput(
      lastUserMsg,
      forwardedProps?.attachments as unknown[] | undefined,
    );

    const ack: AcceptedResponse = await svc.sendMessage({
      id: threadId,
      content: text,
      clientActionId,
      attachments: attachments as
        | Array<{ mimeType: string; filename?: string; dataBase64: string }>
        | undefined,
    });

    if (ack.outcome === "rejected_busy") {
      yield {
        type: "RUN_ERROR" as const,
        threadId,
        message: ack.notice ?? "Message rejected, thread is busy",
        details: `Rejected outcome: ${ack.outcome}, activeRunId: ${ack.activeRunId ?? "unknown"}`,
      } as LiveChunk;
      return;
    }

    const ackRunId = ack.runId;
    const afterCursor = forwardedProps?.afterCursor as string | undefined;
    const upstream = svc.streamEvents({
      id: threadId,
      afterCursor,
      signal,
    });
    const pendingPreviews = new Map<string, ChatEvent["preview"]>();
    const activeToolCalls = new Set<string>();
    let runStarted = false;
    let messageOpened = false;
    let terminalTextEmitted = false;
    let latestCursor: string | undefined;
    const seenTextIds = new Set<string>();

    const emitRunStarted = (runId: string | undefined): LiveChunk[] => {
      if (runStarted) return [];
      runStarted = true;
      const rid = runId ?? ackRunId ?? crypto.randomUUID();
      return [
        { type: "RUN_STARTED", threadId, runId: rid } as LiveChunk,
        {
          type: "TEXT_MESSAGE_START",
          threadId,
          runId: rid,
          messageId: assistantMessageId(rid),
          role: "assistant",
        } as LiveChunk,
      ];
    };

    const emitCustom = (name: string, value: unknown, runId?: string): LiveChunk =>
      ({ type: "CUSTOM", threadId, runId, name, value }) as LiveChunk;

    const assistantMessageId = (runId: string): string => `assistant:${runId}`;

    const closeMessage = (runId?: string): LiveChunk | undefined => {
      if (!messageOpened) return undefined;
      messageOpened = false;
      const rid = runId ?? ackRunId ?? crypto.randomUUID();
      return {
        type: "TEXT_MESSAGE_END",
        threadId,
        runId: rid,
        messageId: assistantMessageId(rid),
      } as LiveChunk;
    };

    const emitToolStart = (toolCallId: string, toolName: string, runId?: string): LiveChunk =>
      ({
        type: "TOOL_CALL_START",
        threadId,
        runId,
        parentMessageId: runId ? assistantMessageId(runId) : undefined,
        toolCallId,
        toolCallName: toolName,
        toolName,
        index: 0,
      }) as LiveChunk;

    const emitToolArgs = (toolCallId: string, input: string, runId?: string): LiveChunk =>
      ({
        type: "TOOL_CALL_ARGS",
        threadId,
        runId,
        toolCallId,
        delta: input,
        args: input,
      }) as LiveChunk;

    const emitToolEnd = (
      toolCallId: string,
      toolName: string,
      state: "output-available" | "output-error",
      result: string,
      input?: unknown,
      runId?: string,
    ): LiveChunk =>
      ({
        type: "TOOL_CALL_END",
        threadId,
        runId,
        toolCallId,
        toolCallName: toolName,
        toolName,
        state,
        input,
        result,
      }) as LiveChunk;

    const closeActiveToolCalls = async function* (runId?: string): AsyncGenerator<LiveChunk> {
      if (activeToolCalls.size === 0) return;
      try {
        const raw = await svc.getTimeline({ id: threadId, limit: 30 });
        const entries: any[] = raw.data ?? [];
        for (const invocationId of activeToolCalls) {
          const preview = pendingPreviews.get(invocationId);
          const resultEntry = entries.find((e: any) => {
            try {
              const c = JSON.parse(e.content ?? "");
              return (c.invocation_id ?? c.invocationId) === invocationId;
            } catch {
              return false;
            }
          });
          if (resultEntry) {
            const c = JSON.parse(resultEntry.content);
            const title = c.title ?? preview?.title ?? "tool";
            const envelope = serializeToolResultEnvelope({
              output:
                c.output ??
                c.output_preview ??
                c.output_summary ??
                preview?.outputSummary ??
                preview?.outputPreview ??
                "",
              outputKind: c.output_kind ?? c.outputKind ?? preview?.outputKind ?? null,
              truncated: Boolean(c.truncated ?? preview?.truncated),
              inputSummary: c.input_summary ?? c.inputSummary ?? preview?.inputSummary ?? null,
              title,
            });
            yield emitToolEnd(
              invocationId,
              title,
              "output-available",
              envelope,
              c.input_summary ?? preview?.inputSummary ?? "",
              runId,
            );
          } else if (preview) {
            const title = preview.title ?? "tool";
            const envelope = serializeToolResultEnvelope({
              output: preview.outputSummary ?? preview.outputPreview ?? "",
              outputKind: preview.outputKind ?? null,
              truncated: Boolean(preview.truncated),
              inputSummary: preview.inputSummary ?? null,
              title,
            });
            yield emitToolEnd(
              invocationId,
              title,
              "output-available",
              envelope,
              preview.inputSummary ?? "",
              runId,
            );
          } else {
            yield emitToolEnd(invocationId, "tool", "output-available", "", "", runId);
          }
        }
      } catch {
        for (const invocationId of activeToolCalls) {
          const preview = pendingPreviews.get(invocationId);
          const title = preview?.title ?? preview?.capabilityId ?? "tool";
          if (preview) {
            const envelope = serializeToolResultEnvelope({
              output: preview.outputSummary ?? preview.outputPreview ?? "",
              outputKind: preview.outputKind ?? null,
              truncated: Boolean(preview.truncated),
              inputSummary: preview.inputSummary ?? null,
              title,
            });
            yield emitToolEnd(
              invocationId,
              title,
              "output-available",
              envelope,
              preview.inputSummary ?? "",
              runId,
            );
          } else {
            yield emitToolEnd(invocationId, title, "output-available", "", "", runId);
          }
        }
      }
      activeToolCalls.clear();
      pendingPreviews.clear();
    };

    try {
      for await (const raw of upstream as AsyncIterable<ChatEvent>) {
        if (signal?.aborted) break;

        if (raw.cursor) latestCursor = raw.cursor;

        const type = raw.type;
        const eventRunId = extractEventRunId(raw) ?? ackRunId ?? crypto.randomUUID();

        if (type === "accepted" || type === "running") {
          yield* emitRunStarted(eventRunId);
          yield emitCustom(type, { runId: eventRunId, ...raw }, eventRunId);
          continue;
        }

        if (type === "capability_progress") {
          yield* emitRunStarted(eventRunId);
          yield emitCustom("capability-progress", raw.progress ?? raw, eventRunId);
          continue;
        }

        if (type === "capability_display_preview") {
          const preview = raw.preview;
          const invocationId = resolveToolCallId(preview, undefined);
          const capabilityId = preview?.capabilityId;
          const title = preview?.title ?? capabilityId ?? "unknown";

          if (invocationId && preview) {
            pendingPreviews.set(invocationId, preview);
            yield* emitRunStarted(eventRunId);
            if (!activeToolCalls.has(invocationId)) {
              activeToolCalls.add(invocationId);
              yield emitToolStart(invocationId, title, eventRunId);
              yield emitToolArgs(
                invocationId,
                JSON.stringify({ input: preview.inputSummary ?? "" }),
                eventRunId,
              );
            }
            yield emitCustom(
              "capability-display-preview",
              { ...preview, toolCallId: invocationId, toolName: title },
              eventRunId,
            );
          }
          continue;
        }

        if (type === "capability_activity") {
          const activity = raw.activity;
          const activityRec = activity as Record<string, unknown> | undefined;
          const invocationId = resolveToolCallId(undefined, activity);
          const capabilityId = (activityRec?.capabilityId ?? activityRec?.capability_id) as
            | string
            | undefined;
          const status = activity?.status;
          const errorKind = (activityRec?.errorKind ?? activityRec?.error_kind) as
            | string
            | undefined;

          if (!invocationId || !capabilityId) continue;

          const preview = pendingPreviews.get(invocationId);
          const title = preview?.title ?? capabilityId;
          yield* emitRunStarted(eventRunId);

          if (status === "started" || status === "running") {
            if (!activeToolCalls.has(invocationId)) {
              activeToolCalls.add(invocationId);
              yield emitToolStart(invocationId, title, eventRunId);
              yield emitToolArgs(
                invocationId,
                JSON.stringify({ input: preview?.inputSummary ?? "" }),
                eventRunId,
              );
            }
            yield emitCustom(
              "capability-activity",
              { ...activity, toolCallId: invocationId, toolName: title },
              eventRunId,
            );
            continue;
          }

          if (status === "completed" || status === "failed" || status === "killed") {
            if (!activeToolCalls.has(invocationId)) {
              activeToolCalls.add(invocationId);
              yield emitToolStart(invocationId, title, eventRunId);
              yield emitToolArgs(
                invocationId,
                JSON.stringify({ input: preview?.inputSummary ?? "" }),
                eventRunId,
              );
            }

            const envelope = serializeToolResultEnvelope({
              output:
                preview?.outputSummary ??
                preview?.outputPreview ??
                (errorKind ? `Error: ${errorKind}` : ""),
              outputKind: preview?.outputKind ?? null,
              truncated: Boolean(preview?.truncated),
              inputSummary: preview?.inputSummary ?? null,
              title,
            });
            const toolState =
              status === "failed" || status === "killed" ? "output-error" : "output-available";
            yield emitToolEnd(
              invocationId,
              title,
              toolState,
              envelope,
              preview?.inputSummary ?? "",
              eventRunId,
            );
            yield emitCustom(
              "capability-activity",
              { ...activity, toolCallId: invocationId, toolName: title },
              eventRunId,
            );
            pendingPreviews.delete(invocationId);
            activeToolCalls.delete(invocationId);
          }
          continue;
        }

        if (type === "gate") {
          const prompt = raw.prompt;
          const approvalContext = prompt?.approvalContext;
          const toolName = approvalContext?.toolName ?? "approval";
          const gateRef = prompt?.gateRef;
          const gateToolCallId = gateRef ?? `gate-${toolName}-${eventRunId}`;
          const description = approvalContext?.reason ?? prompt?.body ?? "";
          yield* emitRunStarted(eventRunId);
          yield emitToolStart(gateToolCallId, toolName, eventRunId);
          yield emitToolArgs(
            gateToolCallId,
            JSON.stringify({ input: approvalContext }),
            eventRunId,
          );
          yield emitToolEnd(gateToolCallId, toolName, "output-available", "", approvalContext, eventRunId);
          yield emitCustom(
            "approval-requested",
            {
              toolCallId: gateToolCallId,
              toolName,
              input: description || prompt?.headline || "Approval required",
              approval: {
                id: gateRef ?? gateToolCallId,
                needsApproval: true,
                allowAlways: prompt?.allowAlways ?? false,
                toolName,
                description,
                action: approvalContext?.action ?? undefined,
                scope: approvalContext?.scope ?? undefined,
                destination: approvalContext?.destination ?? undefined,
                details: approvalContext?.details ?? undefined,
              },
            },
            eventRunId,
          );
            yield emitCustom(
              "gate",
              { ...prompt, toolCallId: gateToolCallId, toolName, input: approvalContext },
              eventRunId,
            );
          continue;
        }

        if (type === "auth_required") {
          const authPrompt = raw.authPrompt;
          yield* emitRunStarted(eventRunId);
          yield emitCustom("auth-required", authPrompt, eventRunId);
          continue;
        }

        if (type === "final_reply") {
          const reply = raw.reply;
          const text = reply?.text ?? "";
          yield* emitRunStarted(eventRunId);
          yield emitCustom("final-reply", reply, eventRunId);
          if (text) {
            terminalTextEmitted = true;
            const msgId = eventRunId ? assistantMessageId(eventRunId) : `reply-${eventRunId}`;
            yield {
              type: "TEXT_MESSAGE_CONTENT",
              threadId,
              runId: eventRunId,
              messageId: msgId,
              delta: text,
            } as LiveChunk;
          }
          {
            const endChunk = closeMessage(eventRunId);
            if (endChunk) yield endChunk;
          }
          for await (const chunk of closeActiveToolCalls(eventRunId)) {
            yield chunk;
          }
          yield {
            type: "RUN_FINISHED",
            threadId,
            runId: eventRunId,
            finishReason: "stop",
          } as LiveChunk;
          return;
        }

        if (type === "failed") {
          const runState = raw.runState;
          const failure = runState?.failure;
          const message = normalizeMessage(failure ?? raw.response ?? "Run failed");
          const details = normalizeDetails(runState);
          yield* emitRunStarted(eventRunId);
          yield emitCustom(
            "failed",
            { runId: eventRunId, message, details, runState },
            eventRunId,
          );
          {
            const endChunk = closeMessage(eventRunId);
            if (endChunk) yield endChunk;
          }
          yield { type: "RUN_ERROR", threadId, runId: eventRunId, message, details } as LiveChunk;
          return;
        }

        if (type === "cancelled") {
          const response = raw.response;
          yield* emitRunStarted(eventRunId);
          yield emitCustom("cancelled", { runId: eventRunId, ...response }, eventRunId);
          {
            const endChunk = closeMessage(eventRunId);
            if (endChunk) yield endChunk;
          }
          for await (const chunk of closeActiveToolCalls(eventRunId)) {
            yield chunk;
          }
          yield {
            type: "RUN_FINISHED",
            threadId,
            runId: eventRunId,
            finishReason: null,
          } as LiveChunk;
          return;
        }

        if (type === "projection_snapshot" || type === "projection_update") {
          if (afterCursor && type === "projection_snapshot") continue;
          const projectionState = raw.state as Record<string, unknown> | undefined;
          const items = projectionState?.items as Array<Record<string, unknown>> | undefined;
          if (items && items.length > 0) {
            const runStatuses: Array<{
              runId: string;
              status: string;
              raw: Record<string, unknown>;
            }> = [];
            const textItems: Array<{ id: string; body: string; runId: string }> = [];
            const thinkingItems: Array<Record<string, unknown>> = [];
            const capActivities: Array<Record<string, unknown>> = [];
            const gateItems: Array<Record<string, unknown>> = [];
            const skillActivationItems: Array<Record<string, unknown>> = [];

            for (const item of items) {
              const rs = getProjectionRunStatus(item);
              if (rs) {
                const rId = (rs.runId ?? rs.run_id) as string | undefined;
                const st = rs.status as string | undefined;
                if (rId && st) runStatuses.push({ runId: rId, status: st, raw: rs });
                continue;
              }
              const tx = getProjectionText(item);
              if (tx) {
                const txId = tx.id as string | undefined;
                const body = tx.body as string | undefined;
                const txRunId = (tx.runId ??
                  tx.run_id ??
                  extractEventRunId(raw) ??
                  ackRunId ??
                  crypto.randomUUID()) as string;
                if (txId && body) textItems.push({ id: txId, body, runId: txRunId });
                continue;
              }
              const th = getProjectionThinking(item);
              if (th) {
                const tb = th.body as string | undefined;
                if (tb) thinkingItems.push(th);
                continue;
              }
              const ca = getProjectionCapabilityActivity(item);
              if (ca) {
                capActivities.push(ca);
                continue;
              }
              const g = getProjectionGate(item);
              if (g) {
                gateItems.push(g);
                continue;
              }
              const sa = getProjectionSkillActivation(item);
              if (sa) {
                skillActivationItems.push(sa);
              }
            }

            const projRunId = ackRunId ?? crypto.randomUUID();

            yield* emitRunStarted(projRunId);

            for (const th of thinkingItems) {
              const stepRunId = (th.runId ?? th.run_id ?? projRunId) as string;
              yield {
                type: "STEP_STARTED",
                stepName: "thinking",
                stepType: "thinking",
                threadId,
                runId: stepRunId,
              } as LiveChunk;
              yield {
                type: "STEP_FINISHED",
                stepName: "thinking",
                stepType: "thinking",
                content: th.body as string,
                threadId,
                runId: stepRunId,
              } as LiveChunk;
            }

            for (const ca of capActivities) {
              const invocationId = (ca.invocationId ?? ca.invocation_id) as string | undefined;
              const capId = ((ca.capabilityId ?? ca.capability_id) as string) || "tool";
              const capStatus = (ca.status as string) || "";
              const title = capId;
              if (invocationId) {
                if (capStatus === "started" || capStatus === "running") {
                  if (!activeToolCalls.has(invocationId)) {
                    activeToolCalls.add(invocationId);
                    yield emitToolStart(invocationId, title, projRunId);
                    yield emitToolArgs(invocationId, JSON.stringify({ input: "" }), projRunId);
                  }
                yield emitCustom("capability-activity", { toolCallId: invocationId, toolName: title, ...ca }, projRunId);
                } else {
                  if (!activeToolCalls.has(invocationId)) {
                    activeToolCalls.add(invocationId);
                    yield emitToolStart(invocationId, title, projRunId);
                    yield emitToolArgs(invocationId, JSON.stringify({ input: "" }), projRunId);
                  }
                  const errorKind = (ca.errorKind ?? ca.error_kind) as string | undefined;
                  const envelope = serializeToolResultEnvelope({
                    output: errorKind ? `Error: ${errorKind}` : "",
                    outputKind: null,
                    truncated: false,
                    inputSummary: null,
                    title,
                  });
                  const toolState =
                    capStatus === "failed" || capStatus === "killed"
                      ? "output-error"
                      : "output-available";
                  yield emitToolEnd(invocationId, title, toolState, envelope, "", projRunId);
                  yield emitCustom("capability-activity", { toolCallId: invocationId, toolName: title, ...ca }, projRunId);
                  activeToolCalls.delete(invocationId);
                }
              }
            }

            for (const g of gateItems) {
              const gateRef = (g.gateRef ?? g.gate_ref) as string | undefined;
              const headline = (g.headline as string) || "Approval required";
              if (gateRef) {
                const gateToolCallId = `gate-${gateRef}`;
                yield emitToolStart(gateToolCallId, "approval", projRunId);
                yield emitToolArgs(gateToolCallId, JSON.stringify({ input: headline }), projRunId);
                yield emitToolEnd(gateToolCallId, "approval", "output-available", "", headline, projRunId);
                yield emitCustom(
                  "approval-requested",
                  {
                    toolCallId: gateToolCallId,
                    toolName: "approval",
                    input: headline,
                    approval: {
                      id: gateRef,
                      needsApproval: true,
                      allowAlways: true,
                      toolName: "approval",
                      description: headline,
                    },
                  },
                  projRunId,
                );
                  yield emitCustom("gate", { gateRef, headline, toolCallId: gateToolCallId, toolName: "approval" }, projRunId);
              }
            }

            for (const tx of textItems) {
              const dedupeKey = `${tx.runId}:${tx.id}`;
              if (seenTextIds.has(dedupeKey)) continue;
              seenTextIds.add(dedupeKey);
              terminalTextEmitted = true;
              const msgId = assistantMessageId(tx.runId);
              yield {
                type: "TEXT_MESSAGE_CONTENT",
                threadId,
                runId: tx.runId,
                messageId: msgId,
                delta: tx.body,
              } as LiveChunk;
              yield {
                type: "TEXT_MESSAGE_END",
                threadId,
                runId: tx.runId,
                messageId: msgId,
              } as LiveChunk;
            }

            for (const sa of skillActivationItems) {
              const skillNames = (sa.skillNames ?? sa.skill_names) as string[] | undefined;
              const feedback = (sa.feedback ?? []) as string[];
              const id = (sa.id as string) ?? crypto.randomUUID();
              if (skillNames && skillNames.length > 0) {
                yield emitCustom(
                  "skill-activation",
                  { id, skillNames, feedback, runId: projRunId },
                  projRunId,
                );
              }
            }

            for (const rs of runStatuses) {
              if (rs.runId !== ackRunId) continue;
              const { runId, status: st } = rs;
              const isTerminal = [
                "completed",
                "succeeded",
                "failed",
                "cancelled",
                "recovery_required",
              ].includes(st);
              const isFailed = ["failed", "recovery_required"].includes(st);
              if (isTerminal) {
                if (isFailed) {
                  const msg =
                    ((rs.raw.failureSummary ?? rs.raw.failure_summary) as string) ?? `Run ${st}`;
                  const details = normalizeDetails(rs.raw);
                  yield emitCustom(
                    "failed",
                    { runId, message: msg, details, runState: rs.raw },
                    runId,
                  );
                  {
                    const endChunk = closeMessage(runId);
                    if (endChunk) yield endChunk;
                  }
                  yield { type: "RUN_ERROR", threadId, runId, message: msg, details } as LiveChunk;
                  return;
                }
                if (st === "cancelled") {
                  yield emitCustom("cancelled", { runId }, runId);
                  {
                    const endChunk = closeMessage(runId);
                    if (endChunk) yield endChunk;
                  }
                  for await (const chunk of closeActiveToolCalls(runId)) {
                    yield chunk;
                  }
                  yield { type: "RUN_FINISHED", threadId, runId, finishReason: null } as LiveChunk;
                  return;
                }
                if (!terminalTextEmitted) {
                  try {
                    const raw = await svc.getTimeline({ id: threadId, limit: 10 });
                    const entries: any[] = raw.data ?? [];
                const assistantText = findAssistantTextForRun(entries, runId);
                if (assistantText) {
                  terminalTextEmitted = true;
                  const msgId = assistantMessageId(runId);
                  yield {
                    type: "TEXT_MESSAGE_CONTENT",
                    threadId,
                        runId,
                        messageId: msgId,
                        delta: assistantText,
                      } as LiveChunk;
                    }
                    {
                      const endChunk = closeMessage(runId);
                      if (endChunk) yield endChunk;
                    }
                  } catch {
                    // reconcile failed, proceed
                  }
                }
                yield emitCustom("finished", { runId, status: st }, runId);
                {
                  const endChunk = closeMessage(runId);
                  if (endChunk) yield endChunk;
                }
                for await (const chunk of closeActiveToolCalls(runId)) {
                  yield chunk;
                }
                yield { type: "RUN_FINISHED", threadId, runId, finishReason: "stop" } as LiveChunk;
                return;
              }
            }
          }
          continue;
        }

        if (type === "keep_alive") continue;
      }

      if (runStarted) {
        if (!terminalTextEmitted) {
          try {
            const raw = await svc.getTimeline({ id: threadId, limit: 10 });
            const entries: any[] = raw.data ?? [];
            const targetRunId = ackRunId ?? crypto.randomUUID();
            const assistantText = findAssistantTextForRun(entries, targetRunId);
            if (assistantText) {
              terminalTextEmitted = true;
              const msgId = assistantMessageId(targetRunId);
              yield {
                type: "TEXT_MESSAGE_CONTENT",
                threadId,
                runId: targetRunId,
                messageId: msgId,
                delta: assistantText,
              } as LiveChunk;
            }
          } catch {
            // reconcile failed, proceed
          }
        }
        {
          const endChunk = closeMessage(ackRunId);
          if (endChunk) yield endChunk;
        }
        for await (const chunk of closeActiveToolCalls(ackRunId)) {
          yield chunk;
        }
        yield {
          type: "RUN_FINISHED",
          threadId,
          runId: ackRunId ?? crypto.randomUUID(),
          finishReason: "stop",
        } as LiveChunk;
      }
    } catch (error) {
      if (signal?.aborted) return;
      {
        const endChunk = closeMessage(ackRunId);
        if (endChunk) yield endChunk;
      }
      yield {
        type: "RUN_ERROR",
        threadId,
        runId: ackRunId ?? crypto.randomUUID(),
        message: normalizeMessage(error),
        details: normalizeDetails(error),
      } as LiveChunk;
    } finally {
      if (typeof upstream.return === "function") {
        try {
          await upstream.return(undefined);
        } catch {
          // ignore close failures
        }
      }
      if (latestCursor) {
        yield emitCustom("cursor", { cursor: latestCursor });
      }
    }
  };
}

export function createIronclawBridgeService(baseUrl: string, apiToken: string): BridgeService {
  const svc = new IronclawService(baseUrl, apiToken);
  return {
    sendMessage: ({ id, content, clientActionId, attachments }) =>
      Effect.runPromise(svc.sendMessage(id, content, clientActionId, attachments)),
    streamEvents: ({ id, afterCursor, signal }) => svc.streamEvents(id, afterCursor, signal),
    getTimeline: ({ id, limit }) =>
      Effect.runPromise(svc.getTimeline(id, limit)).then((r) => ({ data: r.data })),
  };
}

export function createIronclawBridgeServiceFromService(svc: IronclawService): BridgeService {
  return {
    sendMessage: ({ id, content, clientActionId, attachments }) =>
      Effect.runPromise(svc.sendMessage(id, content, clientActionId, attachments)),
    streamEvents: ({ id, afterCursor, signal }) => svc.streamEvents(id, afterCursor, signal),
    getTimeline: ({ id, limit }) =>
      Effect.runPromise(svc.getTimeline(id, limit)).then((r) => ({ data: r.data })),
  };
}
