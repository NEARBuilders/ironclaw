import { ConversationLiveChunkSchema } from "../contract";

type LiveChunk = {
  type:
    | "RUN_STARTED"
    | "RUN_FINISHED"
    | "RUN_ERROR"
    | "TOOL_CALL_START"
    | "TOOL_CALL_ARGS"
    | "TOOL_CALL_END"
    | "CUSTOM";
  threadId: string;
  runId?: string;
  messageId?: string;
  role?: "assistant" | "tool";
  toolCallId?: string;
  toolCallName?: string;
  toolName?: string;
  index?: number;
  delta?: string;
  args?: string;
  input?: unknown;
  result?: string;
  state?: string;
  finishReason?: string | null;
  message?: string;
  name?: string;
  value?: unknown;
};

type LiveEvent = Record<string, unknown> & { type?: string };

function normalizeMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  return typeof value === "string" ? value : String(value);
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
  preview: Record<string, unknown> | undefined,
  activity: Record<string, unknown> | undefined,
): string | undefined {
  return (
    (typeof preview?.invocationId === "string" && preview.invocationId) ||
    (typeof preview?.timelineMessageId === "string" && preview.timelineMessageId) ||
    (typeof preview?.toolCallId === "string" && preview.toolCallId) ||
    (typeof activity?.invocationId === "string" && activity.invocationId) ||
    (typeof activity?.timelineMessageId === "string" && activity.timelineMessageId) ||
    (typeof activity?.toolCallId === "string" && activity.toolCallId)
  ) as string | undefined;
}

function extractEventRunId(event: LiveEvent): string | undefined {
  const ack = event.ack as Record<string, unknown> | undefined;
  const runState = event.runState as Record<string, unknown> | undefined;
  const response = event.response as Record<string, unknown> | undefined;
  const reply = event.reply as Record<string, unknown> | undefined;
  const prompt = event.prompt as Record<string, unknown> | undefined;
  const authPrompt = event.authPrompt as Record<string, unknown> | undefined;
  const activity = event.activity as Record<string, unknown> | undefined;
  const preview = event.preview as Record<string, unknown> | undefined;
  const progress = event.progress as Record<string, unknown> | undefined;

  return (
    (typeof ack?.runId === "string" && ack.runId) ||
    (typeof ack?.activeRunId === "string" && ack.activeRunId) ||
    (typeof runState?.runId === "string" && runState.runId) ||
    (typeof response?.runId === "string" && response.runId) ||
    (typeof reply?.turnRunId === "string" && reply.turnRunId) ||
    (typeof prompt?.turnRunId === "string" && prompt.turnRunId) ||
    (typeof authPrompt?.turnRunId === "string" && authPrompt.turnRunId) ||
    (typeof activity?.turnRunId === "string" && activity.turnRunId) ||
    (typeof preview?.turnRunId === "string" && preview.turnRunId) ||
    (typeof progress?.turnRunId === "string" && progress.turnRunId)
  ) || undefined;
}

function createChunk(chunk: LiveChunk): LiveChunk {
  const result = ConversationLiveChunkSchema.safeParse(chunk);
  if (!result.success) {
    console.error("[live] schema mismatch:", result.error.format(), JSON.stringify(chunk));
  }
  return chunk;
}

