# Dalang Sandboxed Workers — Design

**Status:** Draft
**Date:** 2026-05-02
**Scope:** dalang

## Summary

Run each per-issue worker's tool calls inside a container so that an autonomous agent's filesystem, shell, and network side effects cannot reach the host. dalang stays on the host as the supervisor; the agent process (claude / codex / opencode) runs inside the container, against the worker's worktree, with provider credentials injected per-worker.

The sandbox image is **not** owned by dalang. Each repo declares its own image — ideally by reusing the repo's existing `.devcontainer/` — so the agent has access to the project's actual toolchain (Bun version, Playwright browsers, postgres-client, etc.). Each image bakes in a single self-contained `bayang` shim binary.

Out of scope for v1: egress network policy (allowlists, locked-down DNS). The threat model assumes the agent is autonomous and needs internet; we accept that an exfiltration-capable tool call can reach the open internet.

## Goals

- Per-worker filesystem and process isolation: a hostile or buggy tool call inside one worker cannot touch other workers' worktrees, the bare clone at `<workspace.root>/.repo.git`, the host's home directory, or dalang's config/credential store.
- Use the repo's own image so the agent's environment matches the project's real dev environment. `.devcontainer/` (single Dockerfile or docker-compose) is the canonical declaration.
- Preserve the existing agent layer: `RunQuery` contract, `RuntimeEvent` union, per-turn token accounting (`claude_totals`, codex `Usage`), event-mapper modules. The container is a transport detail, not a redesign of the agent loop.
- Subscription-based auth as a first-class case (it is the primary current usage), without bind-mounting the host's `~/.claude`, `~/.codex`, or `~/.local/share/opencode`.
- Keep dalang's single-daemon, in-process state model intact. No new persistent stores beyond a credential dir.

## Non-Goals

- Egress network policy / allowlisting / DNS sandboxing. Containers have full outbound network in v1.
- Full kernel-level sandboxing beyond what Docker (or a compatible runtime) provides by default. No gVisor/Firecracker integration.
- Multi-tenant safety. dalang is single-user; the threat is the agent, not other humans.
- Cross-host scheduling. All workers run on the same host as the daemon.
- Replacing codex's built-in sandbox flags (`sandboxMode`, `approvalPolicy`) — those continue to be passed through and act as defense-in-depth inside the container.
- Mid-session re-auth or token-rotation brokering across concurrent workers (see §Auth, race accepted in v1).

## Background

dalang today drives each per-issue worker as an in-process async task. Three runners exist:

- `sdk-runner.ts` — Claude via `@anthropic-ai/claude-agent-sdk` (`query()` async iterator, in-process, child-process `claude` CLI).
- `codex-runner.ts` — Codex via `@openai/codex-sdk` (spawns the `codex` binary, stream-json over stdout).
- `opencode-runner.ts` — opencode via `@opencode-ai/sdk` against a single shared HTTP server.

All three end up executing tool side effects (Bash, Edit, Write, etc.) on the host — wherever the agent process runs. Today that is the dalang process's host. The sandbox boundary today is "the worker's git worktree path", which only constrains *where the agent is told to work*, not what it can actually touch.

A natural sandbox candidate is the Devcontainer spec (`.devcontainer/devcontainer.json`), already adopted by repos dalang is run against — e.g. `meem-class` declares a docker-compose-based devcontainer with Playwright, postgres-client, and Bun preinstalled. Reusing it gets the agent the project's real toolchain for free.

## Design

### 1. Container topology

One container per running worker. Lifecycle:

1. **Worker start.** dalang creates the worktree (existing flow), then provisions a container from the repo's image, with the worktree bind-mounted at the devcontainer's `workspaceFolder`.
2. **Shim launch.** dalang `docker exec`s `/opt/dalang/bayang <provider> <args>` inside the container. The shim imports the appropriate SDK and runs the agent loop in-container.
3. **Event stream.** The shim emits one JSON event per line on stdout. The host-side runner reads the stream and yields events to `agent-runner.ts`. Existing event-mapper modules (`event-mapper.ts`, `codex-event-mapper.ts`, `opencode-event-mapper.ts`) are unchanged because event shapes are unchanged.
4. **Worker end.** On any exit (success, abort, crash), dalang stops and removes the container. The worktree persists on the host. Resume on the same issue starts a fresh container against the same worktree.

