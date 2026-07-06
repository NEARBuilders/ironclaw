import { describe, expect, it } from "vitest";
import { ConversationEventSchema, ConversationSendAckSchema } from "../src/contract";

describe("ConversationEventSchema", () => {
  it("accepts a snapshot event", () => {
    const input = {
      type: "snapshot",
      threadId: "t-1",
      messages: [
        {
          id: "msg-1",
          threadId: "t-1",
          role: "assistant",
          text: "hello",
          createdAt: "2024-01-01T00:00:00Z",
          status: "finalized",
          sequence: 0,
          runId: null,
        },
      ],
    };
    const result = ConversationEventSchema.parse(input);
    expect(result.type).toBe("snapshot");
    expect(result.messages).toHaveLength(1);
  });

  it("accepts a keep_alive event", () => {
    const input = { type: "keep_alive", threadId: "t-1" };
    const result = ConversationEventSchema.parse(input);
    expect(result.type).toBe("keep_alive");
  });
});

describe("ConversationSendAckSchema", () => {
  it("accepts richer fields", () => {
    const input = {
      threadId: "t-1",
      runId: "run-1",
      acceptedMessageRef: "ref-1",
      pendingMessageId: "pending-abc",
      submittedAt: "2024-01-01T00:00:00Z",
      outcome: "submitted",
      status: "running",
      activeRunId: "run-1",
      eventCursor: 1,
    };
    const result = ConversationSendAckSchema.parse(input);
    expect(result.outcome).toBe("submitted");
    expect(result.status).toBe("running");
    expect(result.activeRunId).toBe("run-1");
  });
});
