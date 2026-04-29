// packages/dalang/tests/orchestrator/retry.test.ts
import { test, expect } from "bun:test";
import { computeBackoffMs, scheduleRetry, cancelRetry } from "../../src/orchestrator/retry";
import { createInitialState } from "../../src/orchestrator/state";

test("backoff formula doubles per attempt and caps at max", () => {
  expect(computeBackoffMs(1, 300000)).toBe(10000);
  expect(computeBackoffMs(2, 300000)).toBe(20000);
  expect(computeBackoffMs(5, 300000)).toBe(160000);
  expect(computeBackoffMs(8, 300000)).toBe(300000);
  expect(computeBackoffMs(20, 300000)).toBe(300000);
});

test("scheduleRetry stores entry and timer", () => {
  const s = createInitialState({ poll_interval_ms: 30000, max_concurrent_agents: 4 });
  scheduleRetry(s, {
    issue_id: "i1", identifier: "X-1", attempt: 1, delayMs: 100,
    error: "boom", onFire: () => {},
  });
  expect(s.retry_attempts.has("i1")).toBe(true);
});

test("scheduling a new retry cancels the existing timer for the same issue", async () => {
  const s = createInitialState({ poll_interval_ms: 30000, max_concurrent_agents: 4 });
  let firedFirst = false;
  let firedSecond = false;
  scheduleRetry(s, { issue_id: "i1", identifier: "X-1", attempt: 1, delayMs: 50,
    error: null, onFire: () => { firedFirst = true; } });
  scheduleRetry(s, { issue_id: "i1", identifier: "X-1", attempt: 2, delayMs: 50,
    error: null, onFire: () => { firedSecond = true; } });
  await new Promise((r) => setTimeout(r, 120));
  expect(firedFirst).toBe(false);
  expect(firedSecond).toBe(true);
});

test("cancelRetry clears entry and prevents firing", async () => {
  const s = createInitialState({ poll_interval_ms: 30000, max_concurrent_agents: 4 });
  let fired = false;
  scheduleRetry(s, { issue_id: "i1", identifier: "X-1", attempt: 1, delayMs: 50,
    error: null, onFire: () => { fired = true; } });
  cancelRetry(s, "i1");
  await new Promise((r) => setTimeout(r, 80));
  expect(fired).toBe(false);
  expect(s.retry_attempts.has("i1")).toBe(false);
});
