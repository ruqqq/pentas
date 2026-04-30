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
    const u = m.usage as Record<string, unknown> | undefined;
    let usage: RuntimeEvent["usage"] | undefined;
    if (u) {
      const input = typeof u.input_tokens === "number" ? u.input_tokens : 0;
      const output = typeof u.output_tokens === "number" ? u.output_tokens : 0;
      const reasoning = typeof u.reasoning_tokens === "number" ? u.reasoning_tokens : 0;
      const total = typeof u.total_tokens === "number" ? u.total_tokens : input + output + reasoning;
      usage = {
        input_tokens: input,
        output_tokens: output + reasoning,
        total_tokens: total,
      };
    }
    const out: RuntimeEvent = { event: "turn_completed", timestamp: nowIso() };
    if (usage) out.usage = usage;
    return out;
  }

  if (type === "task.failed") {
    const out: RuntimeEvent = { event: "turn_ended_with_error", timestamp: nowIso() };
    if (typeof m.reason === "string") out.reason = m.reason;
    return out;
  }

  if (type === "error" && m.phase === "startup") {
    const out: RuntimeEvent = { event: "startup_failed", timestamp: nowIso() };
    if (typeof m.message === "string") out.reason = m.message;
    return out;
  }

  if (typeof type === "string") {
    return { event: "other_message", timestamp: nowIso(), message: type };
  }
  return { event: "malformed", timestamp: nowIso() };
}
