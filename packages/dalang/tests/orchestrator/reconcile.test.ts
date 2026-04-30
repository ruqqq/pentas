// packages/dalang/tests/orchestrator/reconcile.test.ts
import { test, expect } from "bun:test";
import { detectStalls, classifyTrackerRefresh } from "../../src/orchestrator/reconcile";
import { createInitialState } from "../../src/orchestrator/state";
import type { NormalizedIssue, RunningEntry } from "../../src/types";

function makeRunning(issue: NormalizedIssue, lastEventAt: string | null, startedAt: string): RunningEntry {
  return {
    issue, identifier: issue.identifier, workspace_path: "/tmp",
    started_at: startedAt, abort_controller: new AbortController(),
    retry_attempt: null,
    session: lastEventAt ? {
      session_id: "t-1", thread_id: "t", turn_id: "1",
      claude_session_pid: null, last_event: "notification",
      last_event_at: lastEventAt, last_message: null,
      input_tokens: 0, output_tokens: 0, total_tokens: 0,
      last_reported_input_tokens: 0, last_reported_output_tokens: 0, last_reported_total_tokens: 0,
      turn_count: 1,
    } : null,
  };
}

const issue = (state: string): NormalizedIssue => ({
  id: "i1", identifier: "X-1", title: "t", description: null, priority: null,
  state, branch_name: null, url: null, external_ref: null, internal_ref: null, labels: [], blocked_by: [],
  created_at: null, updated_at: null,
});

test("detectStalls uses last_event_at when present", () => {
  const s = createInitialState({ poll_interval_ms: 30000, max_concurrent_agents: 4 });
  const old = new Date(Date.now() - 60_000).toISOString();
  s.running.set("i1", makeRunning(issue("Todo"), old, new Date().toISOString()));
  const stalls = detectStalls(s, 10_000);
  expect(stalls).toEqual(["i1"]);
});

test("detectStalls falls back to started_at when no events", () => {
  const s = createInitialState({ poll_interval_ms: 30000, max_concurrent_agents: 4 });
  const oldStart = new Date(Date.now() - 60_000).toISOString();
  s.running.set("i1", makeRunning(issue("Todo"), null, oldStart));
  const stalls = detectStalls(s, 10_000);
  expect(stalls).toEqual(["i1"]);
});

test("detectStalls skipped when stall_timeout_ms <= 0", () => {
  const s = createInitialState({ poll_interval_ms: 30000, max_concurrent_agents: 4 });
  const oldStart = new Date(Date.now() - 60_000).toISOString();
  s.running.set("i1", makeRunning(issue("Todo"), null, oldStart));
  expect(detectStalls(s, 0)).toEqual([]);
  expect(detectStalls(s, -1)).toEqual([]);
});

test("classifyTrackerRefresh: terminal → terminate+cleanup", () => {
  const r = classifyTrackerRefresh(issue("Done"), { active: ["Todo"], terminal: ["Done"] });
  expect(r).toEqual({ kind: "terminate_with_cleanup" });
});

test("classifyTrackerRefresh: non-active non-terminal → terminate without cleanup", () => {
  const r = classifyTrackerRefresh(issue("Pending"), { active: ["Todo"], terminal: ["Done"] });
  expect(r).toEqual({ kind: "terminate_no_cleanup" });
});

test("classifyTrackerRefresh: active → update snapshot", () => {
  const r = classifyTrackerRefresh(issue("Todo"), { active: ["Todo"], terminal: ["Done"] });
  expect(r).toEqual({ kind: "update_snapshot" });
});
