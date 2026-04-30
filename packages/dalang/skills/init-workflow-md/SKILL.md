---
name: init-workflow-md
description: Use when the user wants to create, scaffold, or initialize a WORKFLOW.md file for dalang (the Symphony-style orchestrator). Produces a valid YAML front matter + Liquid prompt body that dalang's WorkflowLoader will accept on first load.
---

# Initialize a dalang WORKFLOW.md

dalang loads a single `WORKFLOW.md` consisting of YAML front matter (config) plus a Liquid prompt body. This skill walks through producing a valid file from scratch.

Spec source of truth: `docs/superpowers/specs/2026-04-29-dalang-orchestrator-design.md` §6.

## Step 1 — confirm inputs with the user

Ask only for what cannot be inferred. Defaults in parentheses are safe to assume silently.

Required:
1. **Target path** — where should the file land? (Default: `WORKFLOW.md` in the project the agent will operate on, NOT in the dalang repo itself.)
2. **Tracker endpoint + port** — wayang URL (default `http://localhost:3001`).
3. **Repo URL** — the source repo dalang clones into worktrees (e.g. `git@github.com:me/myproject.git`). If absent, omit the whole `repo:` block (Symphony pure-hook mode).
4. **Default branch** — usually `main`.
5. **Branch prefix** — e.g. `juara/` or `agent/`.
6. **Workspace root** — absolute or `~`-prefixed path where worktrees go (default `~/.dalang/workspaces`).
7. **Active / terminal states** — match the tracker's state names. Defaults: active `[Todo, "In Progress"]`, terminal `[Done, Cancelled, Duplicate]`.

Confirm before writing if any of these are non-obvious.

## Step 2 — pick safe defaults

| Field | Default | Notes |
| --- | --- | --- |
| `tracker.kind` | `tok-juara` | only supported value in v1 |
| `tracker.api_key` | `$TOK_JUARA_API_KEY` | use `$VAR` indirection; omit on localhost without auth |
| `tracker.board` | `null` | reserved for future multi-board |
| `polling.interval_ms` | `30000` | |
| `agent.max_concurrent_agents` | `4` | lowered from Symphony default 10 (Claude Max session limits) |
| `agent.max_turns` | `20` | |
| `agent.max_retry_backoff_ms` | `300000` | |
| `claude.executable_path` | `claude` | resolves on `PATH` |
| `claude.model` | `claude-opus-4-7` | |
| `claude.permission_mode` | `auto` | canonical. NOT `bypassPermissions`. `acceptEdits` is rejected by validation |
| `claude.turn_timeout_ms` | `3600000` | 1 h |
| `claude.read_timeout_ms` | `5000` | |
| `claude.stall_timeout_ms` | `300000` | 5 min; set `<= 0` to disable stall detection |
| `server.port` | `0` | ephemeral; CLI `--port` wins |
| `hooks.timeout_ms` | `60000` | |

## Step 3 — write the file

Use this template verbatim, substituting the user's values. Hooks: keep `after_create`/`before_run` populated with sensible bootstrap; set `after_run` and `before_remove` to `null` unless the user asked for cleanup.

```markdown
---
tracker:
  kind: tok-juara
  endpoint: http://localhost:3001
  api_key: $TOK_JUARA_API_KEY
  board: null
  active_states: [Todo, "In Progress"]
  terminal_states: [Done, Cancelled, Duplicate]

repo:
  url: git@github.com:OWNER/REPO.git
  default_branch: main
  branch_prefix: juara/

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

server:
  port: 0
---

# Working on {{ issue.identifier }}: {{ issue.title }}

{% if attempt %}
This is retry attempt {{ attempt }}. Inspect the workspace state before re-running — uncommitted changes from prior attempts are preserved.
{% endif %}

## Description

{{ issue.description }}

## Workflow

1. Read the issue and confirm requirements.
2. Implement the change.
3. Run tests; ensure they pass.
4. Commit, push, and open a PR via `gh`.
5. Update the issue state to `In Review` via the wayang API at {{ '{{' }} tracker endpoint configured above {{ '}}' }}/api/v1/issues/{{ issue.id }}.
```

## Liquid variables available

The prompt body is rendered per-attempt. Available bindings:

- `issue.id`, `issue.identifier`, `issue.title`, `issue.description`, `issue.state`, `issue.priority`, `issue.url`
- `issue.labels` — iterable: `{% for label in issue.labels %}{{ label }}{% endfor %}`
- `issue.blocked_by` — iterable list of blocker identifiers
- `attempt` — empty on first run, integer on retry/continuation

Continuation turns omit the prompt — only the first turn renders the template, so put all instructions there.

## Hooks env vars

Hooks run as `bash -lc` with `cwd = workspace`. Available env: `WORKSPACE_PATH`, `ISSUE_ID`, `ISSUE_IDENTIFIER`, `ISSUE_STATE`, `ATTEMPT`, `BRANCH`, `REPO_URL`.

## Common mistakes

| Mistake | Fix |
| --- | --- |
| Using `permission_mode: bypassPermissions` | Use `auto` — canonical and the dalang default. |
| Using `permission_mode: acceptEdits` | Rejected at validation in v1. Use `auto`. |
| Empty prompt body | Loader emits `workflow_empty_prompt` and blocks dispatch. Always include real instructions. |
| Putting `WORKFLOW.md` in the dalang repo | It belongs alongside the *target* project (the one being worked on), not the orchestrator's source. |
| Forgetting `branch_prefix` | Branches default to `<prefix><sanitized_identifier>`; without a prefix, branch names collide with normal dev branches. |
| Inlining the api key | Prefer `$TOK_JUARA_API_KEY` so the file is committable. |
| Setting `agent.max_concurrent_agents: 10` | Claude Max session limits make 4 the practical ceiling. |
| Omitting `repo:` while expecting worktrees | Without `repo.*`, dalang only ensures the directory exists; bootstrap must happen in `after_create`. |

## After writing

1. Confirm the path with the user and read it back briefly.
2. Suggest `dalang --workflow <path> --port <p>` (or whatever the project's invocation is) as the next step.
3. Note that the file is hot-reloaded via chokidar + mtime defensive reload — edits take effect on the next poll tick without restart.
