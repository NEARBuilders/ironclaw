import { describe, expect, it, vi } from "vitest";
import { createConversationLiveHandler } from "../src/lib/conversation-live";

function event(type: string, overrides: Record<string, unknown> = {}) {
  return { type, ...overrides };
}

function mockIc(events: any[]) {
  const ic = {
    threads: {
      streamEvents: vi.fn().mockResolvedValue(
        (async function* () {
          for (const e of events) yield e;
        })(),
      ),
    },
  };

  return { ic };
}

async function collectEvents(
  handler: ReturnType<typeof createConversationLiveHandler>,
  input: { threadId: string; runId?: string; afterCursor?: string },
) {
  const gen = handler({ input, signal: new AbortController().signal, context: {} });
  const events: any[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

describe("createConversationLiveHandler", () => {
  it("maps capability events into AG-UI chunks and custom events", async () => {
    const { ic } = mockIc([
      event("accepted", {
        ack: { runId: "run-1", activeRunId: "run-1", threadId: "thread-1" },
      }),
      event("capability_display_preview", {
        preview: {
          timelineMessageId: "msg-1",
          capabilityId: "search-web",
          title: "Search web",
          inputSummary: "ironclaw",
          outputSummary: "found it",
          outputKind: "text",
          truncated: false,
        },
      }),
      event("capability_activity", {
        activity: {
          timelineMessageId: "msg-1",
          capabilityId: "search-web",
          status: "completed",
          errorKind: undefined,
        },
      }),
      event("final_reply", {
        reply: { text: "final answer", turnRunId: "run-1" },
      }),
    ]);

    const handler = createConversationLiveHandler({ ironclaw: () => ic as any });
    const events = await collectEvents(handler, { threadId: "thread-1", runId: "run-1" });

    expect(events.map((e) => e.type)).toEqual([
      "RUN_STARTED",
      "CUSTOM",
      "TOOL_CALL_START",
      "TOOL_CALL_ARGS",
      "CUSTOM",
      "TOOL_CALL_END",
      "CUSTOM",
      "CUSTOM",
      "RUN_FINISHED",
    ]);

    expect(events[1]!.name).toBe("ironclaw.accepted");
    expect(events[2]!.toolCallId).toBe("msg-1");
    expect(events[5]!.result).toContain("found it");
    expect(events[7]!.name).toBe("ironclaw.final-reply");
  });

  it("emits approval requests for gates", async () => {
    const { ic } = mockIc([
      event("accepted", {
        ack: { runId: "run-2", activeRunId: "run-2", threadId: "thread-1" },
      }),
      event("gate", {
        prompt: {
          turnRunId: "run-2",
          gateRef: "gate-1",
          headline: "Need approval",
          body: "Approve the tool call?",
          approvalContext: { toolName: "shell", action: "run", scope: "thread" },
        },
      }),
    ]);

    const handler = createConversationLiveHandler({ ironclaw: () => ic as any });
    const events = await collectEvents(handler, { threadId: "thread-1", runId: "run-2" });

    expect(events.map((e) => e.type)).toContain("TOOL_CALL_START");
    expect(events.map((e) => e.type)).toContain("TOOL_CALL_END");
    expect(events.find((e) => e.type === "CUSTOM" && e.name === "approval-requested")).toBeDefined();
    expect(events.find((e) => e.type === "CUSTOM" && e.name === "ironclaw.gate")).toBeDefined();
  });

  it("skips events for other runs", async () => {
    const { ic } = mockIc([
      event("accepted", {
        ack: { runId: "run-other", activeRunId: "run-other", threadId: "thread-1" },
      }),
      event("accepted", {
        ack: { runId: "run-3", activeRunId: "run-3", threadId: "thread-1" },
      }),
      event("final_reply", {
        reply: { text: "ok", turnRunId: "run-3" },
      }),
    ]);

    const handler = createConversationLiveHandler({ ironclaw: () => ic as any });
    const events = await collectEvents(handler, { threadId: "thread-1", runId: "run-3" });

    expect(events[0]!.type).toBe("RUN_STARTED");
    expect(events.some((e) => e.runId === "run-other")).toBe(false);
    expect(events[events.length - 1]!.type).toBe("RUN_FINISHED");
  });
});
