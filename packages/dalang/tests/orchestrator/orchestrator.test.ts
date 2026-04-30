// packages/dalang/tests/orchestrator/orchestrator.test.ts
import { test, expect } from "bun:test";
import { Orchestrator } from "../../src/orchestrator/orchestrator";
import type { ControlPlaneAdapter, DispatchQuery, PrChecksReconcileArgs } from "../../src/control-plane/adapter";
import type { NormalizedIssue, ControlPlaneComment, ControlPlaneHistoryEntry } from "../../src/types";
import { applyDefaults } from "../../src/config/schema";
import { ValidationError } from "../../src/config/validate";
import { mkdtemp, writeFile, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const issue = (id: string, state = "Todo"): NormalizedIssue => ({
  id, identifier: `X-${id}`, title: "t", description: null, priority: 1,
  state, branch_name: null, url: null, external_ref: null, internal_ref: null, labels: [], blocked_by: [],
  created_at: "2026-01-01", updated_at: null,
});

class FakeControlPlane implements ControlPlaneAdapter {
  candidates: NormalizedIssue[] = [];
  byIds: Record<string, NormalizedIssue> = {};
  readonly capabilities: ControlPlaneAdapter["capabilities"] = { history: true, prChecks: true };
  async fetchDispatchableWork(_query: DispatchQuery): Promise<NormalizedIssue[]> { return this.candidates; }
  async fetchWorkByStates(_states: string[]): Promise<NormalizedIssue[]> { return []; }
  async refreshWork(ids: string[]): Promise<NormalizedIssue[]> {
    return ids.map((id) => this.byIds[id]).filter((x): x is NormalizedIssue => Boolean(x));
  }
  async fetchWorkItem(id: string): Promise<NormalizedIssue | null> { return this.byIds[id] ?? null; }
  async listComments(_issueId: string): Promise<ControlPlaneComment[]> { return []; }
  async listHistory(_issueId: string): Promise<ControlPlaneHistoryEntry[]> { return []; }
  async addComment(_issueId: string, _body: string, _author?: "user" | "agent"): Promise<void> { /* noop */ }
  async updateState(_issueId: string, _state: string): Promise<void> { /* noop */ }
  async reconcilePrChecks(_args: PrChecksReconcileArgs): Promise<void> { /* noop */ }
}

async function tmpRoot(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "dalang-orch-"));
}

