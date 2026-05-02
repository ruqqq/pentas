# dalang — agent provider configuration

dalang is the orchestrator daemon in the pentas monorepo. See the root [README](../../README.md) for project overview, prerequisites, install, and running instructions. This document is for operators who need to wire up or switch agent providers.

Dalang reads work through a control-plane adapter. `control_plane.kind: papan` preserves the local Papan workflow; `control_plane.kind: github-projects` uses a GitHub Projects v2 board and requires explicit ownership (`label`, `assignee`, or `project_field`) unless `allow_unowned_dispatch: true` is set.

## `agent_provider`

Set in the YAML front matter of your `WORKFLOW.md`:

```yaml
agent_provider: claude # "claude" | "codex" | "opencode" — default: "claude"
```

- The provider is global to a workflow run. Per-issue or per-state routing is not supported in v1.
- When `agent_provider` is omitted, it defaults to `"claude"`.
- Each provider requires its own configuration block (`claude:`, `codex:`, or `opencode:`). The active provider's block must be present; the others are ignored if present.
- To switch providers, edit `WORKFLOW.md` and restart dalang. The orchestrator deliberately ignores hot-reloads that change `agent_provider` — only a restart picks up a provider change.

---

## `agent_provider: claude` (default)

Uses the Claude Code CLI via `@anthropic-ai/claude-agent-sdk`. This is the default when `agent_provider` is omitted.

**Auth:** run `claude /login` to authenticate with a Claude Max subscription.

**Minimal `claude:` block with defaults:**

```yaml
agent_provider: claude
claude:
  executable_path: claude
  model: claude-opus-4-7
  permission_mode: auto # "auto" | "default" | "plan" | "bypassPermissions"
  turn_timeout_ms: 3600000 # 1 hour
  read_timeout_ms: 5000 # 5 seconds
  stall_timeout_ms: 300000 # 5 minutes
```

**Fields:**

| Field              | Default             | Notes                                            |
| ------------------ | ------------------- | ------------------------------------------------ |
| `executable_path`  | `"claude"`          | Path or name of the `claude` binary.             |
| `model`            | `"claude-opus-4-7"` | Claude model to use.                             |
| `permission_mode`  | `"auto"`            | `"auto"` is the only recommended headless value. |
| `turn_timeout_ms`  | `3600000`           | Max time for a single agent turn.                |
| `read_timeout_ms`  | `5000`              | Max silence before declaring a stall.            |
| `stall_timeout_ms` | `300000`            | Max total stall time before aborting.            |

---

## `agent_provider: codex`

Uses the OpenAI Codex CLI via `@openai/codex-sdk`.

**Auth:** `codex login` for ChatGPT subscription auth, or set `OPENAI_API_KEY` for API key auth. GPT-5.5 (the default model) is only available via subscription auth — it is not accessible with an API key.

**Minimal `codex:` block with defaults:**

```yaml
agent_provider: codex
codex:
  executable_path: codex
  model: gpt-5.5
  sandbox_mode: danger-full-access # "read-only" | "workspace-write" | "danger-full-access"
  approval_policy: never # "untrusted" | "on-failure" | "on-request" | "never"
  network_access_enabled: true
  turn_timeout_ms: 3600000
  read_timeout_ms: 5000
  stall_timeout_ms: 300000
```

**Fields:**

| Field              | Default             | Notes                                                                |
| ------------------ | ------------------- | -------------------------------------------------------------------- |
| `executable_path`  | `"codex"`           | Path or name of the `codex` binary.                                  |
| `model`            | `"gpt-5.5"`         | Codex model to use.                                                  |
| `sandbox_mode`     | `"workspace-write"` | File system access granted to the agent. Use `"danger-full-access"` when Codex workers must stage, commit, or push because `workspace-write` can mount `.git` read-only. |
| `approval_policy`  | `"never"`           | `"never"` is the recommended headless value; `"ask"` would deadlock. |
| `network_access_enabled` | `true`       | Allows Codex runs to perform GitHub handoff commands.                 |
| `turn_timeout_ms`  | `3600000`           | Max time for a single agent turn.                                    |
| `read_timeout_ms`  | `5000`              | Max silence before declaring a stall.                                |
| `stall_timeout_ms` | `300000`            | Max total stall time before aborting.                                |

---

## `agent_provider: opencode`

Uses the opencode HTTP server via `@opencode-ai/sdk`. opencode acts as a gateway to model providers not covered by the Claude or Codex SDKs (Gemini, local Ollama, Groq, etc.), as well as Anthropic models.

