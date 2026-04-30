import { expect, test } from "bun:test";
import { reconcileGithubPrChecks } from "../../../src/control-plane/github/pr-checks";
import type { ControlPlaneComment, WorkItem } from "../../../src/types";

function work(state = "Waiting PR Checks"): WorkItem {
  return {
    id: "PVTI_1",
    identifier: "acme/app#12",
    title: "Fix",
    description: null,
    priority: null,
    state,
    branch_name: "dalang/12-fix",
    url: "https://github.com/acme/app/issues/12",
    external_ref: "ISSUE_1",
    internal_ref: "acme/app#12",
    labels: [],
    blocked_by: [],
    created_at: null,
    updated_at: null,
  };
}

const config = {
  enabled: true,
  poll_interval_ms: 60000,
  failure_budget: 3,
  rerun_flakes: true,
  wait_state: "Waiting PR Checks",
  pass_state: "Ready for Human Review",
  fail_state: "In Dev",
  escalation_state: "Ready for Human Review",
};

test("passed checks comment and move to pass state", async () => {
  const comments: ControlPlaneComment[] = [];
  const states: string[] = [];
  let ready = false;

  await reconcileGithubPrChecks({
    work: [work()],
    polls: new Map(),
    config,
    now: () => new Date("2026-04-30T00:00:00Z"),
    listComments: async () => comments,
    addComment: async (_id, body) => {
      comments.push({ id: String(comments.length + 1), author: "agent", body, created_at: new Date().toISOString() });
    },
    updateState: async (_id, state) => { states.push(state); },
    resolvePullRequest: async () => ({ number: 9, url: "https://github.com/acme/app/pull/9", sha: "abc123" }),
    fetchChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", link: "https://ci/build" }],
    rerunFailedChecks: async () => 0,
    markReady: async () => { ready = true; },
  });

  expect(comments[0]!.body).toContain("[pr_checks_passed] sha=abc123");
  expect(states).toEqual(["Ready for Human Review"]);
  expect(ready).toBe(true);
});

test("passed checks still move state when markReady fails", async () => {
  const comments: ControlPlaneComment[] = [];
  const states: string[] = [];

  await reconcileGithubPrChecks({
    work: [work()],
    polls: new Map(),
    config,
    now: () => new Date("2026-04-30T00:00:00Z"),
    listComments: async () => comments,
    addComment: async (_id, body) => {
      comments.push({ id: String(comments.length + 1), author: "agent", body, created_at: new Date().toISOString() });
    },
    updateState: async (_id, state) => { states.push(state); },
    resolvePullRequest: async () => ({ number: 9, url: "https://github.com/acme/app/pull/9", sha: "abc123" }),
    fetchChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", link: "https://ci/build" }],
    rerunFailedChecks: async () => 0,
    markReady: async () => { throw new Error("already ready"); },
  });

  expect(states).toEqual(["Ready for Human Review"]);
  expect(comments[0]!.body).toContain("[pr_checks_passed] sha=abc123");
});

test("failed checks bounce until failure budget then escalate", async () => {
  const comments: ControlPlaneComment[] = [
    { id: "1", author: "agent", body: "[pr_checks_failed] sha=oldsha1 attempt=1/2", created_at: "2026-04-30T00:00:00Z" },
  ];
  const states: string[] = [];

  await reconcileGithubPrChecks({
    work: [work()],
    polls: new Map(),
    config: { ...config, failure_budget: 2, rerun_flakes: false },
    now: () => new Date("2026-04-30T00:00:00Z"),
    listComments: async () => comments,
    addComment: async (_id, body) => {
      comments.push({ id: String(comments.length + 1), author: "agent", body, created_at: new Date().toISOString() });
    },
    updateState: async (_id, state) => { states.push(state); },
    resolvePullRequest: async () => ({ number: 9, url: "https://github.com/acme/app/pull/9", sha: "abc123" }),
    fetchChecks: async () => [{ name: "build", state: "FAILURE", bucket: "fail", link: "https://ci/build" }],
    rerunFailedChecks: async () => 0,
    markReady: async () => {},
  });

  expect(comments.at(-1)!.body).toContain("[pr_checks_escalated] sha=abc123 attempt=2/2");
  expect(states).toEqual(["Ready for Human Review"]);
});

