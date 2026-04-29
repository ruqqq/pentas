// packages/dalang/tests/orchestrator/orchestrator.test.ts
import { test, expect } from "bun:test";
import { Orchestrator } from "../../src/orchestrator/orchestrator";
import type { TrackerAdapter } from "../../src/tracker/adapter";
import type { NormalizedIssue } from "../../src/types";
import { applyDefaults } from "../../src/config/schema";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const issue = (id: string, state = "Todo"): NormalizedIssue => ({
  id, identifier: `X-${id}`, title: "t", description: null, priority: 1,
  state, branch_name: null, url: null, labels: [], blocked_by: [],
  created_at: "2026-01-01", updated_at: null,
});

class FakeTracker implements TrackerAdapter {
  candidates: NormalizedIssue[] = [];
  byIds: Record<string, NormalizedIssue> = {};
  async fetchCandidateIssues(): Promise<NormalizedIssue[]> { return this.candidates; }
  async fetchIssuesByStates(): Promise<NormalizedIssue[]> { return []; }
  async fetchIssueStatesByIds(ids: string[]): Promise<NormalizedIssue[]> {
    return ids.map((id) => this.byIds[id]).filter((x): x is NormalizedIssue => Boolean(x));
  }
  async fetchIssue(id: string): Promise<NormalizedIssue | null> { return this.byIds[id] ?? null; }
}

async function tmpRoot(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "dalang-orch-"));
}

test("tick dispatches eligible issue and runs an attempt to completion", async () => {
  const root = await tmpRoot();
  const tracker = new FakeTracker();
  tracker.candidates = [issue("i1")];
  tracker.byIds["i1"] = issue("i1");

  const cfg = applyDefaults({
    tracker: { endpoint: "http://localhost:1234", active_states: ["Todo"], terminal_states: ["Done"] },
    workspace: { root },
    agent: { max_concurrent_agents: 1, max_turns: 1 },
    polling: { interval_ms: 1000 },
  });

  const orch = new Orchestrator({
    tracker,
    config: cfg,
    promptTemplate: "Body for {{ issue.identifier }}",
    runQuery: async function* () {
      yield { type: "system", subtype: "init", session_id: "sess-1" };
      yield { type: "result", subtype: "success", usage: { input_tokens: 5, output_tokens: 5, total_tokens: 10 } };
    },
  });

  await orch.tick();
  // Allow the dispatched async worker to complete
  await orch.drainPendingForTest();

  expect(orch.state.claude_totals.total_tokens).toBe(10);
  expect(orch.state.completed.has("i1")).toBe(true);
});

test("tick respects max_concurrent_agents and queues the rest", async () => {
  const root = await tmpRoot();
  const tracker = new FakeTracker();
  tracker.candidates = [issue("i1"), issue("i2")];
  tracker.byIds["i1"] = issue("i1");
  tracker.byIds["i2"] = issue("i2");

  const cfg = applyDefaults({
    tracker: { endpoint: "http://localhost:1", active_states: ["Todo"], terminal_states: ["Done"] },
    workspace: { root },
    agent: { max_concurrent_agents: 1, max_turns: 1 },
    polling: { interval_ms: 1000 },
  });

  let dispatched = 0;
  const orch = new Orchestrator({
    tracker, config: cfg, promptTemplate: "x",
    runQuery: async function* () {
      dispatched += 1;
      yield { type: "system", subtype: "init", session_id: `s-${dispatched}` };
      yield { type: "result", subtype: "success", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
    },
  });
  await orch.tick();
  expect(orch.state.running.size + orch.state.retry_attempts.size).toBeGreaterThanOrEqual(1);
  expect(orch.state.running.size).toBeLessThanOrEqual(1);
});
