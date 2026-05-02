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

## Sandboxed Workers

dalang can run each provider session inside an isolated Docker worker instead
of running the provider CLI directly on the host. Enable this with
`sandbox.enabled: true` in `WORKFLOW.md`.

The sandbox is intentionally a worker boundary, not a security boundary for
host secrets. dalang still mounts a worktree, projects provider credentials,
passes selected env vars, and runs `bayang` inside the container. Treat it
as a reproducible project runtime for unattended agents, not as protection
against malicious code.

### Runtime Model

For each picked-up item, dalang:

1. Creates or reuses the issue worktree under `workspace.root`.
2. Resolves the sandbox image from the workflow config.
3. Starts a per-worker Docker container or compose project named
   `bayang-<pid>-<counter>`.
4. Mounts the worktree into the container.
5. Executes the image-baked `bayang` shim at `/opt/dalang/bayang`.
6. Projects the active provider credential into the container.
7. Executes the shim with a JSON invocation in `BAYANG_INVOCATION`.
8. Streams provider events back to the orchestrator.
9. Tears the worker down and disposes projected credentials.

The sandbox image must include an executable `bayang` at `/opt/dalang/bayang`.
`dalang sandbox doctor` fails when that binary is missing or not executable.

### Image Sources

`sandbox.image` supports three sources:

```yaml
sandbox:
  enabled: true
  image:
    source: devcontainer
    path: .devcontainer
```

`source: devcontainer` reads `.devcontainer/devcontainer.json`. If
`dockerComposeFile` is present, dalang starts a per-worker compose project and
uses the configured `service`; otherwise it builds/uses the Dockerfile. In
compose mode, the user's compose file may already mount `/workspace`, so dalang
mounts the issue worktree at `/run/dalang/workspace` and runs the agent there.

```yaml
sandbox:
  image:
    source: dockerfile
    path: Dockerfile
```

`source: dockerfile` builds a dalang-tagged image from the given Dockerfile and
mounts the worktree at the image workspace folder.

```yaml
sandbox:
  image:
    source: image
    tag: node:22-bookworm
```

`source: image` uses an existing image tag.

### Container Requirements

The container must include the active provider CLI and the tools your workflow
expects the agent to use.

For Codex workers, the image usually needs:

- `codex`
- `git`
- `gh` if the prompt or workflow expects GitHub CLI commands
- project tooling such as `bun`, `node`, `wrangler`, `psql`, Playwright, etc.

The image must bake in `bayang`. For now, project devcontainers can build it
from the public Pentas source during image build:

```dockerfile
FROM oven/bun:1 AS bayang-builder
ARG DALANG_REPO=https://github.com/ruqqq/pentas.git
ARG DALANG_REF=main
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git \
  && rm -rf /var/lib/apt/lists/*
RUN git clone --depth=1 --branch "$DALANG_REF" "$DALANG_REPO" /tmp/pentas
WORKDIR /tmp/pentas
RUN bun install --frozen-lockfile
RUN bun run build:bayang

FROM your-project-image
COPY --from=bayang-builder /tmp/pentas/dist/bayang /opt/dalang/bayang
RUN chmod 0755 /opt/dalang/bayang
```

The shim is a Linux x86-64 Bun-compiled binary, so the image must be able to
execute Linux ELF binaries with glibc-compatible runtime support.

### Provider Paths And Env

Provider executable paths are configured under `sandbox.providers`. These are
container paths, not host paths.

```yaml
sandbox:
  providers:
    codex:
      executablePath: /usr/bin/codex
      env:
        HOME: /tmp
        GH_TOKEN: "${GH_TOKEN}"
        CLOUDFLARE_API_TOKEN: "${CLOUDFLARE_API_TOKEN}"
```

`env` values are passed only to the provider child process inside the worker.
They do not automatically inherit from the host. Use exact env references like
`"${GH_TOKEN}"` or `"$GH_TOKEN"` in front matter and start dalang from a shell
where those variables are set.

Common values:

