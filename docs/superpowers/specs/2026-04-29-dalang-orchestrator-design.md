# Dalang Orchestrator — Design

Status: Draft v1
Date: 2026-04-29
Author: ruqqq

## 1. Purpose

`dalang` is a long-running daemon that orchestrates Claude Code agents to work issues from a custom in-house issue tracker (`wayang`). It is a tok-juara-flavored implementation of the [Symphony Service Specification](https://github.com/openai/symphony/blob/main/SPEC.md), with three substitutions:

- Codex app-server → **Claude Agent SDK** (subscription-auth, model `claude-opus-4-7`, permission mode `auto`).
- Linear → **wayang** (custom tracker; REST adapter; designed in a separate spec).
- Symphony's repo-agnostic posture → **single-repo + git-worktree** convenience layer, exposed as a documented Symphony extension.

Conformance posture: dalang aims to be Symphony-extension-clean. A WORKFLOW.md authored for dalang can be loaded by a stock Symphony implementation; only the dalang-specific extension keys (`repo.*`, `claude.*`) and the tracker kind `tok-juara` would be unrecognized.

## 2. Scope

### In scope (v1)
- Polling daemon with bounded concurrency, retries, and reconciliation against `wayang`.
- Per-issue git worktrees off a shared local clone.
- Claude Agent SDK-driven worker sessions with multi-turn continuation on a single thread.
- Hot-reloadable `WORKFLOW.md` (YAML front matter + Liquid prompt body).
- Structured JSON logs and an HTTP observability surface (`/api/v1/state`, `/api/v1/:identifier`, `/api/v1/refresh`, `/`).
- Bun-native monorepo workspace; `dalang` and `wayang` live as sibling packages.

### Out of scope (v1, deferred)
- Persistence layer (in-memory scheduler state only, per Symphony §14.3).
- SSH worker pool (Symphony Appendix A).
- Multi-repo per orchestrator instance.
- tmux integration (HTTP log surface replaces it).
- Pluggable tracker adapters beyond `tok-juara`.
- Tracker write APIs in the orchestrator itself (writes happen via Claude tool use against the wayang REST API).

## 3. Repository Layout

```
tok-juara/
├── packages/
│   ├── dalang/              # this spec
│   │   ├── src/
│   │   ├── tests/
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── wayang/              # designed in separate spec; stub here
├── docs/
│   └── superpowers/specs/
├── package.json             # bun workspaces root
├── tsconfig.base.json       # tsgo settings shared by packages
├── oxlint.json
├── .oxfmtrc
└── README.md
```

Bun's native workspace support (`"workspaces": ["packages/*"]`) is sufficient for two packages. Turborepo can be added later without restructuring.

## 4. Stack & Harness

| Concern        | Tool                                    |
| -------------- | --------------------------------------- |
| Runtime        | Bun (latest stable)                     |
| Language       | TypeScript                              |
| Type checker   | `tsgo` (typescript-native preview)      |
| Linter         | `oxlint`                                |
| Formatter      | `oxfmt`                                 |
| Test runner    | `bun test`                              |
| Agent SDK      | `@anthropic-ai/claude-agent-sdk` (Node) |
| YAML parser    | `yaml`                                  |
| Template engine| `liquidjs` (strict mode)                |
| File watcher   | `chokidar`                              |
| HTTP server    | `Bun.serve` (built-in)                  |
| Logger         | `pino` (JSON, structured)               |

### Testing rules (binding)

- No React Testing Library or component-rendering tests in either package.
- Component logic is extracted into hooks/pure functions; those are unit-tested directly with `bun test`.
- Integration tests are gated behind `RUN_INTEGRATION=1`.

### Auth

dalang invokes Claude through the Agent SDK in **subscription-auth mode**, inheriting the host machine's logged-in `claude` CLI session (Claude Max). No `ANTHROPIC_API_KEY` is required or used. The orchestrator MUST NOT prompt for or set a per-token API key for the SDK; doing so would route through API billing instead of the subscription.

## 5. Domain Model

Dalang adopts Symphony's normalized issue, workflow, workspace, run-attempt, live-session, retry-entry, and orchestrator-runtime-state models verbatim (Symphony §4). The only adjustments are renamed identifiers in `LiveSession` to drop "codex":

| Symphony field             | Dalang field                |
| -------------------------- | --------------------------- |
| `codex_app_server_pid`     | `claude_session_pid`        |
| `last_codex_event`         | `last_event`                |
| `last_codex_timestamp`     | `last_event_at`             |
| `last_codex_message`       | `last_message`              |
| `codex_input_tokens`       | `input_tokens`              |
| `codex_output_tokens`      | `output_tokens`             |
| `codex_total_tokens`       | `total_tokens`              |
| `codex_totals` (state)     | `claude_totals`             |
| `codex_rate_limits`        | `rate_limits`               |

`session_id = "<thread_id>-<turn_id>"` is preserved. `thread_id` maps to the Agent SDK session UUID; `turn_id` is a monotonic per-turn counter within that session.

Workspace key sanitization rule from Symphony §4.2 is preserved: any character not in `[A-Za-z0-9._-]` is replaced with `_`.

## 6. WORKFLOW.md Schema

Symphony §5 verbatim, with substitutions and one extension block.

### 6.1 Front matter

```yaml
---
tracker:
  kind: tok-juara                       # only supported value in v1
  endpoint: http://localhost:3001
  api_key: $TOK_JUARA_API_KEY           # optional in v1; localhost may run unauthenticated
  active_states: [Todo, "In Progress"]
  terminal_states: [Done, Cancelled, Duplicate]

# Extension key (tok-juara). Symphony stock implementations ignore this block.
# When absent, dalang falls back to Symphony's pure hook-driven workspace model:
# the workspace is a sanitized empty directory and `after_create` is responsible for
# any repo bootstrap (e.g., `git clone .`).
repo:
  url: git@github.com:me/myproject.git  # source clone; mirrored locally
  default_branch: main
  branch_prefix: juara/                 # branch = <prefix><sanitized_identifier>

polling:
  interval_ms: 30000

workspace:
  root: ~/.dalang/workspaces            # absolute path; ~ and $VAR expanded

hooks:
  after_create: |
    bun install
  before_run: |
    git fetch origin
  after_run: null
  before_remove: null
  timeout_ms: 60000

agent:
  max_concurrent_agents: 4              # lowered from Symphony default 10 (Claude Max session limits)
  max_turns: 20
  max_retry_backoff_ms: 300000
  max_concurrent_agents_by_state: {}

claude:
  command: claude                       # CLI binary the SDK shells to internally
  model: claude-opus-4-7                # NEW vs Symphony — Symphony has no model selector
  permission_mode: auto                 # canonical Claude Code mode; alternatives:
                                        # acceptEdits, default, plan, bypassPermissions
  turn_timeout_ms: 3600000
  read_timeout_ms: 5000
  stall_timeout_ms: 300000

server:
  port: 0                               # 0 = ephemeral; CLI --port wins
---

You are working on issue {{ issue.identifier }}: {{ issue.title }}.

{% if attempt %}
This is retry attempt {{ attempt }}. Review the workspace state before re-running.
{% endif %}

Description:
{{ issue.description }}

Workflow:
1. Read the issue and understand the requirements.
2. Implement the change.
3. Run tests and ensure they pass.
4. Commit, push, and open a PR via `gh`.
5. Update the issue state to `In Review` via the wayang API.
```

### 6.2 Hooks contract

Hooks run in `bash -lc <script>` with the workspace as `cwd`. The following env vars are exported:

- `WORKSPACE_PATH` — absolute path to the per-issue workspace
- `ISSUE_ID` — stable tracker-internal id
- `ISSUE_IDENTIFIER` — human-readable key (e.g. `JUARA-12`)
- `ISSUE_STATE` — current normalized state name
- `ATTEMPT` — empty on first run, integer on retry/continuation
- `BRANCH` — `<repo.branch_prefix><sanitized_identifier>` if `repo.*` is configured
- `REPO_URL` — value of `repo.url` if configured

Failure semantics match Symphony §9.4 verbatim.

### 6.3 Hot reload

Watched via `chokidar`. On change:
1. Re-parse front matter and prompt body.
2. Validate. Invalid → keep last-good `effectiveConfig`, log warning, emit `workflow_reload_failed` log event. Service does not crash.
3. Valid → atomically swap `effectiveConfig` and `promptTemplate`. Future ticks/dispatches/retries pick up new values.
4. In-flight workers keep their original prompt and policies until the next attempt.

### 6.4 Repo extension semantics

When `repo.url` is present:
1. On first run, dalang clones `repo.url` as a bare repo under `<workspace.root>/.repo.git` — this is the **shared clone**. Subsequent runs reuse it.
2. On workspace creation for issue `<id>` (workspace path does not yet exist):
   - Compute branch name `<branch_prefix><sanitized_identifier>`.
   - `git -C <shared_clone> fetch origin`
   - If branch exists in the shared clone (or on the remote, fetched above) → `git -C <shared_clone> worktree add <workspace_path> <branch>` (reuse existing branch as-is).
   - If branch does not exist → `git -C <shared_clone> worktree add <workspace_path> -b <branch> origin/<default_branch>` (create new branch from upstream base).
3. On workspace **reuse** (workspace path already exists, retry/continuation): no git operations beyond what `before_run` does. Preserve in-progress changes across attempts.
4. On terminal cleanup: `git -C <shared_clone> worktree remove --force <workspace_path>` then remove the directory if it remains. The branch is left in the shared clone (not deleted), in case the agent has already pushed it.

This means retries preserve uncommitted work in the worktree by default. The `before_run` hook is the place to opt into stricter behavior (e.g., `git reset --hard origin/<branch>`) if a deployment wants it.

When `repo.*` is **absent**, dalang's workspace manager only ensures the directory exists (Symphony §9.2 verbatim) and runs `after_create`/`before_run` for bootstrap.

## 7. Architecture

```
┌───────────────────────────────────────────────────────────────┐
│                      dalang (bun process)                      │
│                                                                │
│  ┌──────────────┐   ┌──────────────────┐   ┌────────────┐      │
│  │WorkflowLoader│──▶│  Orchestrator    │◀──│ HTTP Server│      │
│  │ (yaml +      │   │  (poll loop,     │   │ (state,    │      │
│  │  liquidjs)   │   │   in-mem state,  │   │  refresh)  │      │
│  └──────┬───────┘   │   retries)       │   └────────────┘      │
│         │ chokidar  └────────┬─────────┘                       │
│         │                    │                                 │
│  ┌──────▼───────┐            │                                 │
│  │  Logger      │            │                                 │
│  │  (pino)      │            ▼                                 │
│  └──────────────┘   ┌──────────────────┐  ┌──────────────────┐ │
│                     │ WorkspaceManager │  │ TrackerAdapter   │ │
│                     │ (git worktree)   │  │ (REST → wayang)  │ │
│                     └────────┬─────────┘  └────────┬─────────┘ │
│                              │                     │           │
│                              ▼                     │           │
│                     ┌──────────────────┐           │           │
│                     │   AgentRunner    │           │           │
│                     │ (claude-agent-sdk│           │           │
│                     │  per worker)     │           │           │
│                     └──────────────────┘           │           │
└────────────────────────────────────────────────────┼───────────┘
                                                     │ HTTP/JSON
                                                     ▼
                                            ┌────────────────┐
                                            │ wayang (bun)   │
                                            │ separate spec  │
                                            └────────────────┘
```

### 7.1 Components

1. **WorkflowLoader** — reads `WORKFLOW.md`, splits front matter and prompt body, validates with a typed schema, exposes `{config, promptTemplate}`. Hot-reloads via chokidar.

2. **Config Layer** — typed getters over `WorkflowDefinition.config`. Resolves `$VAR` indirection, expands `~` for path values, normalizes `workspace.root` to absolute. Supplies defaults from §6.1.

3. **TrackerAdapter** — REST client against wayang. Methods:
   - `fetchCandidateIssues()` — issues in `tracker.active_states`
   - `fetchIssuesByStates(states)` — used by startup terminal cleanup
   - `fetchIssueStatesByIds(ids)` — used by reconciliation
   - `fetchIssue(id)` — detail, used by agent context if needed
   Auth header: `Authorization: Bearer <api_key>` if set. Network timeout 30 s. Pagination via `?cursor=`.

4. **Orchestrator** — owns the poll loop and the single source of truth for scheduling state. All mutations go through one async event channel (a TS async generator or a mailbox-style queue) to avoid the shared-mutable-state bug surface. Tracks `running`, `claimed`, `retry_attempts`, `completed`, `claude_totals`, `rate_limits`.

5. **WorkspaceManager** — derives sanitized workspace key, creates the worktree (or plain dir when `repo.*` is absent), runs hooks with timeouts, enforces the path-containment invariant.

6. **AgentRunner** — composes workspace + rendered prompt + Claude Agent SDK call. Streams SDK messages back to the orchestrator via an event channel. Handles continuation loop up to `agent.max_turns`.

7. **HTTP Server** — observability + control. Routes per Symphony §13.7. Loopback by default; CLI `--port` wins over `server.port`.

8. **Logger** — pino with stable `key=value` field semantics. Required context fields:
   - `issue_id`, `issue_identifier` for issue-related logs
   - `session_id` for agent lifecycle logs

### 7.2 Concurrency model

Workers are async tasks (not subprocesses). Each `runAttempt(issue)` is an `async` function driven by the Agent SDK's `query()` async iterator. Concurrency is bounded by the orchestrator's slot bookkeeping (`running.size < agent.max_concurrent_agents`).

Cancellation is via `AbortController` — the orchestrator owns one per running attempt. Stall detection or terminal/non-active reconciliation calls `abort()`, which propagates into the SDK call and unwinds the worker.

## 8. State Machine

Symphony §7 verbatim:

- **Issue orchestration states:** `Unclaimed`, `Claimed`, `Running`, `RetryQueued`, `Released`.
- **Run-attempt phases:** `PreparingWorkspace`, `BuildingPrompt`, `LaunchingAgent`, `InitializingSession`, `StreamingTurn`, `Finishing`, `Succeeded`, `Failed`, `TimedOut`, `Stalled`, `CanceledByReconciliation`.
- **Multi-turn continuation:** after a successful turn, re-fetch issue state. If still active and `turn_count < max_turns`, start a new turn on the **same SDK session** with continuation guidance only (no full prompt resend). Worker exits and orchestrator schedules a 1 s continuation retry.
- **Idempotency:** `claimed` and `running` checks are required before launching any worker. Reconciliation runs before dispatch on every tick.

## 9. Polling, Scheduling, Reconciliation

Symphony §8 verbatim. Tick sequence:

1. Reconcile running issues:
   - **Stall check:** if `now - last_event_at > claude.stall_timeout_ms`, abort the worker and queue a retry. Skip if `stall_timeout_ms <= 0`.
   - **Tracker state refresh:** `fetchIssueStatesByIds(running_ids)`. For each: terminal → terminate + cleanup workspace; active → update in-memory snapshot; neither → terminate without cleanup. State-refresh failure → keep workers running, retry next tick.
2. Run dispatch preflight validation (workflow loadable, `tracker.kind` supported, `tracker.api_key` resolved if required, `claude.command` non-empty).
3. Fetch candidate issues via `fetchCandidateIssues()`.
4. Sort: `priority` asc (nulls last), `created_at` asc, `identifier` lex.
5. Dispatch eligible issues until slots are exhausted. Eligibility:
   - has `id`, `identifier`, `title`, `state`
   - state ∈ `active_states`, ∉ `terminal_states`
   - not in `running`, not in `claimed`
   - global slots available, per-state slots available
   - if state == `Todo`: all blockers in terminal state
6. Notify HTTP/log observers.

Retry/backoff:
- Continuation retry after clean worker exit: 1000 ms fixed.
- Failure retry: `delay = min(10000 * 2^(attempt - 1), agent.max_retry_backoff_ms)`.
- Retry timer fires → re-fetch active candidates; re-dispatch if still eligible and slots available, else requeue with `"no available orchestrator slots"`, else release claim.

Startup terminal cleanup: `fetchIssuesByStates(terminal_states)`, remove each corresponding workspace directory. Failures logged and ignored.

## 10. Agent Runner Protocol

### 10.1 Launch contract

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";

const result = query({
  prompt: renderedPrompt,                       // first turn only; continuations omit this
  options: {
    cwd: workspace.path,                        // MUST equal workspace_path
    permissionMode: config.claude.permissionMode, // default "auto"
    model: config.claude.model,                 // "claude-opus-4-7"
    abortSignal: controller.signal,
    // SDK uses subscription auth automatically when ANTHROPIC_API_KEY is unset.
  },
});

for await (const msg of result) {
  // map to runtime events; forward to orchestrator
}
```

The orchestrator MUST:
- Validate `cwd === workspace_path` immediately before invoking `query()`.
- Validate `workspace_path` is a subpath of `workspace.root` (normalized absolute).
- Reject and fail the attempt if either invariant fails.

### 10.2 Session identifiers

- `thread_id` — extracted from the SDK session UUID exposed by the first system/init message.
- `turn_id` — monotonic counter incremented at each `query()` call within a session lifetime.
- `session_id = "<thread_id>-<turn_id>"`.
- Continuation turns reuse `thread_id`.

### 10.3 Multi-turn loop

```ts
let turn = 1;
while (true) {
  const prompt = turn === 1
    ? renderedPrompt
    : continuationGuidance(issue, turn, max_turns);

  const result = await runOneTurn({ prompt, session, abortSignal });
  if (!result.success) { fail(result.reason); break; }

  const refreshed = await tracker.fetchIssueStatesByIds([issue.id]);
  if (!refreshed.length) break;
  issue = refreshed[0];

  if (!isActive(issue.state)) break;
  if (turn >= config.agent.max_turns) break;

  turn += 1;
}
```

After exit, orchestrator schedules a 1 s continuation retry per Symphony §7.1.

### 10.4 Event emission

The agent runner translates SDK message types into Symphony-style runtime events forwarded to the orchestrator:

| SDK event                        | Emitted runtime event                |
| -------------------------------- | ------------------------------------ |
| First system/init message        | `session_started`                    |
| `assistant` text chunk           | `notification` (truncated)           |
| `tool_use`                       | `notification`                       |
| `tool_result`                    | `notification`                       |
| `result` (turn end)              | `turn_completed` (with usage)        |
| Abort due to stall/reconcile     | `turn_cancelled`                     |
| SDK error / subprocess exit      | `turn_failed` or `startup_failed`    |
| Permission denial (auto-mode)    | `approval_auto_denied` (notification)|
| Unsupported tool call            | `unsupported_tool_call`              |

Token accounting reads SDK `result.usage` — absolute totals, deltas tracked against `last_reported_*` (Symphony §13.5).

### 10.5 Approval policy

`claude.permission_mode: auto` is the default. Auto mode auto-approves tool calls with built-in safety checks; destructive/exfiltration actions are blocked by the SDK itself, not by dalang. dalang does not implement custom approval handlers in v1.

Operators who want stricter posture can set `permission_mode: acceptEdits` (auto-accept edits, prompt on shell — but dalang has no operator UI for prompts in v1, so this will fail any shell command). Production deployments should use `auto`.

User-input-required signals from the SDK are treated as **failure** (Symphony §10.5 example high-trust behavior). Run is failed; orchestrator schedules a backoff retry.

### 10.6 Timeouts

- `claude.read_timeout_ms` — applies to the initial SDK handshake/first message.
- `claude.turn_timeout_ms` — total budget for one turn; exceeded → `abort()` + `turn_timeout` event.
- `claude.stall_timeout_ms` — orchestrator-enforced based on event inactivity.

## 11. Tracker Contract (Stub for wayang Spec)

dalang treats the tracker through a typed adapter interface. The wayang implementation is designed in a separate spec, but the contract is fixed here.

### 11.1 REST endpoints (consumed by dalang)

```
GET  /api/v1/issues?state=Todo&state=In%20Progress[&cursor=...]
       → 200 { issues: NormalizedIssue[], next_cursor: string | null }

GET  /api/v1/issues?state=Done&state=Cancelled[&cursor=...]
       → 200 { issues: NormalizedIssue[], next_cursor: string | null }

GET  /api/v1/issues/by-ids?id=ID1&id=ID2&...
       → 200 { issues: NormalizedIssue[] }

GET  /api/v1/issues/:id
       → 200 NormalizedIssue | 404
```

### 11.2 NormalizedIssue (matches Symphony §4.1.1 exactly)

```ts
interface NormalizedIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  priority: number | null;
  state: string;
  branch_name: string | null;
  url: string | null;
  labels: string[];          // normalized lowercase
  blocked_by: { id: string | null; identifier: string | null; state: string | null }[];
  created_at: string | null; // ISO-8601
  updated_at: string | null; // ISO-8601
}
```

### 11.3 Auth

`Authorization: Bearer <tracker.api_key>` if set. v1 supports unauthenticated localhost mode (no header).

### 11.4 Endpoints out of scope for dalang

The following exist in wayang for the **agent** to call (via tool use), not for dalang:

```
PATCH /api/v1/issues/:id           # state transitions, field updates
POST  /api/v1/issues/:id/comments
POST  /api/v1/issues               # creation (out of orchestrator scope entirely)
```

dalang does not call these. Symphony §11.5 boundary is preserved: the orchestrator is a scheduler/runner and tracker reader; mutations happen through the agent.

## 12. HTTP Observability Surface

Symphony §13.7 verbatim, mounted on `Bun.serve`.

- `GET /` — server-rendered HTML dashboard. Lists running, retrying, recent completions, token totals, rate limits.
- `GET /api/v1/state` — JSON snapshot per Symphony §13.7.2 example shape.
- `GET /api/v1/:identifier` — issue detail; 404 with `{error:{code:"issue_not_found"}}` if unknown.
- `POST /api/v1/refresh` — queues an immediate poll+reconcile cycle; coalesces concurrent calls; 202 with operation summary.

Bind `127.0.0.1` by default. CLI `--port <n>` overrides `server.port`. Port `0` requests an ephemeral port. Restart-required to change `server.port` (acceptable per §13.7).

## 13. Failure Model

Categories (Symphony §14.1 + §10.6, renamed):

- **Workflow/config:** `missing_workflow_file`, `workflow_parse_error`, `workflow_front_matter_not_a_map`, `template_parse_error`, `template_render_error`, `unsupported_tracker_kind`, `missing_tracker_api_key`, `missing_repo_config`.
- **Workspace:** `workspace_create_error`, `worktree_add_failed`, `hook_failure`, `hook_timeout`, `invalid_workspace_cwd`.
- **Agent session:** `claude_not_found`, `response_timeout`, `turn_timeout`, `turn_failed`, `turn_cancelled`, `turn_input_required`, `subprocess_exit`.
- **Tracker:** `tracker_request_error`, `tracker_status_error`, `tracker_malformed_payload`, `tracker_missing_pagination_cursor`.
- **Observability:** `snapshot_timeout`, `snapshot_unavailable`.

Recovery (Symphony §14.2 verbatim):
- Dispatch validation fail → skip new dispatches, keep service alive, continue reconciliation.
- Worker fail → schedule backoff retry.
- Tracker candidate-fetch fail → skip tick.
- Reconciliation state-refresh fail → keep workers, retry next tick.
- HTTP/log failures → never crash orchestrator.

Restart recovery (Symphony §14.3): no retry timers or live sessions survive process restart. Service recovers via startup terminal cleanup + fresh polling + re-dispatch. Worktrees on disk are reused.

## 14. Security & Safety

### 14.1 Filesystem invariants

- Workspace path MUST stay under `workspace.root` (normalized absolute prefix check).
- Workspace key MUST be sanitized to `[A-Za-z0-9._-]`.
- Agent SDK `cwd` MUST equal the per-issue workspace path. Validated immediately before invocation.

### 14.2 Trust posture

dalang targets **trusted local environments** (operator's own machine, single-user). Default `permission_mode: auto` provides Claude Code's built-in safety checks (destructive/exfil action blocking). Operators running against externally-controlled tracker content SHOULD harden further:

- Restrict the `wayang` API to a known issue scope.
- Run dalang under a dedicated OS user with restricted file access.
- Use `permission_mode: acceptEdits` only with operator approval UI (not in v1; would degrade to failure on shell commands).

Hooks are arbitrary shell scripts from `WORKFLOW.md` and are fully trusted. Hook output is truncated in logs.

### 14.3 Secret handling

- `$VAR` indirection in WORKFLOW.md for `tracker.api_key` and path values.
- Secrets MUST NOT appear in logs. Token presence is validated without printing values.
- `ANTHROPIC_API_KEY` MUST NOT be set by dalang; subscription auth is mandatory.

## 15. CLI

```
dalang [path-to-WORKFLOW.md] [--port <n>]
```

- Positional argument: workflow path. Defaults to `./WORKFLOW.md`.
- `--port <n>`: overrides `server.port`. `0` for ephemeral.
- Exit codes: `0` on clean shutdown, non-zero on startup failure or abnormal exit.
- Startup: validate config → startup terminal cleanup → schedule immediate tick → run event loop.

## 16. Test Matrix

Mapped from Symphony §17.

### Core conformance (`bun test`)

- **Workflow loader & config**
  - explicit path used when provided; cwd default otherwise
  - hot reload triggers re-apply
  - invalid reload keeps last-good config and emits warning
  - missing/invalid YAML returns typed errors
  - defaults applied for missing optional fields
  - `tracker.kind` enforces `tok-juara`
  - `$VAR` resolution (tracker key, path values)
  - `~` path expansion
  - prompt renders with `issue` and `attempt`
  - prompt rendering fails on unknown variables/filters
- **Workspace manager**
  - deterministic workspace path per identifier
  - sanitization rules
  - root-containment invariant
  - `created_now` semantics (after_create runs only on new dirs)
  - `before_run` failure aborts attempt
  - `after_run` / `before_remove` failure logged-and-ignored
  - hook timeout enforced
  - worktree-add path: branch named from prefix; cleanup uses `git worktree remove`
  - non-repo path: workspace is plain mkdir
- **Tracker adapter**
  - candidate fetch shape and pagination
  - state-refresh-by-ids shape
  - normalization (labels lowercased, blockers from inverse relations, priority int-only, ISO-8601 timestamps)
  - error mapping for transport, status, malformed payloads
- **Orchestrator**
  - dispatch sort order (priority, created_at, identifier)
  - `Todo` blocked-by-non-terminal not eligible
  - `Todo` blocked-by-terminal eligible
  - reconciliation transitions: terminal → terminate+cleanup, non-active → terminate-no-cleanup, active → update snapshot
  - normal exit schedules 1 s continuation retry
  - failure exit schedules backoff retry
  - retry cap honored
  - stall detection aborts and schedules retry
  - slot exhaustion requeues with explicit reason
- **Agent runner**
  - cwd invariant validated before SDK call
  - first turn uses full prompt; continuation uses guidance only
  - `thread_id` reused across continuations
  - SDK message → runtime event mapping
  - abort propagates to SDK
  - token accounting deltas correctly
  - `permission_mode: auto` is the SDK default when unspecified
- **HTTP server**
  - `/api/v1/state` shape
  - `/api/v1/:identifier` 404 for unknown
  - `/api/v1/refresh` 202 + coalescing
  - bind defaults to loopback
  - `--port` overrides front matter
- **CLI**
  - positional arg, default `./WORKFLOW.md`
  - missing file → non-zero exit
  - clean shutdown → exit 0

### Integration (`RUN_INTEGRATION=1`)

- Real wayang instance, full poll-dispatch-run cycle on a synthetic issue.
- Real Claude Max subscription session (skipped in CI without auth).
- Worktree lifecycle on a real test repo.

## 17. Definition of Done (v1)

- [ ] Bun workspace skeleton (`packages/dalang`, `packages/wayang` stub).
- [ ] `WORKFLOW.md` loader + typed config layer + hot reload.
- [ ] `chokidar` watcher with last-good-config fallback.
- [ ] `liquidjs` strict prompt rendering.
- [ ] `RestTrackerAdapter` against the wayang contract.
- [ ] Workspace manager with `repo.*` extension worktree path + plain-dir fallback.
- [ ] Hook execution with timeouts and env injection.
- [ ] Orchestrator with single-authority state, dispatch loop, retry queue, reconciliation, stall detection.
- [ ] Agent runner using `@anthropic-ai/claude-agent-sdk` in subscription-auth mode.
- [ ] Multi-turn continuation up to `agent.max_turns`.
- [ ] HTTP server (`/`, `/api/v1/state`, `/api/v1/:identifier`, `/api/v1/refresh`).
- [ ] Structured logging via pino.
- [ ] CLI entry with positional path arg and `--port`.
- [ ] tsgo type-check passes.
- [ ] oxlint clean.
- [ ] oxfmt formatted.
- [ ] `bun test` covers the matrix in §16.

## 18. Deviations from Symphony Spec

Concise list for review/audit:

| # | Item                                                | Type           |
| - | --------------------------------------------------- | -------------- |
| 1 | Codex app-server → Claude Agent SDK (in-process)    | Substitution   |
| 2 | Linear → wayang (REST adapter)                      | Substitution   |
| 3 | `codex.*` block → `claude.*` block + `claude.model` | Substitution   |
| 4 | `repo.*` extension block (worktree convenience)     | Addition       |
| 5 | `permission_mode: auto` as committed default        | Tightening     |
| 6 | `max_concurrent_agents` default 10 → 4              | Tightening     |
| 7 | Default `tracker.endpoint` → `http://localhost:3001`| Tightening     |
| 8 | HTTP server is shipped in v1 (Symphony marks OPTIONAL) | Tightening |
| 9 | No tmux integration                                 | Reduction (v1) |
| 10 | No SSH worker pool                                 | Reduction (v1) |
| 11 | No persistence layer                               | Reduction (v1) |
| 12 | No `linear_graphql` tool extension                 | Reduction (v1) |
| 13 | Single tracker adapter only (no pluggability)      | Reduction (v1) |
| 14 | Branch convention `<prefix><sanitized_id>`         | House style    |
| 15 | Harness rules: tsgo, oxlint, oxfmt, bun test, no RTL | House style  |

## 19. Open Questions / Future Work

- Persistence layer (SQLite) for retry-queue durability across restarts.
- tmux or web-based attach-and-steer UI for live operator intervention.
- MCP server for the agent to call wayang (`PATCH /issues/:id`, `POST /comments`) with typed schemas.
- Multi-repo support (per-issue `repo` field).
- SSH worker pool (Symphony Appendix A).
- Pluggable tracker adapters (e.g., GitHub Issues, Linear).
