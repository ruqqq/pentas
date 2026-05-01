# Ready Human Review Conflict Watch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend dalang's GitHub Projects PR reconciliation so conflicted PRs in `Ready for Human Review` receive a control-plane comment and move back to `Ready for Dev`.

**Architecture:** Reuse the existing `controlPlane.reconcilePrChecks(...)` tick path. Keep conflict-specific behavior inside the GitHub control-plane PR reconciliation code, add schema defaults for the two states, and keep the orchestrator generic.

**Tech Stack:** Bun + TypeScript, GitHub Projects v2 adapter, GitHub GraphQL/REST APIs, `bun test`, `bun run typecheck`, `bun run lint`.

**Spec:** `docs/superpowers/specs/2026-05-01-ready-human-review-conflict-watch-design.md`.

---

## File Structure

**Modified:**

- `packages/dalang/src/config/schema.ts` - add `conflict_watch_state` and `conflict_target_state` defaults to GitHub Projects `pr_checks`.
- `packages/dalang/src/control-plane/adapter.ts` - carry the optional conflict-watch config through `PrChecksReconcileArgs`.
- `packages/dalang/src/orchestrator/orchestrator.ts` - pass the two new GitHub Projects config fields into the reconciler config object and fetch both the PR-check wait state and conflict-watch state before reconciliation.
- `packages/dalang/src/control-plane/github/pr-checks.ts` - add conflict detection, comment formatting, dedupe, and target-state move behavior.
- `packages/dalang/src/control-plane/github/adapter.ts` - fetch PR mergeability and include human-review items in reconciliation input.
- `packages/dalang/tests/config/schema.test.ts` - cover defaults and configured state names.
- `packages/dalang/tests/control-plane/github/pr-checks.test.ts` - cover pure conflict-watch behavior.
- `packages/dalang/tests/control-plane/github/adapter.test.ts` - cover adapter API calls and state validation.
- `packages/dalang/tests/orchestrator/orchestrator.test.ts` - assert configured conflict states are delegated to the adapter.

---

## Task 1: Add Config Fields

**Files:**

- Modify: `packages/dalang/src/config/schema.ts`
- Test: `packages/dalang/tests/config/schema.test.ts`

- [ ] **Step 1: Write failing schema tests**

Add tests near the existing GitHub Projects `pr_checks` schema coverage:

```ts
test("defaults github-projects conflict watch states", () => {
  const parsed = WorkflowFrontMatterSchema.parse({
    control_plane: {
      kind: "github-projects",
      owner_type: "user",
      owner: "ruqqq",
      project_number: 1,
      repository: "ruqqq/pentas",
      status_field: "Status",
      active_states: ["Ready for Dev"],
      terminal_states: ["Done"],
      ownership: { mode: "project_field", field: "Agent", value: "dalang" },
      pr_checks: {
        enabled: true,
        wait_state: "Waiting PR Checks",
        pass_state: "Ready for Human Review",
        fail_state: "In Dev",
        escalation_state: "Ready for Human Review",
      },
    },
  });
  if (parsed.control_plane.kind !== "github-projects") throw new Error("expected github-projects");
  expect(parsed.control_plane.pr_checks?.conflict_watch_state).toBe("Ready for Human Review");
  expect(parsed.control_plane.pr_checks?.conflict_target_state).toBe("Ready for Dev");
});

test("accepts configured github-projects conflict watch states", () => {
  const parsed = WorkflowFrontMatterSchema.parse({
    control_plane: {
      kind: "github-projects",
      owner_type: "user",
      owner: "ruqqq",
      project_number: 1,
      repository: "ruqqq/pentas",
      status_field: "Status",
      active_states: ["Ready for Dev"],
      terminal_states: ["Done"],
      ownership: { mode: "project_field", field: "Agent", value: "dalang" },
      pr_checks: {
        enabled: true,
        wait_state: "Waiting PR Checks",
        pass_state: "Ready for Human Review",
        fail_state: "In Dev",
        escalation_state: "Ready for Human Review",
        conflict_watch_state: "Human Review",
        conflict_target_state: "Needs Conflict Fix",
      },
    },
  });
  if (parsed.control_plane.kind !== "github-projects") throw new Error("expected github-projects");
  expect(parsed.control_plane.pr_checks?.conflict_watch_state).toBe("Human Review");
  expect(parsed.control_plane.pr_checks?.conflict_target_state).toBe("Needs Conflict Fix");
});
```

- [ ] **Step 2: Run the failing tests**

Run: `bun test packages/dalang/tests/config/schema.test.ts`

Expected: FAIL because the new fields are not present.

- [ ] **Step 3: Add schema defaults**

Extend `GithubPrChecksSchema`:

```ts
conflict_watch_state: z.string().min(1).default("Ready for Human Review"),
conflict_target_state: z.string().min(1).default("Ready for Dev"),
```

Do not add these fields to the top-level Papan `PrChecksSchema` unless TypeScript requires the shared argument type to accept them as optional.

- [ ] **Step 4: Run the schema tests**

Run: `bun test packages/dalang/tests/config/schema.test.ts`