export function createConversationLiveHandler(services: { ironclaw: (ctx: any) => any }) {
  return async function* ({ input, signal, context }: any) {
    const ic = services.ironclaw(context);
    const threadId = input.threadId as string;
    const expectedRunId = (input.runId as string | undefined) || undefined;
    const afterCursor = (input.afterCursor as string | undefined) ?? undefined;
    const runIdFallback = expectedRunId ?? crypto.randomUUID();
    const upstream = await ic.threads.streamEvents({ id: threadId, afterCursor });
    const pendingPreviews = new Map<string, Record<string, unknown>>();
    const activeToolCalls = new Set<string>();
    let runStarted = false;
    let runMatched = !expectedRunId;

    const emitRunStarted = (runId: string | undefined) => {
      if (runStarted) return;
      runStarted = true;
      return createChunk({ type: "RUN_STARTED", threadId, runId: runId ?? runIdFallback });
    };

    const emitCustom = (name: string, value: unknown, runId?: string): LiveChunk =>
      createChunk({ type: "CUSTOM", threadId, runId, name, value });

    const emitToolStart = (toolCallId: string, toolName: string, runId?: string): LiveChunk =>
      createChunk({
        type: "TOOL_CALL_START",
        threadId,
        runId,
        toolCallId,
        toolCallName: toolName,
        toolName,
        index: 0,
      });

    const emitToolArgs = (toolCallId: string, input: string, runId?: string): LiveChunk =>
      createChunk({
        type: "TOOL_CALL_ARGS",
        threadId,
        runId,
        toolCallId,
        delta: input,
        args: input,
      });

    const emitToolEnd = (
      toolCallId: string,
      toolName: string,
      state: "complete" | "error",
      result: string,
      input?: unknown,
      runId?: string,
    ): LiveChunk =>
      createChunk({
        type: "TOOL_CALL_END",
        threadId,
        runId,
        toolCallId,
        toolCallName: toolName,
        toolName,
        state,
        input,
        result,
      });

    try {
      for await (const raw of upstream as AsyncIterable<LiveEvent>) {
        if (signal?.aborted) break;

        const type = raw.type;
        const eventRunId = extractEventRunId(raw) ?? expectedRunId ?? runIdFallback;

        if (!runMatched) {
          if (!eventRunId || eventRunId !== expectedRunId) {
            continue;
          }
          runMatched = true;
        }

        if (type === "accepted" || type === "running") {
          const chunk = emitRunStarted(eventRunId);
          if (chunk) yield chunk;
          yield emitCustom(`ironclaw.${type}`, { runId: eventRunId, ...raw }, eventRunId);
          continue;
        }

        if (type === "capability_progress") {
          const chunk = emitRunStarted(eventRunId);
          if (chunk) yield chunk;
          yield emitCustom("ironclaw.capability-progress", raw.progress ?? raw, eventRunId);
          continue;
        }

        if (type === "capability_display_preview") {
          const preview = (raw.preview as Record<string, unknown> | undefined) ?? {};
          const invocationId = resolveToolCallId(preview, undefined);
          const capabilityId = preview.capabilityId as string | undefined;
          const title = (preview.title as string | undefined) ?? capabilityId ?? "unknown";

          if (invocationId) {
            pendingPreviews.set(invocationId, preview);
            const chunk = emitRunStarted(eventRunId);
            if (chunk) yield chunk;
            if (!activeToolCalls.has(invocationId)) {
              activeToolCalls.add(invocationId);
              yield emitToolStart(invocationId, title, eventRunId);
              yield emitToolArgs(invocationId, JSON.stringify({ input: preview.inputSummary ?? "" }), eventRunId);
            }
            yield emitCustom(
              "ironclaw.capability-display-preview",
              { ...preview, toolCallId: invocationId, toolName: title },
              eventRunId,
            );
          }
          continue;
        }

        if (type === "capability_activity") {
          const activity = (raw.activity as Record<string, unknown> | undefined) ?? {};
          const invocationId = resolveToolCallId(undefined, activity);
          const capabilityId = activity.capabilityId as string | undefined;
          const status = activity.status as string | undefined;
          const errorKind = activity.errorKind as string | undefined;

          if (!invocationId || !capabilityId) continue;

          const preview = pendingPreviews.get(invocationId) ?? {};
          const title = (preview.title as string | undefined) ?? capabilityId;
          const chunk = emitRunStarted(eventRunId);
          if (chunk) yield chunk;

          if (status === "started" || status === "running") {
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
              "ironclaw.capability-activity",
              {
                ...activity,
                toolCallId: invocationId,
                toolName: title,
              },
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
                JSON.stringify({ input: preview.inputSummary ?? "" }),
                eventRunId,
              );
            }

            const envelope = serializeToolResultEnvelope({
              output: (preview.outputSummary as string | undefined) ?? (preview.outputPreview as string | undefined) ?? (errorKind ? `Error: ${errorKind}` : ""),
              outputKind: (preview.outputKind as string | undefined) ?? null,
              truncated: Boolean(preview.truncated),
              inputSummary: (preview.inputSummary as string | undefined) ?? null,
              title,
            });
            const toolState = status === "failed" || status === "killed" ? "error" : "complete";
            yield emitToolEnd(
              invocationId,
              title,
              toolState,
              envelope,
              preview.inputSummary ?? "",
              eventRunId,
            );
            yield emitCustom(
              "ironclaw.capability-activity",
              {
                ...activity,
                toolCallId: invocationId,
                toolName: title,
              },
              eventRunId,
            );
            pendingPreviews.delete(invocationId);
            activeToolCalls.delete(invocationId);
          }
          continue;
        }

        if (type === "gate") {
          const prompt = (raw.prompt as Record<string, unknown> | undefined) ?? {};
          const approvalContext = (prompt.approvalContext as Record<string, unknown> | undefined) ?? {};
          const toolName = (approvalContext.toolName as string | undefined) ?? "approval";
          const gateRef = prompt.gateRef as string | undefined;
          const gateToolCallId = gateRef ?? `gate-${toolName}-${eventRunId}`;
          const chunk = emitRunStarted(eventRunId);
          if (chunk) yield chunk;
          yield emitToolStart(gateToolCallId, toolName, eventRunId);
          yield emitToolArgs(gateToolCallId, JSON.stringify({ input: approvalContext }), eventRunId);
          yield emitToolEnd(gateToolCallId, toolName, "complete", "", approvalContext, eventRunId);
          yield emitCustom(
            "approval-requested",
            {
              toolCallId: gateToolCallId,
              toolName,
              input: approvalContext,
              approval: { id: gateRef ?? gateToolCallId, needsApproval: true },
            },
            eventRunId,
          );
          yield emitCustom(
            "ironclaw.gate",
            { ...prompt, toolCallId: gateToolCallId, toolName, input: approvalContext },
            eventRunId,
          );
          continue;
        }

        if (type === "auth_required") {
          const authPrompt = (raw.authPrompt as Record<string, unknown> | undefined) ?? {};
          const chunk = emitRunStarted(eventRunId);
          if (chunk) yield chunk;
          yield emitCustom("ironclaw.auth-required", authPrompt, eventRunId);
          continue;
        }

        if (type === "final_reply") {
          const reply = (raw.reply as Record<string, unknown> | undefined) ?? {};
          const chunk = emitRunStarted(eventRunId);
          if (chunk) yield chunk;
          yield emitCustom("ironclaw.final-reply", reply, eventRunId);
          yield createChunk({ type: "RUN_FINISHED", threadId, runId: eventRunId, finishReason: "stop" });
          return;
        }

        if (type === "failed") {
          const runState = (raw.runState as Record<string, unknown> | undefined) ?? {};
          const message = normalizeMessage(runState.failure ?? raw.response ?? "Run failed");
          const chunk = emitRunStarted(eventRunId);
          if (chunk) yield chunk;
          yield emitCustom("ironclaw.failed", { runId: eventRunId, message, runState }, eventRunId);
          yield createChunk({ type: "RUN_ERROR", threadId, runId: eventRunId, message });
          return;
        }

        if (type === "cancelled") {
          const response = (raw.response as Record<string, unknown> | undefined) ?? {};
          const chunk = emitRunStarted(eventRunId);
          if (chunk) yield chunk;
          yield emitCustom("ironclaw.cancelled", { runId: eventRunId, ...response }, eventRunId);
          yield createChunk({ type: "RUN_FINISHED", threadId, runId: eventRunId, finishReason: null });
          return;
        }

        if (type === "projection_snapshot") {
          yield emitCustom("ironclaw.projection-snapshot", raw.state ?? raw, eventRunId);
          continue;
        }

        if (type === "projection_update") {
          yield emitCustom("ironclaw.projection-update", raw.state ?? raw, eventRunId);
          continue;
        }

        if (type === "keep_alive") {
          continue;
        }
      }

      if (runStarted) {
        yield createChunk({
          type: "RUN_FINISHED",
          threadId,
          runId: expectedRunId ?? runIdFallback,
          finishReason: "stop",
        });
      }
    } catch (error) {
      if (signal?.aborted) return;
      yield createChunk({
        type: "RUN_ERROR",
        threadId,
        runId: expectedRunId ?? runIdFallback,
        message: normalizeMessage(error),
      });
    } finally {
      if (typeof upstream.return === "function") {
        try {
          await upstream.return(undefined);
        } catch {
          // ignore close failures
        }
      }
    }
  };
}
