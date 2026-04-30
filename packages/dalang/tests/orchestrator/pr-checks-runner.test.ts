// packages/dalang/tests/orchestrator/pr-checks-runner.test.ts
import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPrChecksReconciler } from "../../src/orchestrator/pr-checks-runner";
import type { TrackerAdapter } from "../../src/tracker/adapter";
import type { NormalizedIssue, TrackerComment } from "../../src/types";
import { createInitialState } from "../../src/orchestrator/state";

async function ghStub(scriptBody: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "gh-"));
  const path = join(dir, "gh");
  await writeFile(path, `#!/bin/sh\n${scriptBody}\n`);
  await chmod(path, 0o755);
  return path;
}

function fakeTracker(state: { comments: TrackerComment[]; states: Record<string, string> }): TrackerAdapter {
  return {
    fetchCandidateIssues: async () => [],
    fetchIssuesByStates: async () => [],
    fetchIssueStatesByIds: async () => [],
    fetchIssue: async () => null,
    listComments: async () => state.comments,
    listHistory: async () => [],
    addComment: async (_id, body) => {
      state.comments.push({
        id: String(state.comments.length + 1),
        author: "agent",
        body,
        created_at: new Date().toISOString(),
      });
    },
    updateState: async (id, s) => {
      state.states[id] = s;
    },
  };
}

const issue: NormalizedIssue = {
  id: "i1",
  identifier: "TJ-1",
  title: "x",
  description: null,
  priority: null,
  state: "Waiting PR Checks",
  branch_name: "feat/tj-1",
  url: null,
  external_ref: null,
  internal_ref: "tj-1",
  labels: [],
  blocked_by: [],
  created_at: null,
  updated_at: null,
};