Expected: PASS.

---

## Task 2: Thread Config Through Orchestrator Types

**Files:**

- Modify: `packages/dalang/src/control-plane/adapter.ts`
- Modify: `packages/dalang/src/orchestrator/orchestrator.ts`
- Test: `packages/dalang/tests/orchestrator/orchestrator.test.ts`

- [ ] **Step 1: Write failing delegation test**

Extend the existing `github control_plane pr_checks config drives delegation` test to assert:

```ts
expect(controlPlane.reconcileArgs?.config.conflict_watch_state).toBe("Ready for Human Review");
expect(controlPlane.reconcileArgs?.config.conflict_target_state).toBe("Ready for Dev");
```

Also assert the orchestrator asks the control plane for both eligible reconciliation states:

```ts
expect(controlPlane.fetchArgs?.activeStates).toEqual([
  "Waiting PR Checks",
  "Ready for Human Review",
]);
```

- [ ] **Step 2: Run the failing orchestrator test**

Run: `bun test packages/dalang/tests/orchestrator/orchestrator.test.ts`

Expected: FAIL because the delegated config omits the new fields and the reconciler fetch only includes `Waiting PR Checks`.

- [ ] **Step 3: Add optional reconcile config fields and fetch both states**

In `PrChecksReconcileArgs.config`, add:

```ts
conflict_watch_state?: string | undefined;
conflict_target_state?: string | undefined;
```

In `Orchestrator.prChecksConfig()`, include both fields when `cfg.control_plane.kind === "github-projects"`.

In `Orchestrator.tick()`, build the reconciliation fetch states from `wait_state` plus `conflict_watch_state` when present, deduping by case-insensitive state name:

```ts
const waitState = prChecksConfig.wait_state ?? "Waiting PR Checks";
const states = [waitState];
if (prChecksConfig.conflict_watch_state) states.push(prChecksConfig.conflict_watch_state);
```

Pass the deduped list to `fetchDispatchableWork({ activeStates: states, ... })`. Keep Papan behavior unchanged by only adding a conflict-watch state when the config supplies one.

- [ ] **Step 4: Run the orchestrator test**

Run: `bun test packages/dalang/tests/orchestrator/orchestrator.test.ts`

Expected: PASS.

---

## Task 3: Add Pure Conflict-Watch Logic

**Files:**

- Modify: `packages/dalang/src/control-plane/github/pr-checks.ts`
- Test: `packages/dalang/tests/control-plane/github/pr-checks.test.ts`

- [ ] **Step 1: Write failing conflict tests**

Add tests that exercise `reconcileGithubPrChecks` with a work item in `Ready for Human Review`:

```ts
test("conflicted human-review PR comments and moves back to Ready for Dev", async () => {
  const comments: ControlPlaneComment[] = [];
  const states: string[] = [];
  await reconcileGithubPrChecks({
    work: [work("Ready for Human Review")],
    polls: new Map(),
    config: { ...config, conflict_watch_state: "Ready for Human Review", conflict_target_state: "Ready for Dev" },
    now: () => new Date("2026-05-01T00:00:00Z"),
    listComments: async () => comments,
    addComment: async (_id, body) => comments.push({ id: "1", author: "agent", body, created_at: "2026-05-01T00:00:00Z" }),
    updateState: async (_id, state) => states.push(state),
    resolvePullRequest: async () => ({ number: 42, url: "https://github.com/acme/app/pull/42", sha: "abc1234" }),
    fetchChecks: async () => [],
    fetchMergeability: async () => "conflicted",
    rerunFailedChecks: async () => 0,
    markReady: async () => {},
  });
  expect(comments[0]!.body).toContain("[pr_conflicts_detected] sha=abc1234");
  expect(comments[0]!.body).toContain("PR #42");
  expect(states).toEqual(["Ready for Dev"]);
});
```

Also add tests for clean, unknown, no PR, and existing `[pr_conflicts_detected] sha=abc1234` comments. The existing-comment test must assert that no duplicate comment is added but `updateState(..., "Ready for Dev")` is still called, so a previous partial failure can recover.

- [ ] **Step 2: Run the failing tests**

Run: `bun test packages/dalang/tests/control-plane/github/pr-checks.test.ts`

Expected: FAIL because `fetchMergeability` and conflict behavior do not exist.

- [ ] **Step 3: Implement conflict helpers**

Add a mergeability type and comment formatter:

