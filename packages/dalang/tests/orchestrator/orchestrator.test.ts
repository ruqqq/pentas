// packages/dalang/tests/orchestrator/orchestrator.test.ts
import { test, expect } from "bun:test";
import { Orchestrator } from "../../src/orchestrator/orchestrator";
import type { TrackerAdapter } from "../../src/tracker/adapter";
import type { NormalizedIssue, TrackerComment, TrackerHistoryEntry } from "../../src/types";
import { applyDefaults } from "../../src/config/schema";
import { mkdtemp, writeFile, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const issue = (id: string, state = "Todo"): NormalizedIssue => ({
  id, identifier: `X-${id}`, title: "t", description: null, priority: 1,
  state, branch_name: null, url: null, external_ref: null, internal_ref: null, labels: [], blocked_by: [],
  created_at: "2026-01-01", updated_at: null,
});

class FakeTracker implements TrackerAdapter {
  candidates: NormalizedIssue[] = [];
  byIds: Record<string, NormalizedIssue> = {};
  async fetchCandidateIssues(): Promise<NormalizedIssue[]> { return this.candidates; }
  async fetchIssuesByStates(_states: string[]): Promise<NormalizedIssue[]> { return []; }
  async fetchIssueStatesByIds(ids: string[]): Promise<NormalizedIssue[]> {
    return ids.map((id) => this.byIds[id]).filter((x): x is NormalizedIssue => Boolean(x));
  }
  async fetchIssue(id: string): Promise<NormalizedIssue | null> { return this.byIds[id] ?? null; }
  async listComments(_issueId: string): Promise<TrackerComment[]> { return []; }
  async listHistory(_issueId: string): Promise<TrackerHistoryEntry[]> { return []; }
  async addComment(_issueId: string, _body: string, _author?: "user" | "agent"): Promise<void> { /* noop */ }
  async updateState(_issueId: string, _state: string): Promise<void> { /* noop */ }
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

test("workspace is removed when issue disappears between completion and continuation retry", async () => {
  const root = await tmpRoot();
  const tracker = new FakeTracker();
  tracker.candidates = [issue("i1")];
  tracker.byIds["i1"] = issue("i1");

  const cfg = applyDefaults({
    tracker: { endpoint: "http://localhost:1", active_states: ["Todo"], terminal_states: ["Done"] },
    workspace: { root },
    agent: { max_concurrent_agents: 1, max_turns: 1 },
    polling: { interval_ms: 1000 },
  });

  const orch = new Orchestrator({
    tracker, config: cfg, promptTemplate: "x",
    runQuery: async function* () {
      yield { type: "system", subtype: "init", session_id: "s-1" };
      yield { type: "result", subtype: "success", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
    },
  });

  await orch.tick();
  await orch.drainPendingForTest();

  const wsPath = join(root, "X-i1");
  expect(existsSync(wsPath)).toBe(true);
  expect(orch.state.retry_attempts.has("i1")).toBe(true);

  // PR submitted → issue no longer in active candidates.
  tracker.candidates = [];

  // Wait for the continuation retry (CONTINUATION_RETRY_MS = 1000ms) to fire.
  await new Promise((r) => setTimeout(r, 1300));

  expect(existsSync(wsPath)).toBe(false);
  expect(orch.state.retry_attempts.has("i1")).toBe(false);
  expect(orch.state.claimed.has("i1")).toBe(false);
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

async function ghStub(scriptBody: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "gh-stub-"));
  const path = join(dir, "gh");
  await writeFile(path, `#!/bin/sh\n${scriptBody}\n`);
  await chmod(path, 0o755);
  return path;
}

test("tick runs pr_checks reconciler when enabled, bouncing red checks to In Dev", async () => {
  const root = await tmpRoot();
  const stub = await ghStub(`
    case "$1 $2" in
      "pr list") echo '[{"url":"https://x/pr/1","number":1,"headRefOid":"abc1234567"}]' ;;
      "pr checks") echo '[{"name":"build","state":"FAILURE","bucket":"fail","link":"https://x/run/9"}]' ;;
    esac`);

  const waiting: NormalizedIssue = {
    id: "i1", identifier: "TJ-1", title: "x", description: null, priority: null,
    state: "Waiting PR Checks", branch_name: "feat/tj-1", url: null,
    external_ref: null, internal_ref: null, labels: [], blocked_by: [],
    created_at: "2026-01-01", updated_at: null,
  };

  class WriteRecordingTracker extends FakeTracker {
    comments: { id: string; body: string }[] = [];
    states: Record<string, string> = { i1: "Waiting PR Checks" };
    override async fetchIssuesByStates(states: string[]): Promise<NormalizedIssue[]> {
      if (states.includes("Waiting PR Checks")) return [waiting];
      return [];
    }
    override async listComments(_id: string): Promise<TrackerComment[]> { return []; }
    override async addComment(id: string, body: string): Promise<void> {
      this.comments.push({ id, body });
    }
    override async updateState(id: string, s: string): Promise<void> {
      this.states[id] = s;
    }
  }

  const tracker = new WriteRecordingTracker();
  const cfg = applyDefaults({
    tracker: { endpoint: "http://localhost:1", active_states: ["Todo"], terminal_states: ["Done"] },
    workspace: { root },
    agent: { max_concurrent_agents: 1, max_turns: 1 },
    polling: { interval_ms: 1000 },
    pr_checks: {
      enabled: true,
      poll_interval_ms: 1,
      failure_budget: 3,
      rerun_flakes: false,
      gh_executable: stub,
    },
  });

  const orch = new Orchestrator({
    tracker, config: cfg, promptTemplate: "x",
    runQuery: async function* () {
      yield { type: "system", subtype: "init", session_id: "s" };
      yield { type: "result", subtype: "success", usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } };
    },
  });

  await orch.tick();
  expect(tracker.states.i1).toBe("In Dev");
  expect(tracker.comments).toHaveLength(1);
  expect(tracker.comments[0]!.body).toContain("[pr_checks_failed] sha=abc1234");
});

test("tick skips pr_checks reconciler when disabled", async () => {
  const root = await tmpRoot();
  const stub = await ghStub(`exit 99`);
  class T extends FakeTracker {
    waitingFetched = false;
    override async fetchIssuesByStates(_states: string[]): Promise<NormalizedIssue[]> {
      this.waitingFetched = true; return [];
    }
  }
  const tracker = new T();
  const cfg = applyDefaults({
    tracker: { endpoint: "http://localhost:1", active_states: ["Todo"], terminal_states: ["Done"] },
    workspace: { root },
    agent: { max_concurrent_agents: 1, max_turns: 1 },
    polling: { interval_ms: 1000 },
    pr_checks: {
      enabled: false,
      poll_interval_ms: 1,
      failure_budget: 3,
      rerun_flakes: false,
      gh_executable: stub,
    },
  });

  const orch = new Orchestrator({
    tracker, config: cfg, promptTemplate: "x",
    runQuery: async function* () {
      yield { type: "system", subtype: "init", session_id: "s" };
      yield { type: "result", subtype: "success", usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } };
    },
  });
  await orch.tick();
  expect(tracker.waitingFetched).toBe(false);
});
