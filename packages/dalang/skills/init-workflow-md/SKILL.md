---
name: init-workflow-md
description: Use when the user wants to create, scaffold, or initialize a WORKFLOW.md file for dalang (the Symphony-style orchestrator). Produces a valid YAML front matter + Liquid prompt body that dalang's WorkflowLoader will accept on first load.
---

# Initialize a dalang WORKFLOW.md

dalang loads a root `WORKFLOW.md` consisting of YAML front matter (config) plus a Liquid prompt body. The body may be split into relative markdown imports with `@path/to/file.md`; dalang assembles imports before Liquid rendering. This skill walks through producing a valid workflow from scratch.

Spec source of truth: `docs/superpowers/specs/2026-04-29-dalang-orchestrator-design.md` §6 (with the `Waiting PR Checks` extension in `2026-04-30-pr-checks-wait-design.md`).

## Step 1 — confirm inputs with the user

Ask only for what cannot be inferred. Defaults in parentheses are safe to assume silently.

Required:

1. **Target path** — where should the file land? (Default: `WORKFLOW.md` in the project the agent will operate on, NOT in the dalang repo itself.)
2. **Tracker endpoint + port** — papan URL (default `http://localhost:3001`).
3. **Repo URL** — the source repo dalang clones into worktrees (e.g. `git@github.com:me/myproject.git`). If absent, omit the whole `repo:` block (Symphony pure-hook mode).
4. **Default branch** — usually `main`.
5. **Branch prefix** — e.g. `pentas/` or `agent/`.
6. **Workspace root** — absolute or `~`-prefixed path where worktrees go (default `~/.dalang/workspaces`).
7. **Active / terminal states** — match the tracker's state names. Defaults: active `[Todo, "In Progress"]`, terminal `[Done, Cancelled, Duplicate]`.

Confirm before writing if any of these are non-obvious.

## Step 2 — pick safe defaults

| Field                         | Default           | Notes                                                                       |
| ----------------------------- | ----------------- | --------------------------------------------------------------------------- |
| `tracker.kind`                | `papan`           | only supported value in v1                                                  |
| `tracker.api_key`             | `$PENTAS_API_KEY` | use `$VAR` indirection; omit on localhost without auth                      |
| `tracker.board`               | `null`            | reserved for future multi-board                                             |
| `polling.interval_ms`         | `30000`           |                                                                             |
| `agent.max_concurrent_agents` | `4`               | lowered from Symphony default 10 (Claude Max session limits)                |
| `agent.max_turns`             | `20`              |                                                                             |
| `agent.max_retry_backoff_ms`  | `300000`          |                                                                             |
| `claude.executable_path`      | `claude`          | resolves on `PATH`                                                          |
| `claude.model`                | `claude-opus-4-7` |                                                                             |
| `claude.permission_mode`      | `auto`            | canonical. NOT `bypassPermissions`. `acceptEdits` is rejected by validation |
| `claude.turn_timeout_ms`      | `3600000`         | 1 h                                                                         |
| `claude.read_timeout_ms`      | `5000`            |                                                                             |
| `claude.stall_timeout_ms`     | `300000`          | 5 min; set `<= 0` to disable stall detection                                |
| `pr_checks.enabled`           | `false`           | turns the `Waiting PR Checks` reconciler on; opt-in                         |
| `pr_checks.poll_interval_ms`  | `60000`           | per-issue throttle for `gh pr checks` polls                                 |
| `pr_checks.failure_budget`    | `3`               | red-CI bounces tolerated before escalation to `Ready for Human Review`      |
| `pr_checks.rerun_flakes`      | `true`            | re-run failed checks once before counting as a real failure                 |
| `pr_checks.gh_executable`     | `gh`              | resolves on `PATH`; override if the CLI isn't in PATH                       |
| `server.port`                 | `0`               | ephemeral; CLI `--port` wins                                                |
| `hooks.timeout_ms`            | `60000`           |                                                                             |

## Step 3 — write the file

Prefer a split workflow for anything beyond a small prototype. Keep all config in the root file, and put the reusable prompt body under `workflow/`. Hooks: keep `after_create`/`before_run` populated with sensible bootstrap; set `after_run` and `before_remove` to `null` unless the user asked for cleanup.

### Markdown imports

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

### Recommended split template

Root `WORKFLOW.md`:

