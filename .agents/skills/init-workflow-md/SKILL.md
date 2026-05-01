---
name: init-workflow-md
description: Use when the user wants to create, scaffold, or initialize a WORKFLOW.md file for dalang. Produces a valid YAML front matter plus Liquid prompt body that dalang's WorkflowLoader can load.
---

# Initialize a dalang WORKFLOW.md

This generic agents skill scaffolds a dalang `WORKFLOW.md` in the target project. dalang loads YAML front matter as configuration and renders the Markdown body as a Liquid prompt. The body can import relative Markdown fragments with `@path/to/file.md`; dalang expands imports before Liquid rendering.

Spec sources of truth:

- `docs/superpowers/specs/2026-04-29-dalang-orchestrator-design.md`
- `docs/superpowers/specs/2026-04-30-pr-checks-wait-design.md`
- `docs/superpowers/specs/2026-04-30-codex-provider-design.md`
- `docs/superpowers/specs/2026-04-30-opencode-provider-design.md`

## Step 1 - Confirm Inputs

Ask only for values that cannot be inferred. Defaults in parentheses are safe to assume silently.

Required:

1. **Target path** - where should the file land? (Default: `WORKFLOW.md` in the project dalang will operate on, not inside the dalang package.)
2. **Control plane** - `papan` or `github-projects`. (Default: infer from the repo or ask.)
3. **Control-plane connection**:
   - Papan: `endpoint` (default `http://localhost:3001`), optional `api_key`.
   - GitHub Projects: `owner_type`, `owner`, `project_number`, `repository`, `status_field`, optional `branch_field`, and ownership rule.
4. **Repo URL** - the source repo dalang clones into worktrees. If absent, omit the whole `repo:` block and rely on hooks.
5. **Default branch** - usually `main`.
6. **Branch prefix** - for example `pentas/` or `agent/`.
7. **Workspace root** - absolute or `~`-prefixed path where worktrees go (default `~/.dalang/workspaces`).
8. **Active and terminal states** - match the control plane's state names.
9. **Agent provider** - `claude`, `codex`, or `opencode` (default `claude` unless the repo already standardizes on another provider).

Confirm before writing if any of these are non-obvious.

## Step 2 - Pick Safe Defaults

| Field                                      | Default                    | Notes                                                                 |
| ------------------------------------------ | -------------------------- | --------------------------------------------------------------------- |
| `control_plane.kind`                       | `papan`                    | Use `github-projects` when the workflow is backed by GitHub Projects. |
| `control_plane.endpoint`                   | `http://localhost:3001`    | Papan only.                                                           |
| `control_plane.api_key`                    | `$PENTAS_API_KEY` or null  | Use `$VAR` indirection; omit on localhost without auth.               |
| `polling.interval_ms`                      | `30000`                   |                                                                       |
| `agent.max_concurrent_agents`              | `4`                        | Practical ceiling for subscription-backed CLIs.                       |
| `agent.max_turns`                          | `20`                       |                                                                       |
| `agent.max_retry_backoff_ms`               | `300000`                   |                                                                       |
| `agent.max_concurrent_agents_by_state`     | `{}`                       | Add per-state caps only when useful.                                  |
| `agent_provider`                           | `claude`                   | Active provider block must be present.                                |
| `claude.executable_path`                   | `claude`                   | Resolves on `PATH`.                                                   |
| `claude.model`                             | `claude-opus-4-7`          |                                                                       |
| `claude.permission_mode`                   | `auto`                     | Headless default. `acceptEdits` is rejected.                          |
| `codex.executable_path`                    | `codex`                    | Resolves on `PATH`.                                                   |
| `codex.model`                              | `gpt-5.5`                  | Requires `codex login` subscription auth for the default model.       |
| `codex.sandbox_mode`                       | `workspace-write`          |                                                                       |
| `codex.approval_policy`                    | `never`                    | Headless default.                                                     |
| `opencode.executable_path`                 | `opencode`                 | Resolves on `PATH`.                                                   |
| `opencode.model`                           | ask                        | Required `provider/model` form, for example `google/gemini-2.5-pro`.  |
| provider `turn_timeout_ms`                 | `3600000`                  | 1 hour.                                                               |
| provider `read_timeout_ms`                 | `5000`                     |                                                                       |
| provider `stall_timeout_ms`                | `300000`                   | 5 minutes; set `<= 0` to disable stall detection.                     |
| `control_plane.pr_checks.enabled`          | `false`                    | GitHub Projects PR-check reconciler; opt in per workflow.             |
| `control_plane.pr_checks.wait_state`       | `Waiting PR Checks`        | GitHub Projects only.                                                 |
| `control_plane.pr_checks.pass_state`       | `Ready for Human Review`   | GitHub Projects only.                                                 |
| `control_plane.pr_checks.fail_state`       | `In Dev`                   | GitHub Projects only.                                                 |
| `control_plane.pr_checks.escalation_state` | `Ready for Human Review`   | GitHub Projects only.                                                 |
| root `pr_checks.enabled`                   | `false`                    | Papan-style PR-check reconciler; opt in if using that path.           |
| `pr_checks.poll_interval_ms`               | `60000`                    |                                                                       |
| `pr_checks.failure_budget`                 | `3`                        |                                                                       |
| `pr_checks.rerun_flakes`                   | `true`                     |                                                                       |
| `pr_checks.gh_executable`                  | `gh`                       | Resolves on `PATH`.                                                   |
| `server.port`                              | `0`                        | Ephemeral; CLI `--port` wins.                                         |
| `hooks.timeout_ms`                         | `60000`                    |                                                                       |

