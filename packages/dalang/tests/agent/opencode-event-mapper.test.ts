import { test, expect } from "bun:test";
import { mapOpencodeEvent } from "../../src/agent/opencode-event-mapper";

test("session.created with sessionID maps to session_started", () => {
  const evt = mapOpencodeEvent({
    type: "session.created",
    properties: { info: { id: "ses-1" } },
  });
  expect(evt?.event).toBe("session_started");
  expect((evt as { thread_id?: string }).thread_id).toBe("ses-1");
});

test("session.idle maps to turn_completed and folds reasoning into output", () => {
  const evt = mapOpencodeEvent({
    type: "session.idle",
    properties: {
      sessionID: "ses-1",
      tokens: { input: 100, output: 50, reasoning: 30 },
    },
  });
  expect(evt?.event).toBe("turn_completed");
  expect(evt?.usage?.input_tokens).toBe(100);
  expect(evt?.usage?.output_tokens).toBe(80);
  expect(evt?.usage?.total_tokens).toBe(180);
});

test("session.idle without tokens still maps to turn_completed (zero usage)", () => {
  const evt = mapOpencodeEvent({ type: "session.idle", properties: { sessionID: "ses-1" } });
  expect(evt?.event).toBe("turn_completed");
  expect(evt?.usage?.input_tokens).toBe(0);
});

test("session.error maps to turn_ended_with_error with reason", () => {
  const evt = mapOpencodeEvent({
    type: "session.error",
    properties: { sessionID: "ses-1", error: { message: "boom" } },
  });
  expect(evt?.event).toBe("turn_ended_with_error");
  expect((evt as { reason?: string }).reason).toBe("boom");
});

test("message.part.updated text part maps to notification with truncated text", () => {
  const evt = mapOpencodeEvent({
    type: "message.part.updated",
    properties: { part: { type: "text", text: "hello" } },
  });
  expect(evt?.event).toBe("notification");
  expect((evt as { message: string }).message).toBe("hello");
});

test("message.part.updated tool part with status=running maps to tool_use:<name>", () => {
  const evt = mapOpencodeEvent({
    type: "message.part.updated",
    properties: { part: { type: "tool", tool: "bash", state: { status: "running" } } },
  });
  expect(evt?.event).toBe("notification");
  expect((evt as { message: string }).message).toBe("tool_use:bash");
});

test("message.part.updated tool part with status=completed maps to tool_result", () => {
  const evt = mapOpencodeEvent({
    type: "message.part.updated",
    properties: { part: { type: "tool", tool: "bash", state: { status: "completed" } } },
  });
  expect(evt?.event).toBe("notification");
  expect((evt as { message: string }).message).toBe("tool_result");
});

test("message.part.updated reasoning part maps to null", () => {
  const evt = mapOpencodeEvent({
    type: "message.part.updated",
    properties: { part: { type: "reasoning", text: "thinking" } },
  });
  expect(evt).toBeNull();
});

test("server.connected maps to null (handled by runner, not surfaced)", () => {
  expect(mapOpencodeEvent({ type: "server.connected" })).toBeNull();
});

test("unknown type falls through to other_message with the raw type", () => {
  const evt = mapOpencodeEvent({ type: "lsp.client.diagnostics" });
  expect(evt?.event).toBe("other_message");
  expect((evt as { message: string }).message).toBe("lsp.client.diagnostics");
});

test("null and non-object inputs return null", () => {
  expect(mapOpencodeEvent(null)).toBeNull();
  expect(mapOpencodeEvent(42)).toBeNull();
});