- `HOME: /tmp` keeps CLIs from trying to write to a mounted or read-only home.
- `GH_TOKEN` / `GITHUB_TOKEN` lets GitHub CLI and git HTTPS auth work.
- `CLOUDFLARE_API_TOKEN` is the Wrangler API token env var.
- Provider-specific tokens such as `OPENAI_API_KEY` can be passed the same way
  when the provider mode needs them.

### Provider Credentials

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

When sandboxing is enabled, dalang validates that the active provider has a
stored credential before dispatch and projects only that provider's credential
into the worker. GitHub and Cloudflare tokens are separate from provider auth;
pass them through `sandbox.providers.<provider>.env`.

### Git Identity And GitHub Pushes

Local commits inside the worker need git identity:

```yaml
sandbox:
  git:
    userName: "${GH_USER_NAME}"
    userEmail: "${GH_USER_EMAIL}"
```

At worker startup dalang runs:

- `git config --global user.name ...`
- `git config --global user.email ...`

These commands run from `/tmp`, not from the worktree, so a container-visible
worktree `.git` path cannot break global config setup.

If `GH_TOKEN` or `GITHUB_TOKEN` is present, dalang also configures git for
GitHub HTTPS pushes:

- sets `credential.https://github.com.username` to `x-access-token`
- sets a git credential helper that reads `GH_TOKEN` or `GITHUB_TOKEN`
- rewrites `git@github.com:` and `ssh://git@github.com/` remotes to
  `https://github.com/`

This means the container does not need an SSH key to push branches. It does
need a token with repository write permission. `gh` is still recommended in the
image because many workflow prompts and PR handoff skills call it directly, but
git push auth itself no longer depends on `gh auth setup-git`.

### Doctor

Use the doctor before dispatching real work:

```bash
dalang sandbox doctor WORKFLOW.md
```

The doctor starts the configured sandbox image, projects credentials, and
checks the runtime assumptions:

- `bayang` exists and is executable
- provider CLI exists
- required CLIs exist, by default `gh` and `git`
- provider credentials are readable
- workspace is writable
- the mounted workspace is a usable git repository
- git commit identity is configured
- when a GitHub token is available, GitHub auth and remote access work

Doctor failures are meant to be fixed in the project devcontainer or workflow
config before enabling unattended runs.

### Orphan Cleanup

On startup, dalang sweeps stale `bayang-*` Docker containers and compose
projects whose owning dalang process no longer exists. Live workers owned by
other running dalang processes are skipped.

### Common Sandbox Failures

**`worker shim exited 126`**
The worker command could not be executed. Rebuild the sandbox image and verify
it contains an executable `/opt/dalang/bayang`.

**`Executable not found in $PATH: "gh"`**
The container does not have GitHub CLI. Install `gh` in the devcontainer if the
workflow or agent prompt expects it. Git push auth can work with only `git` and
`GH_TOKEN`, but PR handoff commands often need `gh`.

**`git identity setup failed: fatal: not a git repository`**
This usually means an older worker binary was running git setup from the
mounted worktree and the container could not resolve the host worktree's
`.git` path. Rebuild/install dalang so git setup runs from `/tmp`.

**`front matter invalid ... sandbox.git.userEmail Invalid email`**
The workflow likely uses `${GH_USER_EMAIL}` but dalang is old enough not to
expand sandbox env refs before validation, or the host env var is unset. Update
dalang and export the variable before startup.

**Provider writes to a read-only home or fails to update PATH**
Set the provider env home to a writable container path:

```yaml
sandbox:
  providers:
    codex:
      env:
        HOME: /tmp
```

### Security trade-off: projected credential dir permissions

When dalang projects codex/opencode credentials into a worker container,
the per-worker tmpdir on the host is `chmod 0o777` and the `auth.json`
inside it is `0o666`. This is so the container's process — which may
run as a different UID than the host user (e.g. `ubuntu` UID 1000 inside
the container vs. whatever your host user is) — can read and write the
projected files, including the in-process auth refresh that codex
performs.

The trade-off: while a worker is running, any local user on the host
machine can read the worker's projected credentials. dalang is designed
for single-user use on a personal machine, where this is acceptable. On
a multi-tenant host, this is not safe.

A more robust fix is to align the container's UID with the host user's
UID via a compose overlay `user:` field; that is a future improvement
and is not implemented in v1.
