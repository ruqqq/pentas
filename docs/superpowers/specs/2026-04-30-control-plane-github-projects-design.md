# Control Plane + GitHub Projects Adapter — Design

Status: Draft v1
Date: 2026-04-30
Author: ruqqq
Companion specs:

- `2026-04-29-dalang-orchestrator-design.md`
- `2026-04-29-papan-tracker-design.md`
- `2026-04-30-pr-checks-wait-design.md`

## 1. Purpose

Decouple `dalang` from `papan` entirely by replacing the tracker-specific boundary with a control-plane boundary.

The current `TrackerAdapter` name is too narrow. Dalang does not only track work; it coordinates a workflow against an external control surface: selecting eligible work, enforcing ownership, reading recent activity, writing comments, changing states, and reconciling PR checks. `papan` remains one control-plane implementation. GitHub Projects v2 becomes the first non-Papan implementation.

GitHub Projects v2 is the target for the GitHub kanban implementation. GitHub's current Projects automation API is GraphQL-based and supports reading project fields, finding single-select options, querying project items, and updating a project item's field value. The adapter uses those Project v2 primitives instead of Projects classic.

## 2. Scope

### In scope

- Rename the Dalang boundary from tracker terminology to control-plane terminology.
- Introduce a `ControlPlaneAdapter` contract with core work-item methods and optional capabilities.
- Preserve `papan` behavior through a Papan control-plane adapter.
- Add a `github-projects` control-plane adapter for GitHub Projects v2 boards.
- Make dispatch ownership explicit so Dalang only picks up work assigned to it, labeled for it, or otherwise marked for it.
- Move PR-check reconciliation behind the control-plane capability surface.
- Keep Dalang's scheduler, workspace management, agent providers, and prompt lifecycle generic.

### Out of scope

- Supporting GitHub Projects classic.
- Dispatching GitHub draft issues or PR project items.
- Bidirectional synchronization between Papan and GitHub.
- Webhook-driven dispatch. Polling remains the v1 runtime model.
- General Jira, Linear, Trello, or other kanban implementations. The design should allow them later.

## 3. Terminology

- **Control plane**: The external system Dalang uses to coordinate work. It owns work item state, comments, ownership metadata, and any native workflow features it can provide.
- **Work item**: The normalized unit Dalang can dispatch to an agent. This replaces the tracker-flavored "issue" naming at the boundary.
- **Control-plane adapter**: A backend-specific implementation of the control-plane contract.
- **Ownership**: The adapter-enforced rule that decides whether a work item belongs to this Dalang instance.

## 4. Architecture

Dalang talks only to `ControlPlaneAdapter`.

```ts
interface ControlPlaneAdapter {
  capabilities: ControlPlaneCapabilities;

  fetchDispatchableWork(query: DispatchQuery): Promise<WorkItem[]>;
  fetchWorkByStates(states: string[]): Promise<WorkItem[]>;
  refreshWork(ids: string[]): Promise<WorkItem[]>;
  fetchWorkItem(id: string): Promise<WorkItem | null>;

  listComments(id: string): Promise<ControlPlaneComment[]>;
  addComment(id: string, body: string, author?: "user" | "agent"): Promise<void>;
  updateState(id: string, state: string): Promise<void>;

  listHistory?(id: string): Promise<ControlPlaneHistoryEntry[]>;
  reconcilePrChecks?(args: PrChecksReconcileArgs): Promise<void>;
}

interface ControlPlaneCapabilities {
  history?: true;
  prChecks?: true;
}

interface DispatchQuery {
  activeStates: string[];
  ownership: OwnershipRule;
}
```

The existing normalized issue shape can evolve into `WorkItem` with mostly the same fields for v1:

```ts
interface WorkItem {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  priority: number | null;
  state: string;
  branch_name: string | null;
  url: string | null;
  external_ref: string | null;
  internal_ref: string | null;
  labels: string[];
  blocked_by: BlockerRef[];
  created_at: string | null;
  updated_at: string | null;
}
```

`id` is the backend state-mutation target for every adapter. For Papan this remains the Papan issue ID. For GitHub Projects this is the Project v2 item ID because state updates target the project item, not the underlying issue. `external_ref` carries the underlying source issue reference when one exists.

## 5. Configuration

The workflow front matter replaces `tracker:` with `control_plane:`.

