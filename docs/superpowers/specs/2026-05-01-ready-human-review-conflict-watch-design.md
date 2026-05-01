# Ready Human Review Conflict Watch — Design

Status: Draft v1
Date: 2026-05-01
Author: dalang
Related issue: `ruqqq/pentas#15`

## 1. Executive Summary

**Problem Statement:** Dalang can already reconcile PR checks while a work item is in `Waiting PR Checks`, but once a card reaches `Ready for Human Review`, later merge conflicts can leave the human-review queue stale. A reviewer should not discover merge conflicts only when they attempt to merge.

**Proposed Solution:** Extend the existing control-plane PR reconciliation path so it also watches configured human-review states for PR mergeability conflicts. When a PR in `Ready for Human Review` becomes conflicted, dalang posts a tagged control-plane comment and moves the card back to `Ready for Dev`.

**Success Criteria:**

- A project item in `Ready for Human Review` with a conflicted open PR receives exactly one conflict comment per conflicting head SHA.
- The project item moves to `Ready for Dev` after the conflict comment is written.
- Clean, unknown, draft, or missing-mergeability PRs do not move the item.
- The existing `Waiting PR Checks` pass/fail behavior remains unchanged.

## 2. User Experience & Functionality

### User Personas

- **Reviewer:** Wants the human-review queue to contain PRs that are actionable.
- **Dalang operator:** Wants the board state to recover automatically when a PR needs agent work again.
- **Agent worker:** Needs a concise control-plane comment explaining why the item returned to development.

### User Stories

- As a reviewer, I want conflicted PRs to leave `Ready for Human Review` automatically so that my review queue stays actionable.
- As an agent worker, I want a control-plane comment that states the PR is conflicted so that I can resolve the merge conflict without guessing why the card moved.
- As an operator, I want conflict watching to reuse the PR reconciliation polling loop so that it does not consume an agent slot.

### Acceptance Criteria

- Given `pr_checks.enabled = true` and a work item in the configured conflict-watch state, when its open PR has `mergeable = CONFLICTING` or equivalent GitHub REST mergeable state `dirty`, dalang adds a control-plane comment beginning with `[pr_conflicts_detected] sha=<short-sha>` and moves the item to the configured conflict target state.
- The default conflict-watch state is `Ready for Human Review`.
- The default conflict target state is `Ready for Dev`.
- Conflict comments are deduped by tagged comment and PR head SHA. A repeated poll for the same conflicted SHA does not add another comment, but it may retry the state update if the item is still in the conflict-watch state.
- If GitHub reports mergeability as unknown, pending, clean, draft, blocked, behind, or otherwise not conflicted, dalang leaves the item in place.
- If no PR is found for a human-review item, dalang leaves the item in place. Existing no-PR bounce behavior remains limited to `Waiting PR Checks`.
- The GitHub Projects adapter validates that the configured conflict-watch and conflict target states exist when conflict watching is enabled.

### Non-Goals

- Resolving conflicts automatically.
- Handling closed PRs.
- Moving items out of human review for non-conflict merge blockers such as missing approvals, branch protection, or stale branches.
- Adding a separate daemon, queue, or webhook path.
- Changing GitHub Projects field names or board contract.

## 3. Technical Specifications

### Architecture Overview

This feature is an extension of the current PR reconciliation capability described in `2026-04-30-pr-checks-wait-design.md` and `2026-04-30-control-plane-github-projects-design.md`.

Dalang already calls `controlPlane.reconcilePrChecks(...)` once per tick when PR checks are enabled. The GitHub Projects adapter should expand that reconciliation to handle two independent subsets:

- `Waiting PR Checks`: existing CI pass/fail/rerun behavior.
- `Ready for Human Review`: new merge-conflict watch behavior.

The conflict path should live in `packages/dalang/src/control-plane/github/pr-checks.ts` or an adjacent small helper under the GitHub control-plane folder. It should not add conflict-specific logic to `packages/dalang/src/orchestrator/orchestrator.ts`.

### Configuration

Extend GitHub Projects `pr_checks` config with optional fields:

```yaml
control_plane:
  kind: github-projects
  pr_checks:
    enabled: true
    conflict_watch_state: "Ready for Human Review"
    conflict_target_state: "Ready for Dev"
```

Defaults:

- `conflict_watch_state = "Ready for Human Review"`
- `conflict_target_state = "Ready for Dev"`

Papan can ignore these fields until Papan has linked-PR mergeability support. The immediate issue is GitHub Projects board behavior.

### GitHub Integration

GitHub mergeability should be read from the resolved open PR. Preferred source:

- GraphQL `PullRequest.mergeable` when the adapter already has a PR node ID.

Fallback source:

- REST `GET /repos/{owner}/{repo}/pulls/{pull_number}` and `mergeable_state`.

Conflict mapping:

- GraphQL `CONFLICTING` means conflicted.
- REST `dirty` means conflicted.
- `UNKNOWN`, `MERGEABLE`, `clean`, `blocked`, `behind`, `draft`, `unstable`, `has_hooks`, and null/undefined are not treated as conflict in v1.

### Comment Format

All project comments must still begin with the repo-required agent prefix when posted by dalang:

```text
[AGENT MESSAGE]

[pr_conflicts_detected] sha=abc1234
PR #42 is currently conflicted with the base branch. Moving this item back to Ready for Dev so the conflict can be resolved.
```

Existing PR-check comments are not retroactively changed in this issue.

### Error Handling

- If the mergeability request fails, log through the existing control-plane warning path and retry on the next eligible tick.
- If adding the conflict comment fails, do not update state.
- If updating state fails after the comment is added, the next tick retries state movement without adding another comment. Dedupe by comment SHA prevents comment spam but must not suppress the state retry.

## 4. Risks & Roadmap

### Technical Risks

- GitHub mergeability can temporarily be `UNKNOWN`; treating unknown as conflict would create false bounces, so v1 waits for a concrete conflicted state.
- GitHub REST `mergeable_state` values are not as strongly documented as GraphQL enum values. Tests should cover the strings dalang handles.
- Updating state after adding the comment can fail. This may leave a tagged conflict comment on a human-review card until the next tick.

### Rollout

1. Add schema defaults and validation for conflict-watch states.
2. Add pure conflict decision/comment helpers and unit tests.
3. Extend GitHub Projects reconciliation to evaluate human-review items for conflicts.
4. Add adapter-level tests for conflicted, clean, unknown, no-PR, and dedupe scenarios.

## 5. ADR Assessment

No ADR is needed for this issue. The decision is to reuse the existing control-plane PR reconciliation boundary and GitHub Projects adapter, which is already the durable architecture documented in the control-plane specs. This issue only adds a new PR observation inside that boundary.
