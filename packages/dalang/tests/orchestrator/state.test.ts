// packages/dalang/tests/orchestrator/state.test.ts
import { test, expect } from "bun:test";
import {
  createInitialState,
  addRunning,
  removeRunning,
  accumulateTokens,
} from "../../src/orchestrator/state";
import type { NormalizedIssue, RunningEntry } from "../../src/types";

const issue: NormalizedIssue = {
  id: "i1",
  identifier: "X-1",
  title: "t",
  description: null,
  priority: null,
  state: "Todo",
  branch_name: null,
  url: null,
  external_ref: null,
  internal_ref: null,
  labels: [],
  blocked_by: [],
  created_at: null,
  updated_at: null,
};

test("creates initial state with defaults", () => {
  const s = createInitialState({ poll_interval_ms: 30000, max_concurrent_agents: 4 });
  expect(s.running.size).toBe(0);
  expect(s.claude_totals.total_tokens).toBe(0);
});

test("addRunning sets entry and adds to claimed", () => {
  const s = createInitialState({ poll_interval_ms: 30000, max_concurrent_agents: 4 });
  const entry: RunningEntry = {
    issue,
    identifier: "X-1",
    workspace_path: "/tmp/X-1",
    agent_provider: "claude",
    started_at: new Date().toISOString(),
    abort_controller: new AbortController(),
    retry_attempt: null,
    session: null,
  };
  addRunning(s, "i1", entry);
  expect(s.running.has("i1")).toBe(true);
  expect(s.claimed.has("i1")).toBe(true);
});

test("removeRunning unsets entry and clears claim", () => {
  const s = createInitialState({ poll_interval_ms: 30000, max_concurrent_agents: 4 });
  const entry: RunningEntry = {
    issue,
    identifier: "X-1",
    workspace_path: "/tmp/X-1",
    agent_provider: "claude",
    started_at: new Date().toISOString(),
    abort_controller: new AbortController(),
    retry_attempt: null,
    session: null,
  };
  addRunning(s, "i1", entry);
  removeRunning(s, "i1");
  expect(s.running.has("i1")).toBe(false);
  expect(s.claimed.has("i1")).toBe(false);
});

test("accumulateTokens adds to totals", () => {
  const s = createInitialState({ poll_interval_ms: 30000, max_concurrent_agents: 4 });
  accumulateTokens(s, { input_tokens: 100, output_tokens: 50, total_tokens: 150 });
  accumulateTokens(s, { input_tokens: 10, output_tokens: 5, total_tokens: 15 });
  expect(s.claude_totals.input_tokens).toBe(110);
  expect(s.claude_totals.output_tokens).toBe(55);
  expect(s.claude_totals.total_tokens).toBe(165);
});

test("createInitialState includes empty pr_checks_polls map", () => {
  const s = createInitialState({ poll_interval_ms: 1000, max_concurrent_agents: 1 });
  expect(s.pr_checks_polls).toBeInstanceOf(Map);
  expect(s.pr_checks_polls.size).toBe(0);
});