test("tick dispatches eligible issue and runs an attempt to completion", async () => {
  const root = await tmpRoot();
  const tracker = new FakeControlPlane();
  tracker.candidates = [issue("i1")];
  tracker.byIds["i1"] = issue("i1");

  const cfg = applyDefaults({
    tracker: { endpoint: "http://localhost:1234", active_states: ["Todo"], terminal_states: ["Done"] },
    workspace: { root },
    agent: { max_concurrent_agents: 1, max_turns: 1 },
    polling: { interval_ms: 1000 },
  });

  const orch = new Orchestrator({
    controlPlane: tracker,
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
  const tracker = new FakeControlPlane();
  tracker.candidates = [issue("i1")];
  tracker.byIds["i1"] = issue("i1");

  const cfg = applyDefaults({
    tracker: { endpoint: "http://localhost:1", active_states: ["Todo"], terminal_states: ["Done"] },
    workspace: { root },
    agent: { max_concurrent_agents: 1, max_turns: 1 },
    polling: { interval_ms: 1000 },
  });

  const orch = new Orchestrator({
    controlPlane: tracker, config: cfg, promptTemplate: "x",
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
  const tracker = new FakeControlPlane();
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
    controlPlane: tracker, config: cfg, promptTemplate: "x",
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

  class WriteRecordingTracker extends FakeControlPlane {
    comments: { id: string; body: string }[] = [];
    states: Record<string, string> = { i1: "Waiting PR Checks" };
    reconcileArgs: PrChecksReconcileArgs | null = null;
    queries: DispatchQuery[] = [];
    override async fetchDispatchableWork(query: DispatchQuery): Promise<NormalizedIssue[]> {
      this.queries.push(query);
      return query.activeStates.includes("Waiting PR Checks") ? [waiting] : [];
    }
    override async listComments(_id: string): Promise<ControlPlaneComment[]> { return []; }
    override async addComment(id: string, body: string): Promise<void> {
      this.comments.push({ id, body });
    }
    override async updateState(id: string, s: string): Promise<void> {
      this.states[id] = s;
    }
    override async reconcilePrChecks(args: PrChecksReconcileArgs): Promise<void> {
      this.reconcileArgs = args;
      await this.addComment("i1", "[pr_checks_failed] sha=abc1234");
      await this.updateState("i1", "In Dev");
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
    controlPlane: tracker, config: cfg, promptTemplate: "x",
    runQuery: async function* () {
      yield { type: "system", subtype: "init", session_id: "s" };
      yield { type: "result", subtype: "success", usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } };
    },
  });

  await orch.tick();
  expect(tracker.queries[0]).toEqual({
    activeStates: ["Waiting PR Checks"],
    ownership: { mode: "none" },
  });
  expect(tracker.reconcileArgs?.work).toEqual([waiting]);
  expect(tracker.reconcileArgs?.polls).toBe(orch.state.pr_checks_polls);
  expect(tracker.reconcileArgs?.config).toMatchObject({
    enabled: true,
    poll_interval_ms: 1,
    failure_budget: 3,
    rerun_flakes: false,
    gh_executable: stub,
  });
  expect(typeof tracker.reconcileArgs?.repoCwd).toBe("string");
  expect(tracker.reconcileArgs?.now()).toBeInstanceOf(Date);
  expect(tracker.states.i1).toBe("In Dev");
  expect(tracker.comments).toHaveLength(1);
  expect(tracker.comments[0]!.body).toContain("[pr_checks_failed] sha=abc1234");
});

test("constructor rejects enabled pr_checks when control plane lacks capability", async () => {
  const root = await tmpRoot();
  class NoPrChecksControlPlane extends FakeControlPlane {
    override readonly capabilities = { history: true } as const;
  }
  const cfg = applyDefaults({
    tracker: { endpoint: "http://localhost:1", active_states: ["Todo"], terminal_states: ["Done"] },
    workspace: { root },
    pr_checks: {
      enabled: true,
      poll_interval_ms: 1,
      failure_budget: 3,
      rerun_flakes: false,
      gh_executable: "gh",
    },
  });

  expect(() => new Orchestrator({
    controlPlane: new NoPrChecksControlPlane(),
    config: cfg,
    promptTemplate: "x",
    runQuery: async function* () {},
  })).toThrow(ValidationError);
});

test("github control_plane pr_checks config drives delegation", async () => {
  const root = await tmpRoot();
  const waiting = issue("waiting", "Reviewing CI");
  class GithubControlPlane extends FakeControlPlane {
    seenQueries: DispatchQuery[] = [];
    seenConfig: PrChecksReconcileArgs["config"] | null = null;
    override async fetchDispatchableWork(query: DispatchQuery): Promise<NormalizedIssue[]> {
      this.seenQueries.push(query);
      return query.activeStates.includes("Reviewing CI") ? [waiting] : [];
    }
    override async reconcilePrChecks(args: PrChecksReconcileArgs): Promise<void> {
      this.seenConfig = args.config;
    }
  }
  const controlPlane = new GithubControlPlane();
  const cfg = applyDefaults({
    control_plane: {
      kind: "github-projects",
      owner_type: "organization",
      owner: "acme",
      project_number: 1,
      repository: "acme/app",
      token: "token-1",
      status_field: "Status",
      active_states: ["Todo"],
      terminal_states: ["Done"],
      ownership: { mode: "label", value: "dalang" },
      pr_checks: {
        enabled: true,
        poll_interval_ms: 7,
        failure_budget: 5,
        rerun_flakes: true,
        wait_state: "Reviewing CI",
        pass_state: "Ready",
        fail_state: "Fixing",
        escalation_state: "Escalate",
      },
    },
    workspace: { root },
    pr_checks: { enabled: false },
  });

  const orch = new Orchestrator({
    controlPlane,
    config: cfg,
    promptTemplate: "x",
    runQuery: async function* () {},
  });
  await orch.tick();

  expect(controlPlane.seenQueries[0]).toEqual({
    activeStates: ["Reviewing CI"],
    ownership: { mode: "label", value: "dalang" },
  });
  expect(controlPlane.seenConfig).toMatchObject({
    enabled: true,
    poll_interval_ms: 7,
    failure_budget: 5,
    rerun_flakes: true,
    wait_state: "Reviewing CI",
    pass_state: "Ready",
    fail_state: "Fixing",
    escalation_state: "Escalate",
  });
});

test("tick skips pr_checks reconciler when disabled", async () => {
  const root = await tmpRoot();
  const stub = await ghStub(`exit 99`);
  class T extends FakeControlPlane {
    prChecksCalled = false;
    override async reconcilePrChecks(_args: PrChecksReconcileArgs): Promise<void> {
      this.prChecksCalled = true;
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
    controlPlane: tracker, config: cfg, promptTemplate: "x",
    runQuery: async function* () {
      yield { type: "system", subtype: "init", session_id: "s" };
      yield { type: "result", subtype: "success", usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } };
    },
  });
  await orch.tick();
  expect(tracker.prChecksCalled).toBe(false);
});
