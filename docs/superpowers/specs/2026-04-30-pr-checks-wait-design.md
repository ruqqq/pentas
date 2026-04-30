# PR-Checks Wait State — Design

Status: Draft v1
Date: 2026-04-30
Author: ruqqq
Supersedes: none. Extends `2026-04-29-dalang-orchestrator-design.md` and `2026-04-29-papan-tracker-design.md`.

## 1. Purpose

Add an orchestrator-driven state where dalang waits for GitHub PR checks to settle, posts results back to the control-plane work item as comments, and either escalates to a human or bounces the item back to `In Dev` for the agent to fix — all without holding an agent worker slot during the wait. Papan preserves the original `gh`-backed behavior; GitHub Projects implements the same state/comment protocol natively against GitHub issues, PRs, checks, and Project v2 status fields.

## 2. Motivation

Today the agent opens a PR, marks the ticket `Ready for Review`, and dalang transitions it to `Ready for Human Review` so a human can take over. CI failures are invisible to the orchestrator: a human has to notice the red checks, push the ticket back, and re-prompt the agent. We want this loop closed automatically, but cheaply (no agent tokens burned while polling) and with a hard stop (no infinite ping-pong on truly broken changes).

## 3. Non-Goals

- Watching arbitrary external workflows (the only signal is `gh pr checks`).
- Running the rerun-on-flake fix loop ourselves; we only re-trigger failed checks once and re-poll.
- Persisting check state across dalang restarts. Restarted dalang re-derives state from papan + GitHub on its next tick.
- Replacing the human-driven `Ready for Human Review` step. That state is still where things park for review.

## 4. State Machine Changes

### 4.1 New canonical state

Add `Waiting PR Checks` to `papan`'s `IssueState` union, between `Ready for Review` and `Ready for Human Review` in `ALL_STATES`. It is **not** in `ACTIVE_STATES` for the dispatcher (no agent should be picked up for a ticket in this state) but it **is** active from the orchestrator's perspective — dalang has work to do.

```
Todo → Plan → Review Plan → Ready for Dev → In Dev → Ready for Review
                                                          ↓ (agent: gh pr create + setState)
                                                  Waiting PR Checks
                                                ┌──── ↓ ────┐
                                          checks=red   checks=green
                                                ↓             ↓
                                  In Dev (with comment)   Ready for Human Review
                                  (≤ budget)              (terminal handoff)
                                                ↓
                                   budget exhausted → Ready for Human Review
                                                       (with escalation comment)
```

### 4.2 Workflow change (agent-side)

The agent's WORKFLOW.md prompt must instruct: after `gh pr create`, set ticket state to `Waiting PR Checks` (not `Ready for Review`). `Ready for Review` becomes a transient state agents pass through implicitly — kept in the union to avoid breaking existing tickets, but unused on the happy path going forward.

This is a workflow-prompt change, **not** a code change in dalang or papan. It travels via the user's external `WORKFLOW.md`.

## 5. Orchestrator Changes (dalang)

### 5.1 New polling path

Per tick (alongside the existing dispatch path), dalang fetches issues in state `Waiting PR Checks` and runs a non-agent reconciler against each one. Concurrency for this path is unbounded by `max_concurrent_agents` — these are shell-outs to `gh`, not agent sessions.

### 5.2 PR resolution

For each waiting issue, derive the PR via:

```
gh pr list --head <issue.branch_name> --state open --json url,number,headRefOid -q '.[0]'
```

