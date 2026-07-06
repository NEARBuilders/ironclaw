import { describe, expect, it, vi } from "vitest";
import { normalizeTimelineEntry } from "../src/normalize";
import type { BridgeService } from "../src/chat-bridge";
import { createThreadChatBridge } from "../src/chat-bridge";

function event(type: string, overrides: Record<string, unknown> = {}) {
  return { type, ...overrides };
}

function mockSvc(events: any[], timelineData?: any[]): BridgeService {
  return {
    sendMessage: vi.fn().mockResolvedValue({
      outcome: "submitted" as const,
      threadId: "thread-1",
      acceptedMessageRef: "ref-1",
      runId: "test-run-1",
      turnId: "turn-1",
      status: "accepted",
      resolvedRunProfileId: "profile-1",
      resolvedRunProfileVersion: 1,
      eventCursor: 0,
    }),
    streamEvents: vi.fn().mockReturnValue(
      (async function* () {
        for (const e of events) yield e;
      })(),
    ) as any,
    getTimeline: vi.fn().mockResolvedValue({ data: timelineData ?? [] }),
  };
}

async function collectEvents(
  handler: ReturnType<typeof createThreadChatBridge>,
  input: { threadId: string; messages?: any[] },
) {
  const gen = handler({
    input: {
      threadId: input.threadId,
      messages: input.messages ?? [{ id: "test-1", role: "user", content: "test" }],
    },
    signal: new AbortController().signal,
  });
  const events: any[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

describe("normalizeTimelineEntry", () => {
  it("includes attachment refs when present in raw entry", () => {
    const raw = {
      message_id: "msg-1",
      thread_id: "t-1",
      kind: "User",
      content: "hello with files",
      status: "finalized",
      sequence: 5,
      attachments: [
        {
          id: "att-1",
          kind: "image",
          mime_type: "image/png",
          filename: "screenshot.png",
          size_bytes: 204800,
        },
        {
          id: "att-2",
          kind: "document",
          mime_type: "application/pdf",
          filename: "report.pdf",
        },
      ],
    };

    const result = normalizeTimelineEntry(raw, "t-1");
    expect(result.attachments).toBeDefined();
    expect(result.attachments).toHaveLength(2);
    const first = result.attachments![0]!;
    expect(first.id).toBe("att-1");
    expect(first.kind).toBe("image");
    expect(first.mimeType).toBe("image/png");
    expect(first.filename).toBe("screenshot.png");
    expect(first.sizeBytes).toBe(204800);
    const second = result.attachments![1]!;
    expect(second.id).toBe("att-2");
    expect(second.kind).toBe("document");
    expect(second.mimeType).toBe("application/pdf");
    expect(second.sizeBytes).toBeUndefined();
  });

  it("handles camelCase keys too", () => {
    const raw = {
      messageId: "msg-2",
      thread_id: "t-1",
      kind: "Assistant",
      content: "reply",
      status: "finalized",
      sequence: 6,
      attachments: [
        {
          id: "att-3",
          kind: "audio",
          mimeType: "audio/wav",
          filename: "recording.wav",
          sizeBytes: 512000,
        },
      ],
    };

    const result = normalizeTimelineEntry(raw, "t-1");
    expect(result.attachments).toBeDefined();
    expect(result.attachments).toHaveLength(1);
    const att = result.attachments![0]!;
    expect(att.id).toBe("att-3");
    expect(att.kind).toBe("audio");
  });

  it("defaults to empty array when no attachments", () => {
    const raw = {
      message_id: "msg-3",
      thread_id: "t-1",
      kind: "User",
      content: "hello",
      status: "finalized",
      sequence: 0,
    };

    const result = normalizeTimelineEntry(raw, "t-1");
    expect(result.attachments).toEqual([]);
  });

  it.each([
    { kind: "user", expectedRole: "user" },
    { kind: "User", expectedRole: "user" },
    { kind: "user_message", expectedRole: "user" },
    { kind: "assistant", expectedRole: "assistant" },
    { kind: "Assistant", expectedRole: "assistant" },
    { kind: "assistant_message", expectedRole: "assistant" },
    { kind: "tool_result", expectedRole: "assistant" },
  ])("normalizes kind=$kind to role=$expectedRole", ({ kind, expectedRole }) => {
    const raw = {
      message_id: "msg-role-1",
      thread_id: "t-1",
      kind,
      content: "test",
      status: "finalized",
      sequence: 0,
    };
    const result = normalizeTimelineEntry(raw, "t-1");
    expect(result.role).toBe(expectedRole);
  });

  it("prefers raw.role over kind when present", () => {
    const raw = {
      message_id: "msg-role-2",
      thread_id: "t-1",
      kind: "assistant",
      role: "user",
      content: "forced user text",
      status: "finalized",
      sequence: 0,
    };
    const result = normalizeTimelineEntry(raw, "t-1");
    expect(result.role).toBe("user");
  });

  it("treats unknown kind with actorId as user", () => {
    const raw = {
      message_id: "msg-unknown-actor",
      thread_id: "t-1",
      kind: "unknown_custom_kind",
      actor_id: "someone",
      content: "custom content",
      status: "finalized",
      sequence: 0,
    };
    const result = normalizeTimelineEntry(raw, "t-1");
    expect(result.role).toBe("user");
  });

  it("never coerces user-like rows into assistant", () => {
    for (const kind of ["user", "User", "user_message"]) {
      const raw = {
        message_id: `msg-nope-${kind}`,
        thread_id: "t-1",
        kind,
        content: "user text",
        status: "finalized",
        sequence: 0,
      };
      const result = normalizeTimelineEntry(raw, "t-1");
      expect(result.role).toBe("user");
    }
  });
});

describe("createThreadChatBridge", () => {
  it("sends message and streams events into AG-UI chunks", async () => {
    const svc = mockSvc([
      event("accepted", {
        ack: { runId: "test-run-1", outcome: "submitted", threadId: "thread-1" },
      }),
      event("final_reply", {
        reply: { text: "hello from the bridge", turnRunId: "test-run-1" },
      }),
    ]);

    const handler = createThreadChatBridge(svc);
    const events = await collectEvents(handler, { threadId: "thread-1" });

    expect(svc.sendMessage).toHaveBeenCalledTimes(1);
    expect(events[0]!.type).toBe("RUN_STARTED");
    expect(events.some((e) => e.type === "TEXT_MESSAGE_CONTENT")).toBe(true);
    expect(events[events.length - 1]!.type).toBe("RUN_FINISHED");
  });

  it("emits approval-requested for gate events", async () => {
    const svc = mockSvc([
      event("accepted", {
        ack: { runId: "test-run-1", outcome: "submitted", threadId: "thread-1" },
      }),
      event("gate", {
        prompt: {
          turnRunId: "test-run-1",
          gateRef: "gate-1",
          headline: "Need approval",
          body: "Approve?",
          approvalContext: { toolName: "shell", action: "run", scope: "thread" },
        },
      }),
    ]);

    const handler = createThreadChatBridge(svc);
    const events = await collectEvents(handler, { threadId: "thread-1" });

    expect(events.some((e) => e.type === "CUSTOM" && e.name === "approval-requested")).toBe(true);
  });

  it("processes projection items into AG-UI chunks", async () => {
    const svc = mockSvc([
      event("accepted", {
        ack: { runId: "test-run-1", outcome: "submitted", threadId: "thread-1" },
      }),
      event("projection_snapshot", {
        state: {
          items: [
            { text: { id: "txt-1", body: "projection says hello" } },
            { runStatus: { runId: "test-run-1", status: "completed" } },
          ],
        },
      }),
    ]);

    const handler = createThreadChatBridge(svc);
    const events = await collectEvents(handler, { threadId: "thread-1" });

    expect(events.some((e) => e.type === "TEXT_MESSAGE_CONTENT")).toBe(true);
    expect(events.some((e) => e.type === "RUN_FINISHED")).toBe(true);
  });
});