The host still owns: `OrchestratorState`, the bare clone, the HTTP observability surface, WORKFLOW.md hot-reload, retry scheduling, container lifecycle.

### 2. Image source

Per-repo configuration declares how the image is obtained:

```yaml
sandbox:
  enabled: true
  image:
    source: devcontainer       # devcontainer | dockerfile | image
    path: .devcontainer        # default; for "dockerfile" this is the Dockerfile path
```

Three modes:

- **`devcontainer`** — read `.devcontainer/devcontainer.json`. If `image` is set, use it. If `dockerFile` is set, build it. If `dockerComposeFile` is set, bring up the compose stack with `service` as the worker container (see §3). Honor `workspaceFolder`, `remoteUser`, `forwardPorts` (informational), `postCreateCommand`.
- **`dockerfile`** — build a Dockerfile at the configured path. Equivalent to a devcontainer with no compose.
- **`image`** — use a pre-pulled tag. Repo-owned image, no build.

Fallback: if no sandbox config is declared and `enabled: false`, dalang runs the worker on the host (current behavior). If `enabled: true` and no image is declared, dalang fails the worker with `sandbox_misconfigured` rather than silently falling back.

### 3. docker-compose devcontainers

When the repo's devcontainer uses `dockerComposeFile` (e.g. meem-class with postgres on the side):

- Each worker gets its **own** compose stack, brought up with a unique project name (e.g. `dalang-<worker-id>`). Side services (postgres, etc.) are per-worker.
- Stack is torn down with `docker compose down --volumes` on worker exit. Volumes are not persisted across workers; cross-issue state must not leak.
- This is heavier than a shared compose stack but matches the per-worktree blast-radius rule for everything else in dalang.
- `postCreateCommand` runs once on container create, before the shim is exec'd.

### 4. The bayang shim

Single Bun-compiled binary, built with `bun build --compile`, shipped with dalang. Bundles:

- `@anthropic-ai/claude-agent-sdk` and the `claude` CLI's invocation surface.
- `@openai/codex-sdk` (the SDK looks up the `codex` binary from its npm package; the shim bundles both).
- `@opencode-ai/sdk` and the `opencode` server binary.
- The same prompt-builder logic the host uses today (or a thin entry that re-runs it from arguments passed by host).

CLI surface, called by dalang via `docker exec`:

```
bayang run \
  --provider claude|codex|opencode \
  --cwd /workspace \
  --model <model-id> \
  [--resume <session-id>] \
  [--codex-sandbox-mode workspace-write] \
  [--codex-approval-policy never] \
  [--opencode-mode build] \
  --prompt-file /run/dalang/prompt.txt
```

Output: newline-delimited JSON events on stdout. The event schema is the *same* schema the existing runners already produce for `agent-runner.ts`. Stderr is dalang's worker logs, captured into the existing logging pipeline.

The shim is baked into the image at `/opt/dalang/bayang`. `dalang sandbox doctor` verifies the binary exists and is executable before unattended runs.

### 5. Auth

dalang owns a credential store at `<dalang-config>/credentials/`, separate from the host CLIs' credential stores. The host's `~/.claude`, `~/.codex`, `~/.local/share/opencode` are never bind-mounted into a worker container.

Per provider:

| Provider | Subscription mechanism | Per-worker injection |
|---|---|---|
| Claude | `CLAUDE_CODE_OAUTH_TOKEN` (long-lived, from `claude setup-token`) | env var only, no FS mount |
| Codex | `auth.json` at `$CODEX_HOME/auth.json` (refresh in-process, ~8d) | bind-mount per-worker dir at `/run/dalang/codex`, set `CODEX_HOME=/run/dalang/codex` |
| opencode | `auth.json` at `$XDG_DATA_HOME/opencode/auth.json` | bind-mount per-worker dir at `/run/dalang/opencode-data`, set `XDG_DATA_HOME=/run/dalang/opencode-data` |