```markdown
---
tracker:
  kind: papan
  endpoint: http://localhost:3001
  api_key: $PENTAS_API_KEY
  board: null
  active_states: [Todo, "In Progress"]
  terminal_states: [Done, Cancelled, Duplicate]

repo:
  url: git@github.com:OWNER/REPO.git
  default_branch: main
  branch_prefix: pentas/

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

claude:
  executable_path: claude
  model: claude-opus-4-7
  permission_mode: auto
  turn_timeout_ms: 3600000
  read_timeout_ms: 5000
  stall_timeout_ms: 300000

# Optional: orchestrator-driven PR-checks waiting state.
# When enabled, the agent transitions Ready for Review → Waiting PR Checks
# (instead of going directly to Done). dalang then polls `gh pr checks`
# and either bounces back to In Dev with a [pr_checks_failed] comment
# or hands off to Ready for Human Review.
# See docs/superpowers/specs/2026-04-30-pr-checks-wait-design.md for details.
# Add "Waiting PR Checks" to the prompt body's state machine when enabling.
pr_checks:
  enabled: false
  poll_interval_ms: 60000
  failure_budget: 3
  rerun_flakes: true
  gh_executable: gh

server:
  port: 0
---

@workflow/preamble.md
@workflow/state-dispatch.md
```

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
@states/todo.md
@states/in-progress.md
@states/in-review.md
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
4. Commit and push.
5. Update the issue state using the papan API.
```

For very small workflows, an inline body is still valid; just put the prompt directly after the front matter instead of using imports.

```

## Liquid variables available

The prompt body is rendered per-attempt. Available bindings:

- `issue.id`, `issue.identifier`, `issue.title`, `issue.description`, `issue.state`, `issue.priority`, `issue.url`
- `issue.labels` — iterable: `{% for label in issue.labels %}{{ label }}{% endfor %}`
- `issue.blocked_by` — iterable list of blocker identifiers
- `recent_comments` and `recent_history` — newest-first slices of tracker activity
- `attempt` — empty on first run, integer on retry/continuation

Within a single agent run, follow-up turns use a short continuation prompt and keep the provider session context. When dalang schedules a later retry/continuation attempt, it renders the full workflow template again with `attempt` set. Keep durable workflow instructions in files, not in one-off agent replies.

## Hooks env vars

Hooks run as `bash -lc` with `cwd = workspace`. Available env: `WORKSPACE_PATH`, `ISSUE_ID`, `ISSUE_IDENTIFIER`, `ISSUE_STATE`, `ATTEMPT`, `BRANCH`, `REPO_URL`.

## Common mistakes

| Mistake | Fix |
| --- | --- |
| Using `permission_mode: bypassPermissions` | Use `auto` — canonical and the dalang default. |
| Using `permission_mode: acceptEdits` | Rejected at validation in v1. Use `auto`. |
| Empty prompt body | Loader emits `workflow_empty_prompt` and blocks dispatch. Always include real instructions. |
| Putting `WORKFLOW.md` in the dalang repo | It belongs alongside the *target* project (the one being worked on), not the orchestrator's source. |
| Putting front matter in imported files | Only the root workflow file may have YAML front matter. Imported files are prompt fragments. |
| Using absolute, URL, or dynamic import paths | Imports must be static relative `.md` files under the root workflow directory. |
| Forgetting `branch_prefix` | Branches default to `<prefix><sanitized_identifier>`; without a prefix, branch names collide with normal dev branches. |
| Inlining the api key | Prefer `$PENTAS_API_KEY` so the file is committable. |
| Setting `agent.max_concurrent_agents: 10` | Claude Max session limits make 4 the practical ceiling. |
| Omitting `repo:` while expecting worktrees | Without `repo.*`, dalang only ensures the directory exists; bootstrap must happen in `after_create`. |
| Setting `pr_checks.enabled: true` without a `Waiting PR Checks` branch in the prompt body | The agent will reach a state with no instructions. Add an explicit case (or a guard that exits cleanly), and update the prompt's pipeline diagram so the agent transitions `Ready for Review → Waiting PR Checks` instead of `Ready for Review → Done`. |
| Adding `Waiting PR Checks` to `tracker.active_states` | Don't. dalang's reconciler reads it via a separate fetch; the dispatcher must NOT pick up these tickets, otherwise an agent will run on a state it shouldn't drive. |

## After writing

1. Confirm the path with the user and read it back briefly.
2. Suggest `dalang --workflow <path> --port <p>` (or whatever the project's invocation is) as the next step.
3. Note that root and imported markdown files are hot-reloaded via chokidar + mtime defensive reload — edits take effect on the next poll tick without restart.
```
