// packages/dalang/tests/types.test.ts
import { test, expect } from "bun:test";
import type {
  NormalizedIssue,
  RunAttempt,
  LiveSession,
  RetryEntry,
  OrchestratorState,
  WorkspaceMeta,
  RuntimeEvent,
} from "../src/types";

test("NormalizedIssue is constructible", () => {
  const issue: NormalizedIssue = {
    id: "i_1",
    identifier: "PENTAS-1",
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
  expect(issue.id).toBe("i_1");
});

test("OrchestratorState has expected shape", () => {
  const state: OrchestratorState = {
    poll_interval_ms: 30000,
    max_concurrent_agents: 4,
    running: new Map(),
    claimed: new Set(),
    retry_attempts: new Map(),
    completed: new Set(),
    claude_totals: {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      seconds_running: 0,
    },
    rate_limits: null,
    workflow_mtime: null,
    pr_checks_polls: new Map(),
  };
  expect(state.running.size).toBe(0);
});