API-key auth is also supported (`ANTHROPIC_API_KEY`, `CODEX_API_KEY`, opencode per-provider keys) via env injection only. Subscription is the primary case; API key is an opt-in alternative.

#### 5.1 Per-worker file projection (codex / opencode)

For file-projected providers, on worker start dalang:

1. Creates a per-worker tmpdir under `<state>/sandboxes/<worker-id>/`.
2. Copies the relevant `auth.json` from `<dalang-config>/credentials/` into that tmpdir.
3. Bind-mounts the tmpdir read-write into the container at the `$CODEX_HOME` / `$XDG_DATA_HOME/opencode` path.

On worker exit, dalang reads the (possibly refreshed) `auth.json` back from the tmpdir and writes it to the central store. Last-writer-wins across concurrent workers.

**Refresh-rotation race (knowingly accepted in v1):** when two workers refresh the same parent refresh token concurrently, one rotation invalidates the other. For dalang's expected concurrency (single user, low N) and codex's ~8-day refresh window, this is rare. When it does fire, it surfaces as a `sandbox_auth_refresh_conflict` runtime event; the affected worker fails and retries against the now-current store. Mitigation (a host-side broker that serializes refreshes) is deferred to v2.

#### 5.2 `dalang auth login <provider>`

Login flows write credential files in well-known places (`~/.claude`, `~/.codex`, `~/.local/share/opencode`). To keep dalang's store separate from the user's host CLI state, login runs **inside a one-shot container**:

