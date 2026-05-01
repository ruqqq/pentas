import type { ThreadEvent, ThreadItem } from "@openai/codex-sdk";
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

function usageFromTokenCount(info: unknown): RuntimeEvent["usage"] | null {
  if (info === null || typeof info !== "object") return null;
  const last = (info as { last_token_usage?: unknown }).last_token_usage;
  if (last === null || typeof last !== "object") return null;
  const usage = last as Record<string, unknown>;
  const input = typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
  const output = typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
  const reasoning =
    typeof usage.reasoning_output_tokens === "number" ? usage.reasoning_output_tokens : 0;
  return {
    input_tokens: input,
    output_tokens: output + reasoning,
    total_tokens: input + output + reasoning,
  };
}

function mapCodexCliEvent(raw: Record<string, unknown>): RuntimeEvent | null {
  if (raw.type !== "event_msg") return null;
  const payload = raw.payload;
  if (payload === null || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  switch (p.type) {
    case "agent_message": {
      const message = typeof p.message === "string" ? p.message : "";
      return notification(truncate(message));
    }
    case "token_count": {
      const evt = notification("token_count");
      const usage = usageFromTokenCount(p.info);
      if (usage) evt.usage = usage;
      return evt;
    }
    case "task_complete": {
      const evt: RuntimeEvent = { event: "turn_completed", timestamp: nowIso() };
      if (typeof p.last_agent_message === "string") evt.message = truncate(p.last_agent_message);
      return evt;
    }
    case "error": {
      const evt: RuntimeEvent = { event: "turn_ended_with_error", timestamp: nowIso() };
      if (typeof p.message === "string") evt.reason = p.message;
      return evt;
    }
    case "task_started":
    case "user_message":
      return null;
    default:
      return notification(String(p.type ?? "event_msg"));
  }
}

function mapItemStarted(item: ThreadItem): RuntimeEvent | null {
  switch (item.type) {
    case "command_execution":
      return notification("tool_use:shell");
    case "mcp_tool_call":
      return notification(`tool_use:${item.tool || "?"}`);
    case "file_change":
      return notification("tool_use:file_change");
    case "web_search":
      return notification("tool_use:web_search");
    // agent_message, reasoning, todo_list, error are ignored on start
    default:
      return null;
  }
}

function mapItemCompleted(item: ThreadItem): RuntimeEvent | null {
  switch (item.type) {
    case "command_execution":
    case "mcp_tool_call":
    case "file_change":
    case "web_search":
      return notification("tool_result");
    case "agent_message":
      return notification(truncate(item.text));
    case "error":
      return notification(item.message);
    // reasoning, todo_list ignored
    default:
      return null;
  }
}

// Codex SDK exposes structured events from runStreamed(). The event names below
// reflect @openai/codex-sdk's ThreadEvent contract; any drift should be caught
// by the tests in codex-event-mapper.test.ts.
export function mapCodexEvent(raw: unknown): RuntimeEvent | null {
  if (raw === null || raw === undefined || typeof raw !== "object") return null;
  const cliEvent = mapCodexCliEvent(raw as Record<string, unknown>);
  if (cliEvent) return cliEvent;
  const e = raw as ThreadEvent;

  switch (e.type) {
    case "thread.started": {
      const evt: RuntimeEvent = { event: "session_started", timestamp: nowIso() };
      if (typeof e.thread_id === "string") evt.thread_id = e.thread_id;
      return evt;
    }
    case "turn.started":
      return null;
    case "turn.completed": {
      const u = e.usage;
      const out: RuntimeEvent = { event: "turn_completed", timestamp: nowIso() };
      if (u && typeof u === "object") {
        // OpenAI's input_tokens already includes cached_input_tokens; do not
        // double-count. reasoning_output_tokens is folded into output_tokens
        // because RuntimeEvent.usage has no separate reasoning bucket.
        const input = typeof u.input_tokens === "number" ? u.input_tokens : 0;
        const output = typeof u.output_tokens === "number" ? u.output_tokens : 0;
        const reasoning =
          typeof u.reasoning_output_tokens === "number" ? u.reasoning_output_tokens : 0;
        out.usage = {
          input_tokens: input,
          output_tokens: output + reasoning,
          total_tokens: input + output + reasoning,
        };
      }
      return out;
    }
    case "turn.failed": {
      const out: RuntimeEvent = { event: "turn_ended_with_error", timestamp: nowIso() };
      if (e.error && typeof e.error.message === "string") out.reason = e.error.message;
      return out;
    }
    case "item.started":
      return mapItemStarted(e.item);
    case "item.updated":
      return null;
    case "item.completed":
      return mapItemCompleted(e.item);
    case "error": {
      const out: RuntimeEvent = { event: "startup_failed", timestamp: nowIso() };
      if (typeof e.message === "string") out.reason = e.message;
      return out;
    }
    default: {
      const t = (e as { type?: unknown }).type;
      if (typeof t === "string") {
        return { event: "other_message", timestamp: nowIso(), message: t };
      }
      return { event: "malformed", timestamp: nowIso() };
    }
  }
}
