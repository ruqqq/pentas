import { test, expect } from "bun:test";
import { mapCodexEvent } from "../../src/agent/codex-event-mapper";

test("thread.started event maps to session_started with thread_id", () => {
  const evt = mapCodexEvent({ type: "thread.started", threadId: "abc-123" });
  expect(evt?.event).toBe("session_started");
  expect(evt?.thread_id).toBe("abc-123");
});

test("agent_message maps to notification with truncated text", () => {
  const evt = mapCodexEvent({ type: "agent_message", text: "hello world" });
  expect(evt?.event).toBe("notification");
  expect((evt as { message: string }).message).toBe("hello world");
});

test("tool_call maps to notification with tool_use:<name>", () => {
  const evt = mapCodexEvent({ type: "tool_call", name: "shell" });
  expect(evt?.event).toBe("notification");
  expect((evt as { message: string }).message).toBe("tool_use:shell");
});

test("tool_call.completed maps to notification tool_result", () => {
  const evt = mapCodexEvent({ type: "tool_call.completed" });
  expect(evt?.event).toBe("notification");
  expect((evt as { message: string }).message).toBe("tool_result");
});

test("task.completed maps to turn_completed", () => {
  const evt = mapCodexEvent({ type: "task.completed" });
  expect(evt?.event).toBe("turn_completed");
});

test("unknown type falls through to other_message", () => {
  const evt = mapCodexEvent({ type: "something_new" });
  expect(evt?.event).toBe("other_message");
});

test("null and non-object inputs return null", () => {
  expect(mapCodexEvent(null)).toBeNull();
  expect(mapCodexEvent(42)).toBeNull();
});
