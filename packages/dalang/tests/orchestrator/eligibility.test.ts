// packages/dalang/tests/orchestrator/eligibility.test.ts
import { test, expect } from "bun:test";
import { sortForDispatch, isEligible } from "../../src/orchestrator/eligibility";
import { createInitialState } from "../../src/orchestrator/state";
import type { NormalizedIssue } from "../../src/types";

function mkIssue(p: Partial<NormalizedIssue>): NormalizedIssue {
  return {
    id: p.id ?? "id",
    identifier: p.identifier ?? "X-1",
    title: p.title ?? "t",
    description: null,
    priority: p.priority ?? null,
    state: p.state ?? "Todo",
    branch_name: null,
    url: null,
    external_ref: null,
    internal_ref: null,
    labels: [],
    blocked_by: p.blocked_by ?? [],
    created_at: p.created_at ?? null,
    updated_at: null,
  };
}

test("sortForDispatch: priority asc, nulls last; created_at oldest first; identifier lex", () => {
  const issues = [
    mkIssue({ id: "a", identifier: "X-3", priority: null, created_at: "2026-01-01" }),
    mkIssue({ id: "b", identifier: "X-1", priority: 1, created_at: "2026-01-02" }),
    mkIssue({ id: "c", identifier: "X-2", priority: 1, created_at: "2026-01-01" }),
    mkIssue({ id: "d", identifier: "X-4", priority: 2, created_at: "2026-01-01" }),
  ];
  const sorted = sortForDispatch(issues);
  expect(sorted.map((i) => i.id)).toEqual(["c", "b", "d", "a"]);
});

test("isEligible: rejects issue not in active states", () => {
  const s = createInitialState({ poll_interval_ms: 30000, max_concurrent_agents: 4 });
  const issue = mkIssue({ state: "Done" });
  expect(isEligible(issue, s, { active: ["Todo"], terminal: ["Done"], byState: {} })).toBe(false);
});

test("isEligible: rejects already-running issue", () => {
  const s = createInitialState({ poll_interval_ms: 30000, max_concurrent_agents: 4 });
  s.claimed.add("id1");
  const issue = mkIssue({ id: "id1", state: "Todo" });
  expect(isEligible(issue, s, { active: ["Todo"], terminal: ["Done"], byState: {} })).toBe(false);
});

test("isEligible: Todo with non-terminal blocker not eligible", () => {
  const s = createInitialState({ poll_interval_ms: 30000, max_concurrent_agents: 4 });
  const issue = mkIssue({
    state: "Todo",
    blocked_by: [{ id: "x", identifier: "X-9", state: "In Progress" }],
  });
  expect(isEligible(issue, s, { active: ["Todo"], terminal: ["Done"], byState: {} })).toBe(false);
});

test("isEligible: Todo with all-terminal blockers eligible", () => {
  const s = createInitialState({ poll_interval_ms: 30000, max_concurrent_agents: 4 });
  const issue = mkIssue({
    state: "Todo",
    blocked_by: [{ id: "x", identifier: "X-9", state: "Done" }],
  });
  expect(isEligible(issue, s, { active: ["Todo"], terminal: ["Done"], byState: {} })).toBe(true);
});

test("isEligible: respects per-state concurrency limit", () => {
  const s = createInitialState({ poll_interval_ms: 30000, max_concurrent_agents: 10 });
  // simulate 2 running In Progress
  for (const id of ["a", "b"]) {
    s.running.set(id, {
      issue: mkIssue({ id, state: "In Progress" }),
      identifier: id,
      workspace_path: "/",
      agent_provider: "claude",
      started_at: "",
      abort_controller: new AbortController(),
      retry_attempt: null,
      session: null,
    });
    s.claimed.add(id);
  }
  const candidate = mkIssue({ id: "c", state: "In Progress" });
  expect(
    isEligible(candidate, s, {
      active: ["In Progress"],
      terminal: [],
      byState: { "in progress": 2 },
    }),
  ).toBe(false);
});
