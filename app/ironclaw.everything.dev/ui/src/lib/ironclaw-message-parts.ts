import type { MessagePart } from "@tanstack/ai";

export interface IronclawToolResultEnvelope {
  title: string;
  inputSummary: string | null;
  output: string;
  outputKind: string | null;
  truncated: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  return JSON.stringify(value);
}

function asOptionalText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function serializeIronclawToolResultEnvelope(envelope: IronclawToolResultEnvelope): string {
  return JSON.stringify(envelope);
}

export function parseIronclawToolResultEnvelope(content: unknown): IronclawToolResultEnvelope | null {
  if (content == null) return null;

  if (isRecord(content)) {
    if (typeof content.output === "string" || typeof content.title === "string") {
      return {
        title: typeof content.title === "string" ? content.title : "unknown",
        inputSummary: asOptionalText(content.input_summary),
        output: asText(content.output ?? content.text ?? content.result ?? ""),
        outputKind: asOptionalText(content.output_kind),
        truncated: Boolean(content.truncated),
      };
    }

    return null;
  }

  if (typeof content !== "string" || !content) return null;

  try {
    const parsed = JSON.parse(content);
    if (!isRecord(parsed)) return null;

    if (parsed.version === 1 && typeof parsed.capability_id === "string" && typeof parsed.invocation_id === "string") {
      return {
        title: typeof parsed.title === "string" ? parsed.title : parsed.capability_id,
        inputSummary: asOptionalText(parsed.input_summary),
        output: asText(parsed.output_preview ?? parsed.output_summary ?? ""),
        outputKind: asOptionalText(parsed.output_kind),
        truncated: Boolean(parsed.truncated),
      };
    }

    if (typeof parsed.output === "string" || typeof parsed.title === "string") {
      return {
        title: typeof parsed.title === "string" ? parsed.title : "unknown",
        inputSummary: asOptionalText(parsed.input_summary),
        output: asText(parsed.output ?? parsed.text ?? parsed.result ?? ""),
        outputKind: asOptionalText(parsed.output_kind),
        truncated: Boolean(parsed.truncated),
      };
    }

    return null;
  } catch {
    return null;
  }
}

export function restMessageToParts(role: string, text: string): MessagePart[] {
  const trimmed = text.trim();
  if (role !== "assistant" || !trimmed) {
    return [{ type: "text" as const, content: trimmed }];
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (!isRecord(parsed) || parsed.version !== 1) {
      return [{ type: "text" as const, content: trimmed }];
    }

    if (typeof parsed.capability_id === "string" && typeof parsed.invocation_id === "string") {
      const toolCallId = parsed.invocation_id as string;
      const displayName = typeof parsed.title === "string" ? parsed.title : parsed.capability_id;
      const outputText = asText(parsed.output_preview ?? parsed.output_summary ?? "");
      const status = typeof parsed.status === "string" ? parsed.status : undefined;
      const isError = status === "failed" || status === "error" || status === "killed";
      const toolOutput = {
        output: outputText,
        output_kind: asOptionalText(parsed.output_kind),
        truncated: Boolean(parsed.truncated),
        input_summary: asOptionalText(parsed.input_summary),
        title: displayName,
      };

      return [
        {
          type: "tool-call" as const,
          id: toolCallId,
          name: displayName,
          arguments: parsed.input_summary ? JSON.stringify({ input: parsed.input_summary }) : "{}",
          output: toolOutput,
          state: "input-complete" as const,
        },
        {
          type: "tool-result" as const,
          toolCallId,
          content: serializeIronclawToolResultEnvelope({
            output: outputText,
            outputKind: asOptionalText(parsed.output_kind),
            truncated: Boolean(parsed.truncated),
            inputSummary: asOptionalText(parsed.input_summary),
            title: displayName,
          }),
          state: isError ? ("error" as const) : ("complete" as const),
        },
      ];
    }

    if (parsed.result_ref) {
      return [];
    }
  } catch {
    return [{ type: "text" as const, content: trimmed }];
  }

  return [{ type: "text" as const, content: trimmed }];
}