- A fresh container from a minimal image (or the repo's image, configurable).
- Override `HOME` / `CODEX_HOME` / `XDG_DATA_HOME` to point at a temp dir.
- Run the provider's interactive login (`claude setup-token`, `codex login`, `opencode auth login <provider>`).
- Capture the produced credential into dalang's store.
- Tear the container down.

The host's actual home directory is never touched by `dalang auth login`.

### 6. IPC / transport between dalang and the shim

The transport is `docker exec` with stdio piping. dalang spawns:

```
docker exec -i <container> /opt/dalang/bayang run --provider <p> ...
```

Reads NDJSON from stdout, writes nothing to stdin after launch (prompts and config are passed via files in `/run/dalang/`). Aborts propagate via `docker kill --signal SIGTERM <container>` followed by container teardown.

Why not a unix socket: an exec-stdio pipe is simpler to set up, requires no socket bind-mount, and matches the per-call cardinality (one exec per worker session, not per tool call). The IPC overhead is negligible compared to model latency.

### 7. Module layout

```
packages/dalang/src/
  agent/
    agent-runner.ts          (unchanged)
    sdk-runner.ts            (Claude — see below)
    codex-runner.ts          (see below)
    opencode-runner.ts       (see below)
    *event-mapper.ts         (unchanged)

  sandbox/                   (NEW)
    container-host.ts        (interface — start/exec/stop, fake-friendly)
    docker-host.ts           (real Docker via @docker/cli or shelling out)
    image-source.ts          (devcontainer.json / Dockerfile / image resolver)
    compose-stack.ts         (per-worker compose lifecycle)
    auth-projector.ts        (credential store ↔ per-worker tmpdir copy)
    types.ts

  worker/                    (NEW — the shim, compiled to a single binary)
    main.ts                  (CLI entry)
    claude.ts | codex.ts | opencode.ts

packages/dalang/scripts/
  build-bayang.ts            (bun build --compile entry point)
```

The three existing runners (`sdk-runner.ts`, `codex-runner.ts`, `opencode-runner.ts`) are refactored into thin clients of `ContainerHost`: spawn shim, read NDJSON, yield events. The non-sandboxed code path remains as a fallback when `sandbox.enabled: false`.

### 8. Lifecycle and error classification

New runtime event classifications layered onto the existing model:

- `sandbox_unavailable` — Docker daemon not reachable.
- `sandbox_image_unavailable` — image build/pull failed.
- `sandbox_start_failed` — container failed to start (compose or single).
- `sandbox_exec_disconnected` — exec stream dropped mid-turn (treat as turn failure, retry per existing policy).
- `sandbox_oom` — container killed by OOM (separate from generic crash for visibility).
- `sandbox_auth_refresh_conflict` — see §5.1.
- `sandbox_misconfigured` — config declares `enabled: true` but no resolvable image.

These slot into the existing error-classification convention (`tracker_request_error`, `workflow_validation_error`, etc.) and are emitted as `RuntimeEvent`s.

### 9. Testing

`ContainerHost` is the seam. Two implementations:

- `DockerContainerHost` — real Docker, used in integration tests gated behind a `DOCKER_AVAILABLE` env check.
- `FakeContainerHost` — in-process, runs the shim directly as a subprocess. Used for unit tests of `agent-runner` and the runners' shim-client logic without paying Docker startup cost.

The shim itself is unit-tested by exercising its CLI in-process (it's just a Bun script).

End-to-end tests use a real `meem-class`-style devcontainer fixture in `packages/dalang/tests/fixtures/devcontainer-sample/`, gated behind `DOCKER_AVAILABLE`.

### 10. Resource limits

Each worker container runs with sensible defaults to prevent a runaway agent from destabilizing the host:

- `cpus: "2"`
- `memory: "4g"`
- `pids-limit: 1024`
- `--tmpfs /tmp:size=2g`

Overridable per-repo via `sandbox.resources`:

```yaml
sandbox:
  resources:
    cpus: "4"
    memory: "8g"
```

These are floors against accidents (fork bombs, memory leaks), not a security boundary. The agent inside still has full network and full access to its mounted worktree.

### 11. Dependency-install cost (`postCreateCommand`)

v1 accepts the cost: every worker pays the project's `postCreateCommand` (e.g. `bun install`) on container start. For projects with warm lockfiles this is typically <30s and tolerable. Caching strategies (shared cache bind-mount, "ready image" snapshot via `docker commit`) are explicitly deferred to a follow-up perf pass once real workload data exists.

## Open Questions

These are deferred to plan-writing or follow-up:

1. **Shim ↔ SDK version coupling.** The shim bundles all three SDKs; bumping any one means rebuilding the shim binary. Acceptable for v1; revisit if it becomes painful.
2. **`docker` vs container runtime abstraction.** v1 targets Docker only. Podman compatibility is plausible but unverified.
3. **Credential store layout on disk.** Path is `<dalang-config>/credentials/`; exact per-provider layout to be decided at plan time.
4. **Dependency-install caching.** See §11. Deferred follow-up perf pass.

## Risks

- **Docker dependency.** dalang previously required only Bun + git on the host. Adding Docker as a hard dependency (when `sandbox.enabled: true`) is a real install-burden increase. Mitigated by keeping the non-sandboxed path supported.
- **`postCreateCommand` cost.** Without caching, every worker pays the project's setup cost on start. Real impact depends on workflow throughput.
- **Auth refresh race.** Documented in §5.1.
- **Compose teardown reliability.** A crashed dalang leaves orphaned worker compose stacks. Cleanup-on-startup logic is needed (sweep `dalang-*` compose projects whose worker IDs aren't in current state).
- **No egress policy.** A malicious or runaway agent can reach the public internet. This is an explicit accepted risk for v1, scoped to "we trust the model not to actively attack us."

## Migration

- New top-level `sandbox:` block in `WORKFLOW.md` config; default `enabled: false` for backward compatibility.
- `dalang auth login <provider>` is a new CLI subcommand, additive.
- Existing in-process runner paths remain functional and become the `sandbox.enabled: false` fallback.

No `OrchestratorState` shape changes. No HTTP API changes (sandbox status fields could be added later under §Open Questions).