test("state-changing failures do not post marker before state mutation succeeds", async () => {
  const comments: ControlPlaneComment[] = [];

  await reconcileGithubPrChecks({
    work: [work()],
    polls: new Map(),
    config: { ...config, rerun_flakes: false },
    now: () => new Date("2026-04-30T00:00:00Z"),
    listComments: async () => comments,
    addComment: async (_id, body) => {
      comments.push({ id: String(comments.length + 1), author: "agent", body, created_at: new Date().toISOString() });
    },
    updateState: async () => { throw new Error("project write failed"); },
    resolvePullRequest: async () => ({ number: 9, url: "https://github.com/acme/app/pull/9", sha: "abc123" }),
    fetchChecks: async () => [{ name: "build", state: "FAILURE", bucket: "fail", link: "https://ci/build" }],
    rerunFailedChecks: async () => 0,
    markReady: async () => {},
  });

  expect(comments).toEqual([]);
});

test("rerun flakes posts rerun marker without moving state", async () => {
  const comments: ControlPlaneComment[] = [];
  const states: string[] = [];
  let rerunCount = 0;

  await reconcileGithubPrChecks({
    work: [work()],
    polls: new Map(),
    config,
    now: () => new Date("2026-04-30T00:00:00Z"),
    listComments: async () => comments,
    addComment: async (_id, body) => {
      comments.push({ id: String(comments.length + 1), author: "agent", body, created_at: new Date().toISOString() });
    },
    updateState: async (_id, state) => { states.push(state); },
    resolvePullRequest: async () => ({ number: 9, url: "https://github.com/acme/app/pull/9", sha: "abc123" }),
    fetchChecks: async () => [{ name: "build", state: "FAILURE", bucket: "fail", link: "https://ci/build", runId: 123 }],
    rerunFailedChecks: async (_pr, checks) => {
      rerunCount = checks.length;
      return checks.length;
    },
    markReady: async () => {},
  });

  expect(comments[0]!.body).toContain("[pr_checks_rerun] sha=abc123");
  expect(comments[0]!.body).toContain("Re-triggered 1 failed check");
  expect(rerunCount).toBe(1);
  expect(states).toEqual([]);
});

test("poll interval throttles repeated checks", async () => {
  const polls = new Map();
  polls.set("PVTI_1", {
    last_polled_at: "2026-04-30T00:00:00Z",
    last_seen_sha: "abc123",
    last_action: "pending",
  });
  let resolved = false;

  await reconcileGithubPrChecks({
    work: [work()],
    polls,
    config,
    now: () => new Date("2026-04-30T00:00:30Z"),
    listComments: async () => [],
    addComment: async () => {},
    updateState: async () => {},
    resolvePullRequest: async () => {
      resolved = true;
      return { number: 9, url: "https://github.com/acme/app/pull/9", sha: "abc123" };
    },
    fetchChecks: async () => [],
    rerunFailedChecks: async () => 0,
    markReady: async () => {},
  });

  expect(resolved).toBe(false);
});

test("wait state comparison is case-insensitive", async () => {
  const states: string[] = [];

  await reconcileGithubPrChecks({
    work: [work("waiting pr checks")],
    polls: new Map(),
    config,
    now: () => new Date("2026-04-30T00:00:00Z"),
    listComments: async () => [],
    addComment: async () => {},
    updateState: async (_id, state) => { states.push(state); },
    resolvePullRequest: async () => ({ number: 9, url: "https://github.com/acme/app/pull/9", sha: "abc123" }),
    fetchChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", link: "https://ci/build" }],
    rerunFailedChecks: async () => 0,
    markReady: async () => {},
  });

  expect(states).toEqual(["Ready for Human Review"]);
});

test("poll errors still record a throttle entry", async () => {
  const polls = new Map();

  await reconcileGithubPrChecks({
    work: [work()],
    polls,
    config,
    now: () => new Date("2026-04-30T00:00:00Z"),
    listComments: async () => [],
    addComment: async () => {},
    updateState: async () => {},
    resolvePullRequest: async () => {
      throw new Error("boom");
    },
    fetchChecks: async () => [],
    rerunFailedChecks: async () => 0,
    markReady: async () => {},
  });

  expect(polls.get("PVTI_1")).toEqual({
    last_polled_at: "2026-04-30T00:00:00.000Z",
    last_seen_sha: null,
    last_action: null,
  });
});
