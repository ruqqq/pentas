# pentas

A two-package Bun + TypeScript monorepo:

- **`@pentas/dalang`** — orchestrator daemon. Polls a control plane for owned work, dispatches per-item work to git-worktree workspaces, and runs Claude/Codex/opencode agent sessions.
- **`@pentas/papan`** — single-user issue control plane and inbox that dalang can drive against (REST API + minimal UI). Dalang can also use GitHub Projects v2 as a control plane.

The names are Malay/Indonesian: _pentas_ = stage, _dalang_ = puppeteer/mastermind, _papan_ = board.

## Prerequisites

- [Bun](https://bun.sh/) ≥ 1.3
- `git` ≥ 2.30
- [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) (`claude`) on `$PATH`, signed into a Claude Max subscription (`claude /login`)
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
```

`tracker:` remains accepted as a temporary compatibility alias for Papan workflows.

Optional `repo:` block to enable git worktrees:

```yaml
repo:
  url: git@github.com:me/myproject.git
  default_branch: main
  branch_prefix: pentas/
```

When `repo:` is present, dalang creates a shared bare clone at `<workspace.root>/.repo.git` and per-issue worktrees beneath it.

### 3. Start dalang

```bash
bun run packages/dalang/src/index.ts ./WORKFLOW.md --port 7474
```

Then open <http://127.0.0.1:7474/> for the dashboard. JSON state at `/api/v1/state`. Manual reconcile via `POST /api/v1/refresh`.

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
