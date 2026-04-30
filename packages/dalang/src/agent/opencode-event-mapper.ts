import type { RuntimeEvent } from "../types";

const TRUNC = 2000;

function truncate(s: string): string {
  if (s.length <= TRUNC) return s;
  return s.slice(0, TRUNC) + `... [truncated ${s.length - TRUNC} bytes]`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function notification(message: string): RuntimeEvent {
  return { event: "notification", timestamp: nowIso(), message };
}

interface RawEvent {
  type?: unknown;
  properties?: unknown;
}

function getProps(raw: RawEvent): Record<string, unknown> | null {
  if (raw.properties && typeof raw.properties === "object") {
    return raw.properties as Record<string, unknown>;
  }
  return null;
}

function mapPart(part: Record<string, unknown>): RuntimeEvent | null {
  const partType = part.type;
  if (partType === "text") {
    const text = typeof part.text === "string" ? part.text : "";
    if (!text) return null;
    return notification(truncate(text));
  }
  if (partType === "tool") {
    const tool = typeof part.tool === "string" ? part.tool : "?";
    const state = part.state as { status?: unknown } | undefined;
    const status = state && typeof state.status === "string" ? state.status : "";
    if (status === "completed" || status === "error") return notification("tool_result");
    if (status === "running" || status === "pending") return notification(`tool_use:${tool}`);
    return null;
  }
  // reasoning, file, etc. — not surfaced
  return null;
}

export function mapOpencodeEvent(raw: unknown): RuntimeEvent | null {
  if (raw === null || raw === undefined || typeof raw !== "object") return null;
  const e = raw as RawEvent;
  const t = typeof e.type === "string" ? e.type : null;
  if (t === null) return { event: "malformed", timestamp: nowIso() };

  const props = getProps(e);

  switch (t) {
    case "session.created": {
      const info =
        props && typeof props.info === "object" ? (props.info as Record<string, unknown>) : null;
      const id = info && typeof info.id === "string" ? info.id : null;
      const out: RuntimeEvent = { event: "session_started", timestamp: nowIso() };
      if (id) out.thread_id = id;
      return out;
    }
    case "session.updated":
      return null;
    case "session.idle": {
      const tokens =
        props && typeof props.tokens === "object"
          ? (props.tokens as Record<string, unknown>)
          : null;
      const input = tokens && typeof tokens.input === "number" ? tokens.input : 0;
      const output = tokens && typeof tokens.output === "number" ? tokens.output : 0;
      const reasoning = tokens && typeof tokens.reasoning === "number" ? tokens.reasoning : 0;
      return {
        event: "turn_completed",
        timestamp: nowIso(),
        usage: {
          input_tokens: input,
          output_tokens: output + reasoning,
          total_tokens: input + output + reasoning,
        },
      };
    }
    case "session.error": {
      const out: RuntimeEvent = { event: "turn_ended_with_error", timestamp: nowIso() };
      const err = props?.error as { message?: unknown } | undefined;
      if (err && typeof err.message === "string") out.reason = err.message;
      return out;
    }
    case "message.part.updated": {
      const part =
        props && typeof props.part === "object"
          ? (props.part as Record<string, unknown>)
          : null;
      if (!part) return null;
      return mapPart(part);
    }
    case "message.part.removed":
    case "message.updated":
    case "server.connected":
    case "server.instance.disposed":
      return null;
    default:
      return { event: "other_message", timestamp: nowIso(), message: t };
  }
}
