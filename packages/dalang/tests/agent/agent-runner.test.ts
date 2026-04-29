// packages/dalang/tests/agent/agent-runner.test.ts
import { test, expect } from "bun:test";
import { runAttempt } from "../../src/agent/agent-runner";
import type { NormalizedIssue, RuntimeEvent } from "../../src/types";

const issue: NormalizedIssue = {
  id: "i1", identifier: "X-1", title: "t", description: "d", priority: null,
  state: "Todo", branch_name: null, url: null, labels: [], blocked_by: [],
  created_at: null, updated_at: null,
};

const baseDeps = (sdkMessages: unknown[]) => ({
  promptTemplate: "Body for {{ issue.identifier }}",
  workspacePath: "/tmp/X-1",
  config: { permissionMode: "auto" as const, model: "claude-opus-4-7", executablePath: "claude",
    turnTimeoutMs: 5000, readTimeoutMs: 1000, stallTimeoutMs: 0, maxTurns: 1 },
  trackerRefresh: async () => issue,
  isActiveState: (s: string) => s === "Todo",
  runQuery: async function* () {
    for (const m of sdkMessages) yield m;
  },
});

test("runs one turn, emits session_started + turn_completed, accumulates tokens", async () => {
  const events: RuntimeEvent[] = [];
  const result = await runAttempt({
    ...baseDeps([
      { type: "system", subtype: "init", session_id: "sess-1" },
      { type: "result", subtype: "success", usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } },
    ]),
    issue, attempt: null, onEvent: (e) => events.push(e),
  });
  expect(result.success).toBe(true);
  expect(result.tokens).toEqual({ input_tokens: 10, output_tokens: 5, total_tokens: 15 });
  expect(events.map((e) => e.event)).toEqual(["session_started", "turn_completed"]);
});

test("aborts cleanly when controller is aborted", async () => {
  const events: RuntimeEvent[] = [];
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 10);
  const result = await runAttempt({
    ...baseDeps([
      { type: "system", subtype: "init", session_id: "sess-1" },
      // no result message; iterator pretends to be slow
    ]),
    issue, attempt: null, onEvent: (e) => events.push(e), abortSignal: controller.signal,
  });
  expect(result.success).toBe(false);
  expect(result.reason).toBe("turn_cancelled");
});

test("multi-turn loop continues when issue stays active and turn budget allows", async () => {
  const events: RuntimeEvent[] = [];
  let turn = 0;
  const result = await runAttempt({
    ...baseDeps([]),
    config: { ...baseDeps([]).config, permissionMode: "auto" as const, maxTurns: 2 },
    issue, attempt: null, onEvent: (e) => events.push(e),
    runQuery: async function* () {
      turn += 1;
      yield { type: "system", subtype: "init", session_id: `s-${turn}` };
      yield { type: "result", subtype: "success", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
    },
  });
  expect(result.success).toBe(true);
  expect(turn).toBe(2);
  expect(result.tokens.total_tokens).toBe(4);
});
