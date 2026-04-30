import type { RuntimeEvent } from "../types";

const TRUNC = 2000;

function truncate(s: string): string {
  if (s.length <= TRUNC) return s;
  return s.slice(0, TRUNC) + `... [truncated ${s.length - TRUNC} bytes]`;
}

function nowIso(): string {
  return new Date().toISOString();
}

// Codex SDK exposes structured events from runStreamed(). The event names below
// reflect the @openai/codex-sdk contract as of April 2026; any drift should be
// caught by the tests in codex-event-mapper.test.ts and the integration test in
// agent-runner-codex.test.ts.
export function mapCodexEvent(raw: unknown): RuntimeEvent | null {
  if (raw === null || raw === undefined || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const type = m.type;

  if (type === "thread.started") {
    const threadId = typeof m.threadId === "string" ? m.threadId : undefined;
    const evt: RuntimeEvent = { event: "session_started", timestamp: nowIso() };
    if (threadId !== undefined) evt.thread_id = threadId;
    return evt;
  }

  if (type === "agent_message" || type === "agent_message.delta") {
    const text = typeof m.text === "string" ? m.text : "";
    return { event: "notification", timestamp: nowIso(), message: truncate(text) };
  }

  if (type === "tool_call") {
    const name = typeof m.name === "string" ? m.name : "?";
    return { event: "notification", timestamp: nowIso(), message: `tool_use:${name}` };
  }

  if (type === "tool_call.completed") {
    return { event: "notification", timestamp: nowIso(), message: "tool_result" };
  }

  if (type === "task.completed") {
    return { event: "turn_completed", timestamp: nowIso() };
  }

  if (typeof type === "string") {
    return { event: "other_message", timestamp: nowIso(), message: type };
  }
  return { event: "malformed", timestamp: nowIso() };
}