**Auth:** run `opencode auth login <provider>` for each model provider you intend to use. dalang does not manage credentials — it probes that the required provider is authenticated at config-load time.

**`model` format:** `providerID/modelID` — for example:

- `anthropic/claude-sonnet-4-6`
- `google/gemini-2.5-pro`

`model` has no default and must be specified.

**Minimal `opencode:` block:**

```yaml
agent_provider: opencode
opencode:
  executable_path: opencode
  model: google/gemini-2.5-pro # required — no default
  turn_timeout_ms: 3600000
  read_timeout_ms: 5000
  stall_timeout_ms: 300000
```

**Fields:**

| Field              | Default      | Notes                                  |
| ------------------ | ------------ | -------------------------------------- |
| `executable_path`  | `"opencode"` | Path or name of the `opencode` binary. |
| `model`            | _(required)_ | Model in `providerID/modelID` form.    |
| `turn_timeout_ms`  | `3600000`    | Max time for a single agent turn.      |
| `read_timeout_ms`  | `5000`       | Max silence before declaring a stall.  |
| `stall_timeout_ms` | `300000`     | Max total stall time before aborting.  |

**Architecture notes:**

- dalang spawns one shared opencode HTTP server at daemon startup. All opencode workers route through it. The server is shut down when dalang exits.
- Permissions for `edit`, `bash`, `webfetch`, and `doom_loop` are hardcoded to `allow`. These are not configurable. dalang is headless — `ask` would deadlock, and there is no v1 use case for `deny`.
- Sessions persist in opencode's local data directory. They survive opencode-server crashes (the supervisor restarts the server and leaves the data directory untouched) and dalang restarts on the same host. Sessions do not survive machine changes — failures surface as `turn_ended_with_error` and recover via the worker's existing retry path.

---

## Session Viewer

The HTTP server includes a simple parsed JSONL session viewer for running agents:

- `GET /` shows running work and links each active item to `/sessions/:id`.
- `GET /sessions/:id` renders the transcript as a table with raw JSON expandable per line.
- `GET /api/v1/sessions/:id/transcript?max_lines=1000` returns the parsed transcript JSON.

`:id` can be the issue id, issue identifier, session id, or provider thread id. Claude and Codex use their native transcript JSONL paths. opencode events are captured by dalang under `~/.dalang/opencode-sessions/<session_id>.jsonl`.

---

## Common gotchas

**I changed `agent_provider` and nothing happened.**
Hot-reload does not apply to `agent_provider` changes. Restart dalang to pick up a provider switch.

**`model` is required for opencode but I get a validation error before dalang starts.**
The `opencode:` block's `model` field has no default. Add it in `provider/model` form (e.g. `anthropic/claude-sonnet-4-6`).

**I'm using GPT-5.5 with an API key and getting an auth error.**
GPT-5.5 requires ChatGPT subscription auth (`codex login`). It is not available via `OPENAI_API_KEY`.

---

## Sandbox (Phase 1 — foundation)

`packages/dalang/src/sandbox/` provides container primitives used by later
phases of the sandboxed-workers feature. The `ContainerHost` interface has
two implementations: `DockerContainerHost` (real Docker; requires the
`docker` CLI) and `FakeContainerHost` (in-process, host subprocesses, for
unit tests).

`resolveImage()` resolves a `SandboxImageConfig` to a concrete `ResolvedImage`
by reading `.devcontainer/devcontainer.json`, building a Dockerfile, or
passing through a tagged image. Per-worker docker-compose stacks are
supported via the `compose` resolved-image kind.

This module is not yet wired into the agent runner. The runner integration
lands in Phase 4 of the sandboxed-workers plan.

---

## Auth credential store (Phase 3)

dalang stores per-user provider credentials at `~/.config/dalang/credentials/`
(override with `DALANG_CONFIG_HOME`). It does *not* read or write your host
CLI's credential dirs (`~/.claude`, `~/.codex`, `~/.local/share/opencode`).

To populate the store, run your provider CLI's login flow once, then point
dalang at the result:

```bash
# Claude (long-lived token)
claude setup-token  # produces a token starting with "sk-ant-oat01-..."
dalang auth set claude --token "sk-ant-oat01-..."

# Codex (subscription)
codex login
dalang auth set codex --from ~/.codex/auth.json

# opencode
opencode auth login <provider>
dalang auth set opencode --from ~/.local/share/opencode/auth.json
```

Run `dalang auth status` to see which providers are configured.

These credentials are projected into worker containers in Phase 4. Phase 3
only ships the store and the projection primitives.