```yaml
control_plane:
  kind: papan
  active_states: [Todo, "In Dev"]
  terminal_states: [Done, Cancelled]
  ownership:
    mode: none
    value: null
```

Ownership modes:

```ts
type OwnershipRule =
  | { mode: "none"; allow_unowned_dispatch?: boolean }
  | { mode: "label"; value: string }
  | { mode: "assignee"; value: string }
  | { mode: "project_field"; field: string; value: string };
```

Validation rules:

- `papan` may default to `ownership.mode: none` because it is a local agent inbox.
- Shared external control planes such as `github-projects` require explicit ownership.
- `ownership.mode: none` on a shared external control plane is valid only when `allow_unowned_dispatch: true` is present.
- Empty ownership values are invalid for `label`, `assignee`, and `project_field`.
- `control_plane.active_states` and `control_plane.terminal_states` must remain non-empty.

## 6. GitHub Projects Adapter

The first external adapter is `github-projects`, backed by GitHub Projects v2.

Example:

```yaml
control_plane:
  kind: github-projects
  owner_type: organization
  owner: my-org
  project_number: 12
  repository: my-org/my-repo
  token: $GITHUB_TOKEN

  status_field: Status
  active_states: [Todo, "In Dev"]
  terminal_states: [Done, Cancelled]

  ownership:
    mode: label
    value: dalang

  pr_checks:
    enabled: true
    wait_state: "Waiting PR Checks"
    pass_state: "Ready for Human Review"
    fail_state: "In Dev"
    escalation_state: "Ready for Human Review"
    failure_budget: 3
    rerun_flakes: true
```

### 6.1 GitHub API use

The adapter uses GitHub GraphQL for Projects v2 operations:

- Resolve the project node ID from `owner_type`, `owner`, and `project_number`.
- Resolve `status_field` to a Project v2 single-select field ID.
- Resolve configured state names to single-select option IDs.
- Query project items and their content.
- Ignore project items whose content is not a GitHub issue.
- Update state with `updateProjectV2ItemFieldValue`.

The adapter uses GitHub issue APIs, either GraphQL or REST, for issue comments, labels, assignees, and PR/check metadata as appropriate. One adapter module should own these API choices so Dalang's orchestrator does not depend on GitHub request shapes.

Required token capabilities:

- Read project items and fields.
- Write project item field values.
- Read repository issues and PR metadata.
- Write issue comments.
- Read check status for linked PRs.

Startup validation should fail with a clear error if the token cannot access the project, repository, status field, configured state options, or required mutation surfaces.

### 6.2 Work-item mapping

Only GitHub issue project items are dispatchable in v1.

Recommended mapping:

| WorkItem field | GitHub source                                                          |
| -------------- | ---------------------------------------------------------------------- |
| `id`           | Project item ID, because state updates target the project item         |
| `identifier`   | `OWNER/REPO#NUMBER`                                                    |
| `title`        | Issue title                                                            |
| `description`  | Issue body                                                             |
| `state`        | Project `Status` single-select value                                   |
| `url`          | Issue URL                                                              |
| `external_ref` | Issue node ID or issue number                                          |
| `internal_ref` | Additional adapter-owned reference if needed                           |
| `labels`       | Issue labels, lowercased                                               |
| `created_at`   | Issue creation timestamp                                               |
| `updated_at`   | Max of issue updated time and project item updated time when available |

`branch_name` is resolved in this order:

1. A configured project text field, if present.
2. A deterministic branch derived from issue number and title.

The v1 GitHub config includes an optional `branch_field` string for the first path. When absent, the deterministic derivation path is used. The adapter does not scrape branch markers from comments or issue bodies in v1.

The v1 GitHub adapter should not dispatch draft issues or PR items. It may log that they were ignored at debug level.

### 6.3 Ownership filtering

The adapter enforces ownership before returning dispatchable work.

- `label`: issue must have the named label.
- `assignee`: issue must be assigned to the configured login.
- `project_field`: project item must have the configured field value.

Ownership is adapter-side, not a post-filter in Dalang. This lets each backend use the most efficient native query and prevents accidental dispatch when the backend's representation differs from Dalang's normalized shape.

## 7. PR Checks Capability

PR-check reconciliation moves behind the control-plane capability:

```ts
interface PrChecksReconcileArgs {
  work: WorkItem[];
  config: PrChecksConfig;
  repoCwd: string;
  now: () => Date;
}
```

Dalang behavior:

