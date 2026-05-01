// packages/dalang/tests/agent/agent-runner-codex.test.ts
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

test("runAttempt drives a Codex-shaped event stream end-to-end", async () => {
  // Fake Codex events using the real @openai/codex-sdk shape:
  // thread.started -> item.completed (agent_message) -> turn.completed.
  const events: unknown[] = [
    { type: "thread.started", thread_id: "codex-thread-1" },
    {
      type: "item.completed",
      item: { id: "msg-1", type: "agent_message", text: "hello" },
    },
    {
      type: "turn.completed",
      usage: {
        input_tokens: 12,
        cached_input_tokens: 0,
        output_tokens: 7,
        reasoning_output_tokens: 3,
      },
    },
  ];

  const collected: RuntimeEvent[] = [];
  const result = await runAttempt({
    issue,
    attempt: 1,
    promptTemplate: "{{ issue.title }}",
    workspacePath: "/tmp/workspace",
    config: {
      provider: "codex" as const,
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
      networkAccessEnabled: false,
      model: "gpt-5.5",
      executablePath: "codex",
      turnTimeoutMs: 60000,
      readTimeoutMs: 5000,
      stallTimeoutMs: 30000,
      maxTurns: 1,
    },
    controlPlane: { kind: "papan", endpoint: "http://localhost", api_key: null },
    trackerRefresh: async () => null,
    isActiveState: () => false,
    runQuery: async function* () {
      for (const e of events) yield e;
    },
    onEvent: (e) => {
      collected.push(e);
    },
  });

  expect(result.success).toBe(true);
  expect(result.thread_id).toBe("codex-thread-1");
  expect(result.tokens.input_tokens).toBe(12);
  expect(result.tokens.output_tokens).toBe(10); // 7 + 3 reasoning
  expect(result.tokens.total_tokens).toBe(22);
  expect(collected.some((e) => e.event === "session_started")).toBe(true);
  expect(collected.some((e) => e.event === "turn_completed")).toBe(true);
});

test("runAttempt treats Codex CLI task_complete envelope as turn completion", async () => {
  const collected: RuntimeEvent[] = [];
  const result = await runAttempt({
    issue,
    attempt: 1,
    promptTemplate: "{{ issue.title }}",
    workspacePath: "/tmp/workspace",
    config: {
      provider: "codex" as const,
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
      networkAccessEnabled: false,
      model: "gpt-5.5",
      executablePath: "codex",
      turnTimeoutMs: 60000,
      readTimeoutMs: 5000,
      stallTimeoutMs: 30000,
      maxTurns: 1,
    },
    controlPlane: { kind: "papan", endpoint: "http://localhost", api_key: null },
    trackerRefresh: async () => null,
    isActiveState: () => false,
    runQuery: async function* () {
      yield { type: "thread.started", thread_id: "codex-thread-2" };
      yield {
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 20,
              cached_input_tokens: 0,
              output_tokens: 5,
              reasoning_output_tokens: 2,
            },
          },
        },
      };
      yield {
        type: "event_msg",
        payload: {
          type: "task_complete",
          last_agent_message: "done",
        },
      };
    },
    onEvent: (e) => {
      collected.push(e);
    },
  });

  expect(result.success).toBe(true);
  expect(result.thread_id).toBe("codex-thread-2");
  expect(result.tokens).toEqual({ input_tokens: 20, output_tokens: 7, total_tokens: 27 });
  expect(collected.at(-1)?.event).toBe("turn_completed");
  expect(collected.at(-1)?.message).toBe("done");
});
