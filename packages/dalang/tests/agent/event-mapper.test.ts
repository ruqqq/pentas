// packages/dalang/tests/agent/event-mapper.test.ts
import { test, expect } from "bun:test";
import { mapSdkMessage } from "../../src/agent/event-mapper";

test("system init message → session_started", () => {
  const ev = mapSdkMessage({ type: "system", subtype: "init", session_id: "sess-1" });
  expect(ev?.event).toBe("session_started");
  expect(ev?.thread_id).toBe("sess-1");
});

test("assistant text → notification (truncated)", () => {
  const longText = "x".repeat(5000);
  const ev = mapSdkMessage({
    type: "assistant",
    message: { content: [{ type: "text", text: longText }] },
  });
  expect(ev?.event).toBe("notification");
  expect((ev?.message ?? "").length).toBeLessThanOrEqual(2050);
});

test("assistant tool_use → notification", () => {
  const ev = mapSdkMessage({
    type: "assistant",
    message: { content: [{ type: "tool_use", name: "read_file", input: { path: "x" } }] },
  });
  expect(ev?.event).toBe("notification");
  expect(ev?.message).toContain("tool_use");
});

test("user tool_result → notification", () => {
  const ev = mapSdkMessage({
    type: "user",
    message: { content: [{ type: "tool_result", content: "ok" }] },
  });
  expect(ev?.event).toBe("notification");
});

test("result success → turn_completed with usage", () => {
  const ev = mapSdkMessage({
    type: "result",
    subtype: "success",
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
  });
  expect(ev?.event).toBe("turn_completed");
  expect(ev?.usage?.total_tokens).toBe(15);
});

test("result error → turn_ended_with_error", () => {
  const ev = mapSdkMessage({ type: "result", subtype: "error_during_execution" });
  expect(ev?.event).toBe("turn_ended_with_error");
});

test("malformed message → malformed", () => {
  const ev = mapSdkMessage({ not_a_known_shape: true });
  expect(ev?.event).toBe("malformed");
});

test("null/undefined input returns null", () => {
  expect(mapSdkMessage(null)).toBeNull();
  expect(mapSdkMessage(undefined)).toBeNull();
});

// §10.4 startup_failed mappings
test("auth_status with error → startup_failed", () => {
  const ev = mapSdkMessage({
    type: "auth_status",
    isAuthenticating: false,
    output: [],
    error: "subscription_required",
  });
  expect(ev?.event).toBe("startup_failed");
  expect(ev?.reason).toBe("subscription_required");
});

test("auth_status without error → other_message (not startup_failed)", () => {
  const ev = mapSdkMessage({ type: "auth_status", isAuthenticating: true, output: [] });
  expect(ev?.event).toBe("other_message");
});

test("assistant with authentication_failed error and empty content → startup_failed", () => {
  const ev = mapSdkMessage({
    type: "assistant",
    error: "authentication_failed",
    message: { content: [] },
  });
  expect(ev?.event).toBe("startup_failed");
  expect(ev?.reason).toBe("authentication_failed");
});

test("assistant with billing_error and empty content → startup_failed", () => {
  const ev = mapSdkMessage({
    type: "assistant",
    error: "billing_error",
    message: { content: [] },
  });
  expect(ev?.event).toBe("startup_failed");
});

test("assistant with error but non-empty content → notification (not startup_failed)", () => {
  const ev = mapSdkMessage({
    type: "assistant",
    error: "authentication_failed",
    message: { content: [{ type: "text", text: "hello" }] },
  });
  // Content present means it's a partial response; treat as notification
  expect(ev?.event).toBe("notification");
});