1. If PR checks are disabled, do nothing.
2. If PR checks are enabled and the adapter lacks `capabilities.prChecks`, fail config validation.
3. Fetch work in the configured wait state.
4. Call `controlPlane.reconcilePrChecks(...)`.

Papan behavior:

- Preserve today's `gh`-based reconciliation semantics behind the Papan adapter.
- Continue using comments for dedupe markers.
- Update Papan state through the control-plane adapter.

GitHub Projects behavior:

- Resolve the issue's branch or linked PR.
- Read PR check state.
- If checks are pending, leave the item in the wait state.
- If checks fail within budget, add a GitHub issue comment and move the project item to `fail_state`.
- If checks repeatedly fail past budget, add an escalation comment and move the project item to `escalation_state`.
- If checks pass, optionally mark the PR ready when configured, add a comment, and move the project item to `pass_state`.
- If no PR is found, add a comment and move the item to `fail_state`.

Write failures leave the item in its current state. The next tick retries.

## 8. Runtime Flow

On each tick:

1. Reconcile running work with `refreshWork`.
2. Run PR-check reconciliation through the control plane when enabled.
3. Fetch dispatchable work with `fetchDispatchableWork({ activeStates, ownership })`.
4. Apply Dalang's local concurrency and retry eligibility rules.
5. Run the selected agent against the normalized `WorkItem`.
6. Inject recent comments and optional history into the first prompt.
7. Continue polling until the work item exits an active state, reaches max turns, or fails.

Dalang does not inspect GitHub project fields, labels, assignees, or PR checks directly. Those are adapter concerns.

## 9. Error Handling

| Failure                                                     | Behavior                                              |
| ----------------------------------------------------------- | ----------------------------------------------------- |
| Unsupported `control_plane.kind`                            | Config validation error                               |
| Missing ownership on shared external board                  | Config validation error                               |
| Missing GitHub token env var                                | Config validation error                               |
| GitHub token lacks project or repository access             | Startup validation error                              |
| Missing status field                                        | Startup validation error                              |
| Missing configured status option                            | Startup validation error                              |
| Adapter lacks PR-check capability while enabled             | Config validation error                               |
| GitHub API rate limit or transient failure                  | Log warning, skip affected operation, retry next tick |
| Malformed project item                                      | Skip item and log; do not fail whole tick             |
| Comment or state write fails during PR-check reconciliation | Leave current state unchanged and retry next tick     |

## 10. Migration Plan

1. Rename types and files from `tracker` to `control-plane` with no behavior change.
2. Introduce the `control_plane` config key and support `tracker` as a temporary compatibility alias for one migration release.
3. Move `RestTrackerAdapter` to a Papan control-plane adapter.
4. Move PR-check runner integration behind `ControlPlaneAdapter.reconcilePrChecks`.
5. Add ownership config and validation.
6. Add the GitHub Projects adapter and tests.
7. Update docs and workflow examples to use `control_plane`.
8. Remove the compatibility alias in the next breaking-change pass after the migration release.

## 11. Tests

Unit tests:

- Config schema accepts `control_plane.kind = papan`.
- Config schema accepts `control_plane.kind = github-projects`.
- External control planes reject missing ownership.
- `allow_unowned_dispatch: true` permits explicit unowned dispatch.
- PR checks enabled with an adapter lacking `prChecks` fails validation.
- Work-item eligibility still honors active, terminal, claimed, running, retry, and concurrency rules.

Papan adapter tests:

- Existing REST adapter tests pass after rename.
- Comments, history, state update, pagination, and malformed payload behavior remain unchanged.
- Existing PR-check scenarios pass through the adapter capability.

GitHub adapter tests with mocked HTTP:

- Resolves project ID for organization and user projects.
- Resolves status field and single-select option IDs.
- Normalizes GitHub issue project items into `WorkItem`.
- Filters dispatchable work by label, assignee, and project field ownership.
- Ignores draft issues and PR project items.
- Adds issue comments.
- Updates project item status.
- Reconciles PR checks for pending, pass, fail, no-PR, and escalation cases.
- Handles rate limit and malformed payload failures without crashing a tick.

## 12. Binding Decisions

- `WorkItem.id` is the backend state-mutation target. For GitHub Projects, this means Project v2 item ID.
- GitHub branch names use optional `control_plane.branch_field` first, then deterministic derivation from issue number and title.
- `tracker` remains a compatibility alias for one migration release, then is removed in a later breaking-change pass.
