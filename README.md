# pentas

A two-package Bun + TypeScript monorepo:

- **`@pentas/dalang`** — orchestrator daemon. Polls a control plane for owned work, dispatches per-item work to git-worktree workspaces, and runs Claude/Codex/opencode agent sessions.
- **`@pentas/papan`** — single-user issue control plane and inbox that dalang can drive against (REST API + minimal UI). Dalang can also use GitHub Projects v2 as a control plane.

The names are Malay/Indonesian: _pentas_ = stage, _dalang_ = puppeteer/mastermind, _papan_ = board.

## Prerequisites

- [Bun](https://bun.sh/) ≥ 1.3
- `git` ≥ 2.30
- [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) (`claude`) on `$PATH`, signed into a Claude Max subscription (`claude /login`)
- [Codex CLI](https://github.com/openai/codex) (`codex`) on `$PATH`, signed in with `codex login` when using `agent_provider: codex`
- [GitHub CLI](https://cli.github.com/) (`gh`) on `$PATH`, authenticated with `repo` and `project` scopes when using GitHub Projects:
  ```bash
  gh auth login -h github.com -s repo,project
  ```
- macOS or Linux

## Install

```bash
git clone <this-repo> pentas
cd pentas
bun install
```

## Repository layout

```
pentas/
├── package.json                 # Bun workspaces root, top-level scripts
├── tsconfig.base.json           # shared TypeScript config (tsgo)
├── oxlint.json
├── bunfig.toml
├── packages/
│   ├── dalang/                  # orchestrator daemon
│   └── papan/                  # local control plane
└── docs/superpowers/
    ├── specs/                   # design specs
    └── plans/                   # implementation plans
```

## Top-level scripts

Run from the repo root:

```bash
bun run typecheck      # tsgo --noEmit on every workspace
bun run lint           # oxlint
bun run format         # oxfmt (writes)
bun run format:check   # oxfmt --check
bun run build          # compile dist/dalang and dist/papan
bun test               # bun test on every package
```

## Running locally

### 1. Start papan (optional local control plane)

```bash
cd packages/papan
bun run start
```

Papan serves its UI and REST API at `http://localhost:3001` by default. See `packages/papan/README.md` (if present) or its source for endpoints.

### 2. Configure dalang

Create a `WORKFLOW.md` somewhere — typically the repo root or a project root. It is YAML front matter + a Liquid prompt template:

```yaml
---
control_plane:
  kind: papan
  endpoint: http://localhost:3001
  active_states: [Todo, "In Progress"]
  terminal_states: [Done, Cancelled, Duplicate]
workspace:
  root: ~/.dalang/workspaces
agent:
  max_concurrent_agents: 1
  max_turns: 5
claude:
  executable_path: claude
  model: claude-opus-4-7
  permission_mode: auto
hooks:
  before_run: |
    bun install
---
You are picking up issue {{ issue.identifier }}: {{ issue.title }}.
Read the description, plan briefly, then proceed.
```

For GitHub Projects v2, use `control_plane.kind: github-projects` and set explicit ownership so dalang only picks up work intended for it:

```yaml
control_plane:
  kind: github-projects
  owner_type: user
  owner: ruqqq
  project_number: 1
  repository: ruqqq/pentas
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
```

`tracker:` remains accepted as a temporary compatibility alias for Papan workflows.

For `github-projects`, `control_plane.token` is optional. If it is omitted, dalang uses `GITHUB_TOKEN` when set and otherwise falls back to `gh auth token`. Set `token: $SOME_ENV_VAR` or a literal token only when the workflow should override the default credential source.

Optional `repo:` block to enable git worktrees:

```yaml
repo:
  url: git@github.com:me/myproject.git
  default_branch: main
  branch_prefix: pentas/
```

When `repo:` is present, dalang creates a shared bare clone at `<workspace.root>/.repo.git` and per-issue worktrees beneath it.

#### GitHub Projects setup with `gh`

This repo's root `WORKFLOW.md` is set up for a GitHub Projects v2 board called `Pentas`, owned by `ruqqq`, with Codex as the agent provider. To recreate that board from a fresh account:

```bash
gh auth login -h github.com -s repo,project
gh project create --owner ruqqq --title Pentas --format json
gh project link 1 --owner ruqqq --repo pentas
```

Add the custom fields:

```bash
gh project field-create 1 --owner ruqqq --name Agent \
  --data-type SINGLE_SELECT \
  --single-select-options dalang,human,paused

gh project field-create 1 --owner ruqqq --name Branch \
  --data-type TEXT

gh project field-create 1 --owner ruqqq --name Priority \
  --data-type SINGLE_SELECT \
  --single-select-options P0,P1,P2,P3

gh project field-create 1 --owner ruqqq --name Area \
  --data-type SINGLE_SELECT \
  --single-select-options dalang,papan,docs,tooling,repo
```

GitHub creates a built-in `Status` field automatically. Keep that field and update its options rather than creating a separate status field. The plain `gh project` commands do not expose option editing for an existing single-select field, so use GraphQL:

```bash
STATUS_FIELD_ID="$(gh project field-list 1 --owner ruqqq --format json \
  --jq '.fields[] | select(.name == "Status") | .id')"

gh api graphql -f query="mutation {
  updateProjectV2Field(input: {
    fieldId: \"$STATUS_FIELD_ID\",
    singleSelectOptions: [
      { name: \"Inbox\", color: GRAY, description: \"Newly captured work, not dispatched yet.\" },
      { name: \"Ready for Planning\", color: BLUE, description: \"Ready for an agent to clarify requirements and produce a plan.\" },
      { name: \"Planning\", color: BLUE, description: \"Plan creation is in progress.\" },
      { name: \"Plan Review\", color: PURPLE, description: \"Plan quality review is in progress.\" },
      { name: \"Ready for Dev\", color: YELLOW, description: \"Approved plan, ready for implementation.\" },
      { name: \"In Dev\", color: ORANGE, description: \"Implementation is in progress.\" },
      { name: \"Ready for Review\", color: PINK, description: \"Implementation is complete and should be reviewed by an agent before handoff.\" },
      { name: \"Waiting PR Checks\", color: YELLOW, description: \"PR exists and dalang is reconciling CI.\" },
      { name: \"Ready for Human Review\", color: PURPLE, description: \"CI passed or automated review has escalated to a human.\" },
      { name: \"Blocked\", color: RED, description: \"Waiting on external input; not dispatched.\" },
      { name: \"Done\", color: GREEN, description: \"Terminal complete state.\" },
      { name: \"Cancelled\", color: GRAY, description: \"Terminal abandoned state.\" },
      { name: \"Duplicate\", color: GRAY, description: \"Terminal duplicate state.\" }
    ]
  }) { projectV2Field { ... on ProjectV2SingleSelectField { name options { name } } } }
}"
```

Verify the final board:

```bash
gh project view 1 --owner ruqqq --format json
gh project field-list 1 --owner ruqqq --format json
```

Every issue that dalang should pick up must be added to the project, have `Agent = dalang`, and be in one of the configured active `Status` values. `Blocked`, `Inbox`, `Waiting PR Checks`, `Ready for Human Review`, and terminal states are intentionally not directly dispatched by the normal poll loop.

When an agent moves an item from one active `Status` to another, dalang ends the current provider session. The next poll dispatches a fresh session for the new column, so the agent receives the full state-specific workflow prompt instead of a generic continuation prompt.

Agent-authored GitHub comments must start with `[AGENT MESSAGE]` on the first line. This keeps automation comments identifiable even when GitHub attributes them to the user token that dalang is running with.

#### Codex agent provider

For Codex-driven runs, use:

```yaml
agent_provider: codex
codex:
  executable_path: codex
  model: gpt-5.5
  sandbox_mode: danger-full-access
  approval_policy: never
  network_access_enabled: true
  turn_timeout_ms: 3600000
  read_timeout_ms: 5000
  stall_timeout_ms: 300000
```

`approval_policy: never` is the headless setting. Interactive approval prompts would deadlock an unattended dalang worker. Use `sandbox_mode: danger-full-access` for workflows where the agent must stage, commit, or push; Codex `workspace-write` can edit files, but its sandbox mounts `.git` read-only. `network_access_enabled` defaults to `true` for Codex so GitHub handoff commands can comment, push, and update Project fields.

#### Sandboxed workers

dalang can run provider sessions inside per-task Docker containers by setting `sandbox.enabled: true`. This is the recommended mode for project-specific devcontainers and long-running Codex work because the agent gets the target repository's tools, services, and dependencies without inheriting the host environment wholesale.

See `packages/dalang/README.md` for the full sandbox model, including devcontainer compose support, credential projection, `GH_TOKEN`/Cloudflare token passing, git identity setup, the worker shim, and `dalang sandbox doctor`.

#### Workflow prompt and agent skills

Repo-local generic agents skills live under `.agents/skills/`. The `init-workflow-md` skill there scaffolds dalang-compatible `WORKFLOW.md` files with current control-plane, provider, and PR-checks settings.

For anything beyond a prototype, keep the root `WORKFLOW.md` small and import prompt fragments from `workflow/`:

```markdown
@workflow/preamble.md
@workflow/project-board.md
@workflow/superpowers.md
@workflow/state-dispatch.md
```

The `workflow/superpowers.md` fragment tells the agent when to use installed skills during the state machine:

- `prd` for product requirements and acceptance criteria during planning.
- `create-architectural-decision-record` for durable architecture choices.
- `architecture-blueprint-generator` for broad architecture mapping.
- `code-review` during `Plan Review` and `Ready for Review`.
- `github:yeet` to push branches and open draft PRs.
- `github:gh-fix-ci` when PR checks fail.
- `github:gh-address-comments` when human PR review comments need changes.
- `ruqqq-voice` for PR descriptions, review comments, and project comments.

Each state fragment under `workflow/states/` should do one job: explain the current `Status`, required evidence, verification expectations, comments to leave, and the next `Status` transition.

### 3. Start dalang

```bash
bun run packages/dalang/src/index.ts ./WORKFLOW.md --port 7474
```

Then open <http://127.0.0.1:7474/> for the dashboard. Running sessions link to `/sessions/:id`, which renders the provider JSONL transcript with parsed events and expandable raw lines. JSON state is available at `/api/v1/state`, and parsed session JSON at `/api/v1/sessions/:id/transcript`. Manual reconcile via `POST /api/v1/refresh`.

`WORKFLOW.md` is hot-reloaded — edit and save it, dalang picks up the new config (validation failures keep the last-good config).

Stop with Ctrl+C.

## Running tests

```bash
bun test                                  # whole repo
bun test packages/dalang/                 # dalang only
bun test packages/dalang/tests/orchestrator/  # one directory
```

Tests are real — no React component rendering, no mocking of the database. Bun-native test runner. Hot-path logic lives in pure modules; UI logic is extracted into hooks/functions and unit-tested.

## Documentation

- Design specs: `docs/superpowers/specs/`
- Implementation plans: `docs/superpowers/plans/`
- AI-assistant guide: `CLAUDE.md`