Provider rules:

- `agent_provider` is global for the workflow. Per-state provider routing is not supported.
- The active provider's block is required. Inactive provider blocks may be omitted.
- Changing `agent_provider` requires restarting dalang; hot reload intentionally ignores provider switches.
- For `opencode`, `model` has no default and must be in `provider/model` form.

## Step 3 - Write the File

Prefer a split workflow for anything beyond a small prototype. Keep all config in the root file and put reusable prompt body fragments under `workflow/`. Hooks should include sensible bootstrap in `after_create` or `before_run`; set `after_run` and `before_remove` to `null` unless cleanup is requested.

### GitHub Projects + Codex Template

```markdown
---
control_plane:
  kind: github-projects
  owner_type: user
  owner: OWNER
  project_number: 1
  repository: OWNER/REPO
  status_field: Status
  branch_field: Branch
  active_states:
    - "Ready for Planning"
    - "Planning"
    - "Plan Review"
    - "Ready for Dev"
    - "In Dev"
    - "Ready for Review"
  terminal_states: [Done, Cancelled, Duplicate]
  ownership:
    mode: project_field
    field: Agent
    value: dalang
  pr_checks:
    enabled: true
    wait_state: "Waiting PR Checks"
    pass_state: "Ready for Human Review"
    fail_state: "In Dev"
    escalation_state: "Ready for Human Review"
    failure_budget: 3
    rerun_flakes: true

repo:
  url: git@github.com:OWNER/REPO.git
  default_branch: main
  branch_prefix: agent/

polling:
  interval_ms: 30000

workspace:
  root: ~/.dalang/workspaces

hooks:
  after_create: |
    bun install
  before_run: |
    git fetch origin
  after_run: null
  before_remove: null
  timeout_ms: 60000

agent:
  max_concurrent_agents: 4
  max_turns: 20
  max_retry_backoff_ms: 300000
  max_concurrent_agents_by_state: {}

agent_provider: codex
codex:
  executable_path: codex
  model: gpt-5.5
  sandbox_mode: workspace-write
  approval_policy: never
  turn_timeout_ms: 3600000
  read_timeout_ms: 5000
  stall_timeout_ms: 300000

server:
  port: 0

pr_checks:
  enabled: false
  poll_interval_ms: 60000
  failure_budget: 3
  rerun_flakes: true
  gh_executable: gh
---

@workflow/preamble.md
@workflow/state-dispatch.md
```

### Papan + Claude Template

```markdown
---
control_plane:
  kind: papan
  endpoint: http://localhost:3001
  api_key: $PENTAS_API_KEY
  board: null
  active_states: [Todo, "In Progress"]
  terminal_states: [Done, Cancelled, Duplicate]
  ownership:
    mode: none

repo:
  url: git@github.com:OWNER/REPO.git
  default_branch: main
  branch_prefix: agent/

polling:
  interval_ms: 30000

workspace:
  root: ~/.dalang/workspaces

hooks:
  after_create: |
    bun install
  before_run: |
    git fetch origin
  after_run: null
  before_remove: null
  timeout_ms: 60000

agent:
  max_concurrent_agents: 4
  max_turns: 20
  max_retry_backoff_ms: 300000
  max_concurrent_agents_by_state: {}

agent_provider: claude
claude:
  executable_path: claude
  model: claude-opus-4-7
  permission_mode: auto
  turn_timeout_ms: 3600000
  read_timeout_ms: 5000
  stall_timeout_ms: 300000

server:
  port: 0

pr_checks:
  enabled: false
  poll_interval_ms: 60000
  failure_budget: 3
  rerun_flakes: true
  gh_executable: gh
---

@workflow/preamble.md
@workflow/state-dispatch.md
```

### Opencode Provider Block

Use this instead of the `claude:` or `codex:` block when the user chooses opencode:

```yaml
agent_provider: opencode
opencode:
  executable_path: opencode
  model: google/gemini-2.5-pro
  turn_timeout_ms: 3600000
  read_timeout_ms: 5000
  stall_timeout_ms: 300000
```

## Prompt Fragments

`workflow/preamble.md`:

