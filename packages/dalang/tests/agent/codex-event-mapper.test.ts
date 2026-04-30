import { test, expect } from "bun:test";
import { mapCodexEvent } from "../../src/agent/codex-event-mapper";

test("thread.started event maps to session_started with thread_id", () => {
  const evt = mapCodexEvent({ type: "thread.started", thread_id: "abc-123" });
  expect(evt?.event).toBe("session_started");
  expect(evt?.thread_id).toBe("abc-123");
});

test("turn.started maps to null (ignored)", () => {
  expect(mapCodexEvent({ type: "turn.started" })).toBeNull();
});

test("turn.completed maps to turn_completed with reasoning rolled into output and total summed", () => {
  const evt = mapCodexEvent({
    type: "turn.completed",
    usage: {
      input_tokens: 100,
      cached_input_tokens: 20,
      output_tokens: 50,
      reasoning_output_tokens: 30,
    },
  });
  expect(evt?.event).toBe("turn_completed");
  expect(evt?.usage?.input_tokens).toBe(100);
  expect(evt?.usage?.output_tokens).toBe(80);
  expect(evt?.usage?.total_tokens).toBe(180);
});

test("turn.failed maps to turn_ended_with_error with reason from error.message", () => {
  const evt = mapCodexEvent({ type: "turn.failed", error: { message: "boom" } });
  expect(evt?.event).toBe("turn_ended_with_error");
  expect((evt as { reason?: string }).reason).toBe("boom");
});

test("item.completed for agent_message maps to notification with truncated text", () => {
  const evt = mapCodexEvent({
    type: "item.completed",
    item: { id: "i1", type: "agent_message", text: "hello world" },
  });
  expect(evt?.event).toBe("notification");
  expect((evt as { message: string }).message).toBe("hello world");
});

test("item.started for agent_message maps to null (only emit on completion)", () => {
  const evt = mapCodexEvent({
    type: "item.started",
    item: { id: "i1", type: "agent_message", text: "partial" },
  });
  expect(evt).toBeNull();
});

test("item.started for command_execution maps to notification tool_use:shell", () => {
  const evt = mapCodexEvent({
    type: "item.started",
    item: {
      id: "c1",
      type: "command_execution",
      command: "ls -la",
      aggregated_output: "",
      status: "in_progress",
    },
  });
  expect(evt?.event).toBe("notification");
  expect((evt as { message: string }).message).toBe("tool_use:shell");
});

test("item.completed for command_execution maps to notification tool_result", () => {
  const evt = mapCodexEvent({
    type: "item.completed",
    item: {
      id: "c1",
      type: "command_execution",
      command: "ls -la",
      aggregated_output: "out",
      exit_code: 0,
      status: "completed",
    },
  });
  expect(evt?.event).toBe("notification");
  expect((evt as { message: string }).message).toBe("tool_result");
});

test("item.started for mcp_tool_call maps to notification tool_use:<tool>", () => {
  const evt = mapCodexEvent({
    type: "item.started",
    item: {
      id: "m1",
      type: "mcp_tool_call",
      server: "srv",
      tool: "fetch",
      arguments: {},
      status: "in_progress",
    },
  });
  expect(evt?.event).toBe("notification");
  expect((evt as { message: string }).message).toBe("tool_use:fetch");
});

test("item.completed for mcp_tool_call maps to notification tool_result", () => {
  const evt = mapCodexEvent({
    type: "item.completed",
    item: {
      id: "m1",
      type: "mcp_tool_call",
      server: "srv",
      tool: "fetch",
      arguments: {},
      status: "completed",
    },
  });
  expect(evt?.event).toBe("notification");
  expect((evt as { message: string }).message).toBe("tool_result");
});

test("item.started for file_change maps to notification tool_use:file_change", () => {
  const evt = mapCodexEvent({
    type: "item.started",
    item: {
      id: "f1",
      type: "file_change",
      changes: [{ path: "a.ts", kind: "update" }],
      status: "completed",
    },
  });
  expect(evt?.event).toBe("notification");
  expect((evt as { message: string }).message).toBe("tool_use:file_change");
});

test("item.completed for file_change maps to notification tool_result", () => {
  const evt = mapCodexEvent({
    type: "item.completed",
    item: {
      id: "f1",
      type: "file_change",
      changes: [{ path: "a.ts", kind: "update" }],
      status: "completed",
    },
  });
  expect(evt?.event).toBe("notification");
  expect((evt as { message: string }).message).toBe("tool_result");
});

test("item.completed for ErrorItem maps to notification with the message", () => {
  const evt = mapCodexEvent({
    type: "item.completed",
    item: { id: "e1", type: "error", message: "non-fatal blip" },
  });
  expect(evt?.event).toBe("notification");
  expect((evt as { message: string }).message).toBe("non-fatal blip");
});

test("item.completed for reasoning maps to null", () => {
  const evt = mapCodexEvent({
    type: "item.completed",
    item: { id: "r1", type: "reasoning", text: "thinking..." },
  });
  expect(evt).toBeNull();
});

test("item.completed for todo_list maps to null", () => {
  const evt = mapCodexEvent({
    type: "item.completed",
    item: { id: "t1", type: "todo_list", items: [{ text: "step", completed: false }] },
  });
  expect(evt).toBeNull();
});

test("ThreadErrorEvent (fatal error) maps to startup_failed with reason", () => {
  const evt = mapCodexEvent({ type: "error", message: "auth_failed" });
  expect(evt?.event).toBe("startup_failed");
  expect((evt as { reason?: string }).reason).toBe("auth_failed");
});

test("unknown type falls through to other_message", () => {
  const evt = mapCodexEvent({ type: "something_new" });
  expect(evt?.event).toBe("other_message");
});

test("null and non-object inputs return null", () => {
  expect(mapCodexEvent(null)).toBeNull();
  expect(mapCodexEvent(42)).toBeNull();
});
