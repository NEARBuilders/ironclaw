import { describe, expect, it } from "vitest";
import { restMessageToParts } from "./ironclaw-message-parts";

function asToolCall(part: unknown): { type: string; id: string } {
  return part as { type: string; id: string };
}

describe("restMessageToParts", () => {
  it("renders simple tool envelopes as tool parts", () => {
    const parts = restMessageToParts(
      "assistant",
      JSON.stringify({
        title: "Search web",
        input_summary: "ironclaw",
        output: "found it",
        output_kind: "text",
        truncated: false,
      }),
      { toolCallIdFallback: "msg-1" },
    );

    expect(parts).toHaveLength(2);
    expect(asToolCall(parts[0]).type).toBe("tool-call");
    expect(asToolCall(parts[0]).id).toBe("msg-1");
    expect(asToolCall(parts[1]).type).toBe("tool-result");
  });

  it("renders versioned tool envelopes as tool parts", () => {
    const parts = restMessageToParts(
      "assistant",
      JSON.stringify({
        version: 1,
        capability_id: "search-web",
        invocation_id: "inv-1",
        title: "Search web",
        input_summary: "ironclaw",
        output_summary: "found it",
        output_kind: "text",
        truncated: false,
      }),
    );

    expect(parts).toHaveLength(2);
    expect(asToolCall(parts[0]).type).toBe("tool-call");
    expect(asToolCall(parts[0]).id).toBe("inv-1");
  });
});
