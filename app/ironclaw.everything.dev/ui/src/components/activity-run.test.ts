import { describe, expect, it } from "vitest";
import type { ToolCallPart, ToolResultPart } from "@tanstack/ai";
import {
  resolveToolRunEnvelope,
  resolveToolRunResultText,
  type ToolItem,
} from "./activity-run";

function toolItem(
  overrides: {
    call?: Partial<ToolCallPart>;
    result?: ToolResultPart;
  } = {},
): ToolItem {
  const call: ToolCallPart = {
    type: "tool-call",
    id: "call-1",
    name: "search_web",
    arguments: "{}",
    state: "complete",
  } as ToolCallPart;

  return {
    call: { ...call, ...overrides.call } as ToolCallPart,
    result: overrides.result,
  };
}

describe("resolveToolRunEnvelope", () => {
  it("falls back to call output when the result content is empty", () => {
    const item = toolItem({
      call: {
        output: {
          title: "Search web",
          inputSummary: "ironclaw",
          output: "found it",
          outputKind: "text",
          truncated: false,
        } as ToolCallPart["output"],
      },
      result: {
        type: "tool-result",
        toolCallId: "call-1",
        content: "",
        state: "complete",
      } as ToolResultPart,
    });

    expect(resolveToolRunEnvelope(item)?.output).toBe("found it");
    expect(resolveToolRunResultText(item)).toBe("found it");
  });

  it("preserves a non-empty result string", () => {
    const item = toolItem({
      result: {
        type: "tool-result",
        toolCallId: "call-1",
        content: "completed",
        state: "complete",
      } as ToolResultPart,
    });

    expect(resolveToolRunResultText(item)).toBe("completed");
  });
});