describe("runPrChecksReconciler", () => {
  test("red checks (rerun_flakes=false) under budget → bounce to In Dev with [pr_checks_failed] comment, PR stays draft", async () => {
    const logDir = await mkdtemp(join(tmpdir(), "gh-log-"));
    const logPath = join(logDir, "calls.log");
    const stub = await ghStub(`
      echo "$@" >> ${logPath}
      case "$1 $2" in
        "pr list") echo '[{"url":"https://x/pr/1","number":1,"headRefOid":"abc1234567"}]' ;;
        "pr checks") echo '[{"name":"build","state":"FAILURE","bucket":"fail","link":"https://x/run/9"}]' ;;
      esac`);
    const tracker = { comments: [] as TrackerComment[], states: { i1: "Waiting PR Checks" } };
    const adapter = fakeTracker(tracker);
    const state = createInitialState({ poll_interval_ms: 1000, max_concurrent_agents: 1 });

    await runPrChecksReconciler({
      issues: [issue],
      state,
      tracker: adapter,
      cfg: { enabled: true, poll_interval_ms: 1000, failure_budget: 3, rerun_flakes: false, gh_executable: stub },
      cwd: process.cwd(),
      now: () => new Date("2026-01-01T00:00:00Z"),
    });

    expect(tracker.states.i1).toBe("In Dev");
    expect(tracker.comments).toHaveLength(1);
    expect(tracker.comments[0]!.body).toContain("[pr_checks_failed] sha=abc1234 attempt=1/3");
    expect(tracker.comments[0]!.body).toContain("- build: fail — https://x/run/9");
    const log = await Bun.file(logPath).text();
    expect(log).not.toContain("pr ready");
  });

  test("green checks → flips PR ready, then transitions to Ready for Human Review", async () => {
    const logDir = await mkdtemp(join(tmpdir(), "gh-log-"));
    const logPath = join(logDir, "calls.log");
    const stub = await ghStub(`
      echo "$@" >> ${logPath}
      case "$1 $2" in
        "pr list") echo '[{"url":"https://x/pr/1","number":1,"headRefOid":"abc1234567"}]' ;;
        "pr checks") echo '[{"name":"build","state":"SUCCESS","bucket":"pass","link":"https://x/run/9"}]' ;;
        "pr ready") echo '' ;;
      esac`);
    const tracker = { comments: [] as TrackerComment[], states: { i1: "Waiting PR Checks" } };
    const adapter = fakeTracker(tracker);
    const state = createInitialState({ poll_interval_ms: 1000, max_concurrent_agents: 1 });

    await runPrChecksReconciler({
      issues: [issue],
      state,
      tracker: adapter,
      cfg: { enabled: true, poll_interval_ms: 1000, failure_budget: 3, rerun_flakes: false, gh_executable: stub },
      cwd: process.cwd(),
      now: () => new Date("2026-01-01T00:00:00Z"),
    });

    expect(tracker.states.i1).toBe("Ready for Human Review");
    expect(tracker.comments[0]!.body).toContain("[pr_checks_passed] sha=abc1234");
    const log = await Bun.file(logPath).text();
    expect(log).toContain("pr ready 1");
  });

  test("third failure → escalate to Ready for Human Review", async () => {
    const stub = await ghStub(`
      case "$1 $2" in
        "pr list") echo '[{"url":"https://x/pr/1","number":1,"headRefOid":"def4567890"}]' ;;
        "pr checks") echo '[{"name":"build","state":"FAILURE","bucket":"fail","link":"https://x/run/9"}]' ;;
      esac`);
    const tracker = {
      comments: [
        { id: "1", author: "agent", body: "[pr_checks_failed] sha=aaa attempt=1/3", created_at: "2026-01-01T00:00:00Z" },
        { id: "2", author: "agent", body: "[pr_checks_failed] sha=bbb attempt=2/3", created_at: "2026-01-01T00:00:01Z" },
      ] as TrackerComment[],
      states: { i1: "Waiting PR Checks" },
    };

    await runPrChecksReconciler({
      issues: [issue],
      state: createInitialState({ poll_interval_ms: 1000, max_concurrent_agents: 1 }),
      tracker: fakeTracker(tracker),
      cfg: { enabled: true, poll_interval_ms: 1000, failure_budget: 3, rerun_flakes: false, gh_executable: stub },
      cwd: process.cwd(),
      now: () => new Date("2026-01-01T00:00:02Z"),
    });

    expect(tracker.states.i1).toBe("Ready for Human Review");
    expect(tracker.comments[2]!.body).toContain("[pr_checks_escalated] sha=def4567 attempt=3/3");
  });

  test("throttle: skips if last poll within poll_interval_ms", async () => {
    const stub = await ghStub(`exit 99`); // would fail if invoked
    const tracker = { comments: [] as TrackerComment[], states: { i1: "Waiting PR Checks" } };
    const state = createInitialState({ poll_interval_ms: 60000, max_concurrent_agents: 1 });
    state.pr_checks_polls.set("i1", { last_polled_at: "2026-01-01T00:00:00Z", last_seen_sha: null, last_action: "pending" });

    await runPrChecksReconciler({
      issues: [issue],
      state,
      tracker: fakeTracker(tracker),
      cfg: { enabled: true, poll_interval_ms: 60000, failure_budget: 3, rerun_flakes: false, gh_executable: stub },
      cwd: process.cwd(),
      now: () => new Date("2026-01-01T00:00:30Z"),
    });

    expect(tracker.states.i1).toBe("Waiting PR Checks"); // unchanged
    expect(tracker.comments).toHaveLength(0);
  });

  test("disabled config → no-op", async () => {
    const stub = await ghStub(`exit 99`);
    const tracker = { comments: [] as TrackerComment[], states: { i1: "Waiting PR Checks" } };

    await runPrChecksReconciler({
      issues: [issue],
      state: createInitialState({ poll_interval_ms: 1000, max_concurrent_agents: 1 }),
      tracker: fakeTracker(tracker),
      cfg: { enabled: false, poll_interval_ms: 1000, failure_budget: 3, rerun_flakes: false, gh_executable: stub },
      cwd: process.cwd(),
      now: () => new Date(),
    });

    expect(tracker.states.i1).toBe("Waiting PR Checks");
    expect(tracker.comments).toHaveLength(0);
  });

  test("no PR found → bounce to In Dev with [pr_checks_no_pr]", async () => {
    const stub = await ghStub(`
      case "$1 $2" in
        "pr list") echo '[]' ;;
      esac`);
    const tracker = { comments: [] as TrackerComment[], states: { i1: "Waiting PR Checks" } };

    await runPrChecksReconciler({
      issues: [issue],
      state: createInitialState({ poll_interval_ms: 1000, max_concurrent_agents: 1 }),
      tracker: fakeTracker(tracker),
      cfg: { enabled: true, poll_interval_ms: 1000, failure_budget: 3, rerun_flakes: false, gh_executable: stub },
      cwd: process.cwd(),
      now: () => new Date(),
    });

    expect(tracker.states.i1).toBe("In Dev");
    expect(tracker.comments[0]!.body).toContain("[pr_checks_no_pr]");
  });

  test("rerun_flakes=true and red checks → posts [pr_checks_rerun] without changing state", async () => {
    const stub = await ghStub(`
    case "$1 $2" in
      "pr list") echo '[{"url":"https://x/pr/1","number":1,"headRefOid":"abc1234567"}]' ;;
      "pr checks") echo '[{"name":"build","state":"FAILURE","bucket":"fail","link":"https://x/run/9"}]' ;;
    esac`);
    const tracker = { comments: [] as TrackerComment[], states: { i1: "Waiting PR Checks" } };
    await runPrChecksReconciler({
      issues: [issue],
      state: createInitialState({ poll_interval_ms: 1000, max_concurrent_agents: 1 }),
      tracker: fakeTracker(tracker),
      cfg: { enabled: true, poll_interval_ms: 1000, failure_budget: 3, rerun_flakes: true, gh_executable: stub },
      cwd: process.cwd(),
      now: () => new Date("2026-01-01T00:00:00Z"),
    });
    expect(tracker.states.i1).toBe("Waiting PR Checks");
    expect(tracker.comments).toHaveLength(1);
    expect(tracker.comments[0]!.body).toContain("[pr_checks_rerun] sha=abc1234");
  });

  test("subprocess failure does not throw and records null last_action", async () => {
    // gh stub that fails outright (exits 127, no stdout)
    const dir = await mkdtemp(join(tmpdir(), "gh-bad-"));
    const stub = join(dir, "gh");
    await writeFile(stub, "#!/bin/sh\nexit 127\n");
    await chmod(stub, 0o755);
    const tracker = { comments: [] as TrackerComment[], states: { i1: "Waiting PR Checks" } };
    const state = createInitialState({ poll_interval_ms: 1000, max_concurrent_agents: 1 });
    await runPrChecksReconciler({
      issues: [issue],
      state,
      tracker: fakeTracker(tracker),
      cfg: { enabled: true, poll_interval_ms: 1000, failure_budget: 3, rerun_flakes: false, gh_executable: stub },
      cwd: process.cwd(),
      now: () => new Date("2026-01-01T00:00:00Z"),
    });
    // No state change, no comment posted.
    expect(tracker.states.i1).toBe("Waiting PR Checks");
    expect(tracker.comments).toHaveLength(0);
    // But the throttle entry exists so we don't hammer.
    expect(state.pr_checks_polls.has("i1")).toBe(true);
  });
});