If the result is empty, post `[pr_checks_no_pr]` comment and bounce to `In Dev` (counts toward budget — agent didn't actually open a PR). If `branch_name` is null on the issue, same bounce, same comment.

### 5.3 Check polling

For a resolved PR, run:

```
gh pr checks <number> --json name,state,bucket,link
```

Bucketing follows `gh`:

- `pass` — all checks pass → success path.
- `pending` — at least one not-yet-completed → no-op this tick, re-poll next tick.
- `fail` / `cancel` / `skipping` — at least one failed/cancelled → failure path.

### 5.4 Flake rerun (optional)

If `pr_checks.rerun_flakes = true` (default `true`) **and** this is the first time we've seen a failure on this `headRefOid` (no prior `[pr_checks_failed] sha=<headRefOid>` comment), run `gh run rerun --failed <run-id>` for each failing check's run, post `[pr_checks_rerun] sha=<short-sha>`, and treat the PR as still pending — re-poll next tick. Real failures then count on the second observation.

### 5.5 Budget & escalation

Failure budget defaults to `pr_checks.failure_budget = 3`. Counter is derived per-issue by counting `[pr_checks_failed]` comments on the issue across all SHAs. (Per-SHA dedupe within a single failure observation prevents counting the same red SHA twice.)

- `attempt < budget` → post `[pr_checks_failed]` comment and PATCH state to `In Dev`.
- `attempt >= budget` → post `[pr_checks_escalated]` comment and PATCH state to `Ready for Human Review`.

On green, post `[pr_checks_passed]` and PATCH state to `Ready for Human Review`.

### 5.6 Comment formats

All bot comments are tagged with a leading `[<kind>]` token to make them machine-parsable. The body is plain markdown. Examples:

```
[pr_checks_failed] sha=abc1234 attempt=1/3
- typecheck (CI / build): failure — https://github.com/owner/repo/actions/runs/123
- unit-tests (CI / test): failure — https://github.com/owner/repo/actions/runs/124

Bouncing back to In Dev. Read this comment and fix the failures.
```

```
[pr_checks_passed] sha=abc1234
All checks passed. Ready for human review.
```

```
[pr_checks_escalated] sha=abc1234 attempt=3/3
Failure budget exhausted. Parking for human review.
- typecheck (CI / build): failure — https://github.com/owner/repo/actions/runs/125
```

```
[pr_checks_no_pr]
No open PR found for branch <branch_name>. Did the agent run `gh pr create`?
```

```
[pr_checks_rerun] sha=abc1234
Re-triggered 2 failed checks. Will re-poll.
```

### 5.7 Per-SHA dedupe

Before posting `[pr_checks_failed]` or `[pr_checks_passed]`, scan recent comments on the issue. If the latest tagged comment for this kind has the same `sha=<headRefOid>`, skip the action — we've already handled this SHA. This prevents duplicate state changes when the next tick fires before a state change propagates back from papan.

## 6. Tracker Adapter Changes

`TrackerAdapter` gains two write methods:

```ts
addComment(issueId: string, body: string): Promise<void>;
listComments(issueId: string): Promise<TrackerComment[]>;
updateState(issueId: string, state: string): Promise<void>;
```

Existing papan routes already cover these:

- `POST /api/v1/issues/:id/comments` — body `{ author, body }`
- `GET /api/v1/issues/:id/comments` — returns `{ comments: [...] }`
- `PATCH /api/v1/issues/:id` — body includes `state`

`TrackerComment` shape:

```ts
interface TrackerComment {
  id: string;
  author: string | null;
  body: string;
  created_at: string;
}
```

`addComment` and `updateState` get their own `TrackerErrorCode` entries (`tracker_write_error`) for the orchestrator's existing error classifier.

## 7. Configuration

New `pr_checks` block in `WorkflowFrontMatterSchema`:

```yaml
pr_checks:
  enabled: true # gate the entire feature; default false for backwards compat
  poll_interval_ms: 60000 # how often to re-check pending PRs (separate from main poll)
  failure_budget: 3
  rerun_flakes: true
  gh_executable: "gh"
  bot_author: "dalang" # used as comment author
```

`enabled: false` (default) means dalang ignores `Waiting PR Checks` issues entirely — they sit there until a human moves them. This keeps the change drop-in.

`poll_interval_ms` is independent of `polling.interval_ms` (the main loop). The PR-checks reconciler runs each main-loop tick but skips issues whose last poll attempt was within `poll_interval_ms`.

## 8. State Tracking (in-memory)

`OrchestratorState` gets a new field:

```ts
pr_checks_polls: Map<
  string /*issueId*/,
  {
    last_polled_at: string; // ISO; throttle next poll
    last_seen_sha: string | null;
    last_action: "pending" | "rerun" | "failed" | "passed" | "escalated" | "no_pr" | null;
  }
>;
```

This is purely a throttle/dedupe cache; durable truth lives in papan comments + state. Restart loses this map; that's fine — the comment dedupe in §5.7 ensures correctness.

## 9. Observability

- Each `gh` invocation logs `{ issue_id, identifier, kind: "pr_checks_<step>", duration_ms, exit_code }`.
- `RuntimeEventKind` gets a `pr_checks_observed` event with `{ sha, conclusion, attempt, budget }` — surfaces in `/api/v1/state`.
- Tagged comments (§5.6) are the user-facing audit trail.

## 10. Failure Modes

| Failure                                       | Behaviour                                                                                             |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `gh` not found / not authed                   | Log `tracker_request_error`-style warning; skip this tick; do **not** count toward budget.            |
| `gh pr list` returns empty                    | `[pr_checks_no_pr]`, bounce to `In Dev`, **counts** toward budget.                                    |
| papan write fails                             | Log; retry on next tick. No state change happens — counter stays put.                                 |
| Checks pending for >24h                       | No special handling in v1; human will notice. (Future: stall-on-pending threshold.)                   |
| Budget tampered with (user deletes a comment) | Counter is now lower; agent gets another bounce. Acceptable in v1; user can also manually move state. |

## 11. Test Strategy

- **papan**: state union test — `Waiting PR Checks` is a valid state and does not appear in `ACTIVE_STATES`.
- **dalang**: `gh` is faked with a configurable shell stub (script that emits canned JSON based on env). Real `Bun.spawn`, no mocking the system under test.
- Comment-counter logic gets unit tests over a fake comment list.
- End-to-end: spin up papan HTTP server (existing test pattern), run one orchestrator tick with a fake `gh` that returns red, assert (a) `[pr_checks_failed]` comment is present, (b) state moved to `In Dev`, (c) counter increments on a second tick.

## 12. Migration & Rollout

1. Ship the papan state addition (no-op behaviour change — humans can pick it manually but no agent depends on it).
2. Ship dalang reconciler with `pr_checks.enabled` defaulting to `false`. No behavioral change.
3. Update the user's external `WORKFLOW.md` to set state to `Waiting PR Checks` after `gh pr create`, and flip `pr_checks.enabled = true`.

Each step is independently revertable.