```ts
export type Mergeability = "conflicted" | "clean" | "unknown";

export function formatConflictComment(args: { sha: string; prNumber: number; targetState: string }): string {
  return [
    `[AGENT MESSAGE]`,
    ``,
    `[pr_conflicts_detected] sha=${shortSha(args.sha)}`,
    `PR #${args.prNumber} is currently conflicted with the base branch. Moving this item back to ${args.targetState} so the conflict can be resolved.`,
  ].join("\n");
}
```

Add a dedupe helper that scans comments for `[pr_conflicts_detected] sha=<short-sha>`.

- [ ] **Step 4: Extend `GithubPrChecksArgs`**

Add:

```ts
fetchMergeability: (pr: GithubPullRequestRef) => Promise<Mergeability>;
```

- [ ] **Step 5: Add the human-review branch in `reconcileGithubPrChecks`**

Before the existing wait-state checks path, handle items whose state matches `config.conflict_watch_state ?? "Ready for Human Review"`:

```ts
if (item.state.toLowerCase() === conflictWatchState.toLowerCase()) {
  const pr = await args.resolvePullRequest(item);
  if (!pr) continue;
  const mergeability = await args.fetchMergeability(pr);
  if (mergeability !== "conflicted") continue;
  const comments = await args.listComments(item.id);
  if (!hasConflictCommentForSha(comments, pr.sha)) {
    await args.addComment(item.id, formatConflictComment({
      sha: pr.sha,
      prNumber: pr.number,
      targetState: conflictTargetState,
    }));
  }
  await args.updateState(item.id, conflictTargetState);
  continue;
}
```

Preserve existing `Waiting PR Checks` behavior exactly.

- [ ] **Step 6: Run the GitHub PR-check tests**

Run: `bun test packages/dalang/tests/control-plane/github/pr-checks.test.ts`

Expected: PASS.

---

## Task 4: Fetch Mergeability In GitHub Adapter

**Files:**

- Modify: `packages/dalang/src/control-plane/github/adapter.ts`
- Test: `packages/dalang/tests/control-plane/github/adapter.test.ts`

- [ ] **Step 1: Write failing adapter tests**

Add tests for:

- `validateConnection` fails if `conflict_watch_state` or `conflict_target_state` is not a project status option.
- `reconcilePrChecks` calls a PR mergeability query for human-review items.
- GraphQL `CONFLICTING` maps to `conflicted`; `MERGEABLE` maps to `clean`; `UNKNOWN` maps to `unknown`.
- REST fallback `mergeable_state: "dirty"` maps to `conflicted` when a PR node ID is absent.

- [ ] **Step 2: Run the failing adapter tests**

Run: `bun test packages/dalang/tests/control-plane/github/adapter.test.ts`

Expected: FAIL because mergeability is not fetched or delegated.

- [ ] **Step 3: Add conflict states to validation**

When `this.cfg.prChecks?.enabled`, include:

```ts
this.cfg.prChecks.conflict_watch_state,
this.cfg.prChecks.conflict_target_state,
```

in `requiredStates`.

- [ ] **Step 4: Add GraphQL mergeability query**

Add:

```ts
const PR_MERGEABILITY_QUERY = `
  query PullRequestMergeability($pullRequestId: ID!) {
    node(id: $pullRequestId) {
      ... on PullRequest {
        mergeable
      }
    }
  }
`;
```

Implement:

```ts
private async fetchMergeability(pr: GithubPullRequestRef): Promise<Mergeability> {
  if (pr.nodeId) {
    const data = await this.client.graphql<{ node?: { mergeable?: string } }>(PR_MERGEABILITY_QUERY, {
      pullRequestId: pr.nodeId,
    });
    return graphQlMergeability(data.node?.mergeable);
  }
  const [owner, repo] = this.repoParts();
  const data = await this.client.restJson<{ mergeable_state?: string | null }>(
    `/repos/${owner}/${repo}/pulls/${pr.number}`,
    "GET",
  );
  return restMergeability(data.mergeable_state);
}
```

Mapping helpers should return only `"conflicted"`, `"clean"`, or `"unknown"`.

- [ ] **Step 5: Delegate `fetchMergeability`**

In `reconcilePrChecks`, pass:

```ts
fetchMergeability: (pr) => this.fetchMergeability(pr),
```

- [ ] **Step 6: Run adapter tests**

Run: `bun test packages/dalang/tests/control-plane/github/adapter.test.ts`

Expected: PASS.

---

## Task 5: Verification

**Files:**

- Verify all changed files.

- [ ] **Step 1: Run focused tests**

Run:

```bash
bun test packages/dalang/tests/config/schema.test.ts \
  packages/dalang/tests/orchestrator/orchestrator.test.ts \
  packages/dalang/tests/control-plane/github/pr-checks.test.ts \
  packages/dalang/tests/control-plane/github/adapter.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run repo verification**

Run:

```bash
bun run typecheck
bun run lint
bun test
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/dalang/src/config/schema.ts \
  packages/dalang/src/control-plane/adapter.ts \
  packages/dalang/src/orchestrator/orchestrator.ts \
  packages/dalang/src/control-plane/github/pr-checks.ts \
  packages/dalang/src/control-plane/github/adapter.ts \
  packages/dalang/tests/config/schema.test.ts \
  packages/dalang/tests/orchestrator/orchestrator.test.ts \
  packages/dalang/tests/control-plane/github/pr-checks.test.ts \
  packages/dalang/tests/control-plane/github/adapter.test.ts
git commit -m "feat(dalang): watch human-review PRs for conflicts"
```

---

## Open Questions

- Should conflict watching eventually apply to Papan as well, or is GitHub Projects the only supported control plane for this behavior?
- Should `behind` PRs be treated as conflicts in a later issue, or remain human-review eligible unless GitHub reports a true conflict?
