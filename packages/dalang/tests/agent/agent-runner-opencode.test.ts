// packages/dalang/tests/agent/agent-runner-opencode.test.ts
import { test, expect } from "bun:test";
import { runAttempt } from "../../src/agent/agent-runner";
import type { NormalizedIssue, RuntimeEvent } from "../../src/types";

const issue: NormalizedIssue = {
  id: "iss-1",
  identifier: "TOK-1",
  title: "Test",
  description: null,
  priority: null,
  state: "Done",
  branch_name: null,
  url: "https://example.invalid/iss-1",
  external_ref: null,
  internal_ref: null,
  labels: [],
  blocked_by: [],
  created_at: "2026-04-30T00:00:00Z",
  updated_at: "2026-04-30T00:00:00Z",
};

test("runAttempt drives an opencode-shaped event stream end-to-end", async () => {
  const events: unknown[] = [
    { type: "session.created", properties: { info: { id: "ses-1" } } },
    { type: "message.part.updated", properties: { sessionID: "ses-1", part: { type: "text", text: "hello" } } },
    { type: "session.idle", properties: { sessionID: "ses-1", tokens: { input: 12, output: 7, reasoning: 3 } } },
  ];

  const collected: RuntimeEvent[] = [];
  const result = await runAttempt({
    issue,
    attempt: 1,
    promptTemplate: "{{ issue.title }}",
    workspacePath: "/tmp/workspace",
    config: {
      provider: "opencode" as const,
      model: "anthropic/claude-sonnet-4-6",
      executablePath: "opencode",
      turnTimeoutMs: 60000,
      readTimeoutMs: 5000,
      stallTimeoutMs: 30000,
      maxTurns: 1,
    },
    controlPlane: { kind: "wayang", endpoint: "http://localhost", api_key: null },
    trackerRefresh: async () => null,
    isActiveState: () => false,
    runQuery: async function* () {
      for (const e of events) yield e;
    },
    onEvent: (e) => { collected.push(e); },
  });

  expect(result.success).toBe(true);
  expect(result.thread_id).toBe("ses-1");
  expect(result.tokens.input_tokens).toBe(12);
  expect(result.tokens.output_tokens).toBe(10); // 7 + 3 reasoning
  expect(result.tokens.total_tokens).toBe(22);
  expect(collected.some((e) => e.event === "session_started")).toBe(true);
  expect(collected.some((e) => e.event === "turn_completed")).toBe(true);
});
