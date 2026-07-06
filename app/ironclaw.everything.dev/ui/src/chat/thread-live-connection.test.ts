import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/lib/api";
import { createThreadLiveConnection } from "./thread-live-connection";

describe("createThreadLiveConnection", () => {
  it("passes the resume cursor into subscribe and stores the latest cursor from send", async () => {
    const subscribeThread = vi.fn(async () => {
      async function* stream() {
        yield { type: "keep_alive" } as any;
      }

      return stream();
    });
    const sendMessage = vi.fn(async () => ({ eventCursor: 17 }));
    const cursors: Array<string | undefined> = [];

    const apiClient = {
      conversation: {
        subscribeThread,
        sendMessage,
      },
    } as unknown as ApiClient;

    const adapter = createThreadLiveConnection({
      apiClient,
      threadId: "thread-1",
      getCursor: () => "cursor-abc",
      setCursor: (cursor) => cursors.push(cursor),
    });

    const subscription = adapter.subscribe()[Symbol.asyncIterator]();
    await subscription.next();

    await adapter.send([
      {
        id: "m-1",
        role: "user",
        content: "hello",
        parts: [{ type: "text", content: "hello" }],
      } as any,
    ]);

    expect(subscribeThread).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "thread-1", afterCursor: "cursor-abc" }),
    );
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "thread-1", content: "hello" }),
    );
    expect(cursors).toEqual(["17"]);
  });
});