```markdown
You are working on **{{ issue.identifier }}: {{ issue.title }}** in state **`{{ issue.state }}`**.

{% if attempt %}
This is continuation attempt {{ attempt }}. Inspect the workspace state before doing state work.
{% endif %}

## Description

{{ issue.description }}
```

`workflow/state-dispatch.md`:

```markdown
## What to do RIGHT NOW (state = `{{ issue.state }}`)

{% case issue.state %}
@states/in-progress.md
@states/ready-for-review.md
{% else %}
Unknown state `{{ issue.state }}`. Do not modify the workspace. Stop.
{% endcase %}
```

`workflow/states/in-progress.md`:

```markdown
{% when "In Progress" %}

1. Read the issue and confirm requirements.
2. Implement with tests.
3. Run relevant verification.
4. Commit, push, and open a PR.
5. Update the item state according to the workflow.
```

`workflow/states/ready-for-review.md`:

```markdown
{% when "Ready for Review" %}

1. Review the PR for bugs, regressions, missing tests, and maintainability risks.
2. If code changes are required, comment with findings and move the item back to the implementation state.
3. If the PR is ready for checks, move the item to `Waiting PR Checks` when PR checks are enabled, otherwise to the configured human-review state.
```

For very small workflows, an inline body is still valid; put the prompt directly after the front matter instead of using imports.

## Markdown Imports

Import syntax is a whole line:

```markdown
@workflow/preamble.md
@workflow/states/in-progress.md
@./workflow/shared.md
@../workflow/shared.md
```

Rules enforced by dalang:

- `@foo.md` resolves relative to the importing file's directory, equivalent to `@./foo.md`.
- Nested imports are allowed.
- Imports are expanded before Liquid rendering; Liquid variables work normally inside imported files.
- Dynamic imports like `@workflow/{{ issue.state }}.md` are not supported.
- Only local `.md` files under the root workflow directory are allowed.
- Absolute paths, URL-style imports, symlink escapes, front matter in imported files, cycles, and excessive nesting are rejected.
- Hot reload checks the root file and imported files.

## Liquid Variables Available

The prompt body is rendered per attempt. Available bindings:

- `issue.id`, `issue.identifier`, `issue.title`, `issue.description`, `issue.state`, `issue.priority`, `issue.url`
- `issue.labels` - iterable: `{% for label in issue.labels %}{{ label }}{% endfor %}`
- `issue.blocked_by` - iterable list of blocker identifiers
- `recent_comments` and `recent_history` - newest-first slices of tracker activity
- `attempt` - empty on first run, integer on retry or continuation

Within a single agent run, follow-up turns use a short continuation prompt and keep the provider session context. When dalang schedules a later retry or continuation attempt, it renders the full workflow template again with `attempt` set. Keep durable workflow instructions in files, not in one-off agent replies.

## Hooks Env Vars

Hooks run as `bash -lc` with `cwd = workspace`. Available env:

- `WORKSPACE_PATH`
- `ISSUE_ID`
- `ISSUE_IDENTIFIER`
- `ISSUE_STATE`
- `ATTEMPT`
- `BRANCH`
- `REPO_URL`

## Common Mistakes

| Mistake                                           | Fix                                                                                      |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Using `tracker:` for new workflows                | Prefer `control_plane:`. `tracker:` remains a Papan compatibility alias only.            |
| Missing the active provider block                 | Add the block matching `agent_provider`: `claude:`, `codex:`, or `opencode:`.            |
| Changing `agent_provider` and expecting reload    | Restart dalang after provider changes.                                                   |
| Using `permission_mode: bypassPermissions`        | Use `auto` for headless Claude runs unless the user explicitly accepts the risk.          |
| Using `permission_mode: acceptEdits`              | Rejected by validation in v1. Use `auto`.                                                |
| Using Codex approval prompts                      | Use `approval_policy: never`; prompts deadlock unattended workers.                       |
| Omitting `opencode.model`                         | Add a required `provider/model` value such as `google/gemini-2.5-pro`.                   |
| Empty prompt body                                 | Loader emits `workflow_empty_prompt` and blocks dispatch. Always include instructions.   |
| Putting `WORKFLOW.md` in the dalang package       | It belongs alongside the target project, not the orchestrator source.                    |
| Putting front matter in imported files            | Only the root workflow file may have YAML front matter. Imported files are fragments.    |
| Using absolute, URL, or dynamic import paths      | Imports must be static relative `.md` files under the root workflow directory.           |
| Forgetting `branch_prefix`                        | Branches default to `<prefix><sanitized_identifier>`; prefixes avoid ordinary branches.  |
| Inlining API keys or tokens                       | Prefer `$ENV_VAR` indirection so the workflow can be committed.                          |
| Enabling PR checks without a wait-state prompt    | The prompt must move PR-ready items to `Waiting PR Checks` for the reconciler to act.    |
| Adding `Waiting PR Checks` to dispatchable states | It is a waiting/reconciler state, not a normal agent-dispatch state.                     |
