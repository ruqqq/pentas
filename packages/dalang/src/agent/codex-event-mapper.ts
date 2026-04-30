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
