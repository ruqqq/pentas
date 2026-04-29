// packages/dalang/src/agent/event-mapper.ts
import type { RuntimeEvent } from "../types";

const TRUNC = 2000;

function truncate(s: string): string {
  if (s.length <= TRUNC) return s;
  return s.slice(0, TRUNC) + `... [truncated ${s.length - TRUNC} bytes]`;
}

function nowIso(): string { return new Date().toISOString(); }

// SDK message shapes that the current SDK version (@anthropic-ai/claude-agent-sdk 0.2.x)
// does NOT surface as discrete streaming events, per §10.4 of the spec:
//
// - approval_auto_approved / approval_auto_denied: permission decisions are only
//   reported in SDKResultMessage.permission_denials[] at turn-end, not as
//   mid-stream events. No streaming approval decision message exists in SDKMessage.
//   TODO(§10.4): map once SDK emits a per-approval streaming event.
//
// - turn_input_required: there is no SDKMessage subtype for user-input-required.
//   The agent-runner.ts branch at line 142 is ready to handle it once the SDK
//   surfaces this condition as a message type.
//   TODO(§10.4): map once SDK emits an input-required event.
//
// - unsupported_tool_call: no dedicated SDK message type exists today.
//   TODO(§10.4): map once SDK emits an unsupported-tool event.

export function mapSdkMessage(raw: unknown): RuntimeEvent | null {
  if (raw === null || raw === undefined || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const type = m.type;

  if (type === "system" && m.subtype === "init") {
    return {
      event: "session_started",
      timestamp: nowIso(),
      thread_id: typeof m.session_id === "string" ? m.session_id : undefined,
    };
  }

  // SDKAuthStatusMessage: type='auth_status', error field present → startup failure.
  // Emitted when Claude Code cannot authenticate before the session starts.
  if (type === "auth_status" && typeof m.error === "string" && m.error.length > 0) {
    return { event: "startup_failed", timestamp: nowIso(), reason: m.error };
  }

  if (type === "assistant") {
    // SDKAssistantMessage.error signals a session/API-level error on the assistant turn
    // (e.g. authentication_failed, billing_error). When the error is a startup-class
    // error code and the message content is empty, treat it as startup_failed (§10.4).
    const errorCode = typeof m.error === "string" ? m.error : null;
    const startupErrors = new Set(["authentication_failed", "billing_error"]);
    const content = ((m.message as Record<string, unknown> | undefined)?.content ?? []) as unknown[];
    if (errorCode !== null && startupErrors.has(errorCode) && content.length === 0) {
      return { event: "startup_failed", timestamp: nowIso(), reason: errorCode };
    }

    const parts: string[] = [];
    for (const c of content) {
      if (c === null || typeof c !== "object") continue;
      const cc = c as Record<string, unknown>;
      if (cc.type === "text" && typeof cc.text === "string") parts.push(cc.text);
      else if (cc.type === "tool_use") parts.push(`tool_use:${String(cc.name ?? "?")}`);
    }
    return {
      event: "notification",
      timestamp: nowIso(),
      message: truncate(parts.join(" ")),
    };
  }

  if (type === "user") {
    const content = ((m.message as Record<string, unknown> | undefined)?.content ?? []) as unknown[];
    const hasToolResult = content.some((c) =>
      c !== null && typeof c === "object" && (c as Record<string, unknown>).type === "tool_result"
    );
    if (hasToolResult) {
      return { event: "notification", timestamp: nowIso(), message: "tool_result" };
    }
    return { event: "other_message", timestamp: nowIso() };
  }

  if (type === "result") {
    const subtype = m.subtype;
    const usage = m.usage as RuntimeEvent["usage"] | undefined;
    if (subtype === "success") {
      return { event: "turn_completed", timestamp: nowIso(), usage };
    }
    return { event: "turn_ended_with_error", timestamp: nowIso(), reason: typeof subtype === "string" ? subtype : undefined };
  }

  if (typeof type === "string") {
    return { event: "other_message", timestamp: nowIso(), message: type };
  }
  return { event: "malformed", timestamp: nowIso() };
}
