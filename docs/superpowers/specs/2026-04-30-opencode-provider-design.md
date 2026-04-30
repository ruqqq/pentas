# Opencode Provider Support — Design

**Status:** Draft
**Date:** 2026-04-30
**Scope:** dalang

## Summary

Add opencode (`@opencode-ai/sdk`) as a third agent provider alongside Claude (`@anthropic-ai/claude-agent-sdk`) and Codex (`@openai/codex-sdk`). Provider is chosen per-workflow via the existing top-level `agent_provider` discriminator in `WORKFLOW.md`, extended to `"claude" | "codex" | "opencode"`. The choice is global to a workflow run; per-issue or per-state routing remains explicitly out of scope.

opencode is architecturally different from the other two providers: it is an HTTP server with a generated client, not an in-process SDK. dalang spawns one shared opencode server at daemon startup and routes all opencode workers through it via a single `OpencodeClient`.

The agent layer's existing seam (`RunQuery` returning `AsyncIterable<unknown>`, `RuntimeEvent` union, provider-tagged `AgentConfig`) is unchanged. This change adds a third concrete `RunQuery` implementation, a third event mapper, a small server-lifecycle module, and the config plumbing to select between providers. `agent-runner.ts`, retry/backoff, concurrency control, prompt construction, and HTTP observability are unchanged.

## Goals

- Run dalang's existing workflow against opencode without changing prompts, retry semantics, or observability.
- Use opencode primarily as a gateway to model providers that Claude and Codex SDKs do not cover (Gemini, local Ollama, Groq, etc.). The `model` field is opencode's `provider/model` form (e.g. `google/gemini-2.5-pro`, `anthropic/claude-sonnet-4-6`).
- Honor the user's existing `opencode auth login <provider>` setup so dalang does not duplicate auth.
- Non-breaking for existing `WORKFLOW.md` files (they keep working under `agent_provider: "claude"`).
- Leave the door open for future per-issue routing without baking it in today.

## Non-Goals

- Per-issue / per-state provider routing.
- Mid-flight provider switching on a single issue.
- Cross-provider abstraction of permission semantics. Each provider keeps its native vocabulary; opencode's per-tool permissions are not even exposed (see §5).
- Cross-provider cost or token-usage normalization beyond mapping into the existing `tokens` shape.
- opencode-specific features without a Claude/Codex analog: opencode "agents" (`TuiOptions.agent`), MCP passthrough, custom commands.
- Renaming `claude_totals` to a provider-neutral name (still out of scope, as in the codex design).

## Background

The agent layer is already provider-agnostic at the seam:

- `agent-runner.ts` consumes a `RunQuery` (async-iterable factory) and a tagged `AgentConfig`. It owns the multi-turn loop, retry, abort handling, and tracker refresh.
- `sdk-runner.ts` (Claude) and `codex-runner.ts` (Codex) are concrete `RunQuery` implementations.
- `event-mapper.ts` and `codex-event-mapper.ts` translate provider-specific events into `RuntimeEvent`s.
- Config has `agent_provider: AgentProvider`, plus a `claude:` and a `codex:` block; the orchestrator selects the runner based on `agent_provider`.

opencode ships an official `@opencode-ai/sdk` (npm, currently 1.14.30). Unlike the Claude and Codex SDKs, it is a **client to a local opencode HTTP server**. Two relevant entrypoints:

- `createOpencodeServer({ hostname, port, signal, timeout, config })` — spawns the server, returns `{ url, close() }`.
- `createOpencodeClient({ baseUrl, ... })` — returns an `OpencodeClient` with namespaced methods (`session.create`, `session.prompt`, `session.promptAsync`, `session.messages`, `event`, etc.).

Sessions are server-side, persisted to opencode's data directory. Events are streamed from a single global SSE endpoint (`client.event()`) that emits all events for all sessions; consumers filter by `sessionID`.

Auth is opencode's own (`opencode auth login <provider>`), per underlying model provider. dalang does not manage credentials; it only probes that the right provider is authed at config-load time.

## Design

### 1. Module layout

```
packages/dalang/src/agent/
  agent-runner.ts          (unchanged)
  sdk-runner.ts            (Claude — unchanged)
  codex-runner.ts          (unchanged)
  opencode-runner.ts       (NEW — RunQuery via the shared server)
  event-mapper.ts          (Claude — unchanged)
  codex-event-mapper.ts    (unchanged)
  opencode-event-mapper.ts (NEW)
  opencode-server.ts       (NEW — shared server lifecycle + supervisor)
  prompt-builder.ts        (unchanged)
  transcript.ts            (unchanged)
```

`opencode-server.ts` owns the singleton server. It is the only module that imports `createOpencodeServer` and `createOpencodeClient`. It exposes `getOpencodeClient(): Promise<OpencodeClient>` to the runner. Lifecycle details in §6.

### 2. Config schema

`AgentProvider` extends to include `"opencode"`. A new `opencode:` block joins the existing `claude:` and `codex:` blocks.

```ts
export const AgentProvider = z.enum(["claude", "codex", "opencode"]);

export const OpencodeSchema = z.object({
  executable_path: z.string().min(1).default("opencode"),
  model: z.string().min(1).regex(/^[^/]+\/.+$/),     // "providerID/modelID"
  small_model: z.string().min(1).regex(/^[^/]+\/.+$/).optional(),
  turn_timeout_ms: z.number().int().positive(),
  read_timeout_ms: z.number().int().positive(),
  stall_timeout_ms: z.number().int(),
});

export const WorkflowFrontMatterSchema = z.object({
  // ...existing fields...
  agent_provider: AgentProvider.default("claude"),
  claude: ClaudeSchema.optional(),
  codex: CodexSchema.optional(),
  opencode: OpencodeSchema.optional(),
});
```

**Validation rule (post-parse refinement):** the block matching `agent_provider` must be present. Other blocks are permitted but ignored. Existing workflows keep working because `agent_provider` defaults to `"claude"`.

**Defaults for the `opencode:` block:**

- `executable_path: "opencode"`
- `model`: required, no default (the user is choosing opencode specifically to pick a backend; defaulting would hide intent).
- `small_model`: optional. When set, opencode uses it for title/summary turns. Mirrors the upstream config field.
- `turn_timeout_ms`, `read_timeout_ms`, `stall_timeout_ms`: same numeric defaults as `claude:` / `codex:`.

**No permission/sandbox knob.** opencode's per-tool permissions (`edit`, `bash`, `webfetch`, `doom_loop`, each `ask | allow | deny`) are hardcoded to `allow` by the runner — see §5.

### 3. AgentConfig and RunQueryOptions reshape

Extend the existing discriminated union:

```ts
export type AgentConfig =
  | (CommonAgentConfig & {
      provider: "claude";
      permissionMode: "auto" | "default" | "plan" | "bypassPermissions";
    })
  | (CommonAgentConfig & {
      provider: "codex";
      sandboxMode: "read-only" | "workspace-write" | "danger-full-access";
      approvalPolicy: "untrusted" | "on-failure" | "on-request" | "never";
    })
  | (CommonAgentConfig & {
      provider: "opencode";
      smallModel?: string;
    });

interface CommonAgentConfig {
  model: string;
  executablePath: string;
  turnTimeoutMs: number;
  readTimeoutMs: number;
  stallTimeoutMs: number;
  maxTurns: number;
}
```

`RunQueryOptions` gains an `opencode?: { smallModel?: string }` bag:

```ts
export interface RunQueryOptions {
  prompt: string;
  cwd: string;
  model: string;
  executablePath: string;
  abortSignal?: AbortSignal;
  resumeSessionId?: string;
  claude?: { permissionMode: "auto" | "default" | "plan" | "bypassPermissions" };
  codex?: {
    sandboxMode: "read-only" | "workspace-write" | "danger-full-access";
    approvalPolicy: "untrusted" | "on-failure" | "on-request" | "never";
  };
  opencode?: { smallModel?: string };
}
```

`runAttempt` does not branch on provider; it remains generic.

### 4. Runner selection (orchestrator wiring)

The existing two-way branch at the worker call site extends to three:

```ts
const runQuery =
  config.provider === "codex"     ? codexRunQuery     :
  config.provider === "opencode"  ? opencodeRunQuery  :
                                    sdkRunQuery;
```

No changes to retry, backoff, concurrency, abort, or tracker-refresh code.

### 5. Permissions (hardcoded)

dalang is by definition headless — there is no human in the loop on a worker, so opencode's `ask` mode would deadlock and `deny` has no v1 use case. The opencode runner sets the following on every `session.create`:

```ts
permission: {
  edit: "allow",
  bash: "allow",
  webfetch: "allow",
  doom_loop: "allow",
}
```

These values are not exposed in `WORKFLOW.md` and not part of `OpencodeSchema`. If a future use case appears, the schema can grow then.

This is the same spirit as `codex.approval_policy: "never"` and `claude.permission_mode: "auto"` — pick the only-sane-headless setting and bake it in. The difference is that here we don't even surface a knob, because there is no plausible non-default value for a v1 headless workflow.

### 6. Server lifecycle (`opencode-server.ts`)

A single shared opencode server, daemon-lifetime. Responsibilities:

- **Lazy spawn.** First call to `getOpencodeClient()` invokes `createOpencodeServer({ hostname: "127.0.0.1", port: 0 })` (port 0 → OS-assigned ephemeral port), then `createOpencodeClient({ baseUrl: server.url })`. Subsequent calls return the cached client.
- **Health probe.** After spawn, ping a known-cheap endpoint (e.g. `client.event()` open or a session list) before returning. If the probe fails within `read_timeout_ms`, treat as a failed startup.
- **Crash supervisor.** If the server process exits unexpectedly, mark the cached client stale and attempt restart with exponential backoff: 1s, 2s, 4s, 8s, capped at 8s, max 5 attempts within a 60s window. Beyond that, `getOpencodeClient()` rejects with `opencode_server_unavailable`. In-flight runners observe abort/disconnect on their SSE stream and surface `turn_ended_with_error`.
- **Graceful shutdown.** On daemon SIGTERM/SIGINT, call the close handle, wait up to 5s, then send SIGKILL to the underlying process if still running.
- **Concurrency.** The opencode server natively handles many concurrent sessions. No per-worker locking on the dalang side; dalang's existing concurrency cap continues to govern parallel workers.

`opencode-server.ts` is the only module that knows the server URL or process handle exists. Nothing else in dalang spawns or shuts down the server.

### 7. Opencode runner

`opencode-runner.ts` is a thin adapter from `RunQueryOptions` to the SDK. Pseudocode (exact SDK surface verified at implementation time):

```ts
import { getOpencodeClient } from "./opencode-server";
import type { RunQuery, RunQueryOptions } from "./agent-runner";

export const opencodeRunQuery: RunQuery = async (opts: RunQueryOptions) => {
  const client = await getOpencodeClient();
  const { providerID, modelID } = parseProviderModel(opts.model);

  const sessionId = opts.resumeSessionId ?? await createSession(client, opts.cwd);

  await client.session.promptAsync({
    path: { id: sessionId },
    body: {
      model: { providerID, modelID },
      parts: [{ type: "text", text: opts.prompt }],
      mode: "build",
    },
  });

  return tailSessionEvents(client, sessionId, opts.abortSignal);
};

async function createSession(client, cwd) {
  const res = await client.session.create({ body: { directory: cwd } });
  // permission and (optional) small_model are also set here — see §5.
  return res.data.id;
}
```

`promptAsync` is preferred over `prompt`: it returns immediately and lets the SSE stream drive intermediate events. `prompt` (blocking) would force us to choose between waiting on its return value or tailing events — using both is awkward.

`tailSessionEvents` opens (or reuses) the global SSE stream `client.event()`, filters events by `sessionID`, yields them, and terminates on `session.idle` (success) or `session.error` (failure). The SSE stream is opened **once per server lifetime** in `opencode-server.ts` and shared across runners via a fan-out (per-`sessionID` queue). Opening per-call is wasteful and creates ordering races at session startup. The fan-out is bounded — if a worker stops consuming, its queue drops oldest events past a threshold and surfaces a `notification` warning rather than blocking the shared stream.

### 8. Event mapping (`opencode-event-mapper.ts`)

| opencode event                          | RuntimeEvent                                       |
|-----------------------------------------|----------------------------------------------------|
| First event with `sessionID` populated  | `session_started` (`thread_id` = `sessionID`)      |
| `message.part.updated` (text part)      | `notification` (truncated text)                    |
| `message.part.updated` (tool call start)| `notification` (`tool_use:<name>`)                 |
| `message.part.updated` (tool call result)| `notification` (`tool_result`)                    |
| `session.idle`                          | `turn_completed` (usage from final `Message.tokens`)|
| `session.error`                         | `turn_ended_with_error` (reason from event)        |
| Server connection lost                  | `startup_failed` (reason `opencode_disconnect`)    |
| Anything else                           | `other_message` with raw `type`                    |

**Token usage.** opencode normalizes per-provider token usage into `Message.tokens` (input / output / reasoning). Map to dalang's existing `tokens` shape:

- `input` → `input_tokens`
- `output + reasoning` → `output_tokens`
- `total` → SDK-provided field if present, else `input + output + reasoning`.

`claude_totals` field name stays (already noted as misleading in the codex design; renaming remains out of scope).

**Known gaps.** As with codex, dalang does not fabricate events the SDK does not surface. Permission-prompt events do not occur because permissions are hardcoded to `allow`. Streaming text deltas are mapped to `notification` only; dalang does not currently distinguish "delta" from "final" text.

### 9. Resume / thread_id semantics

- The first SSE event for a session emits `session_started` with `thread_id = sessionID`.
- `agent-runner.ts` passes `thread_id` back as `resumeSessionId` on the next turn.
- The opencode runner skips `session.create` and goes straight to `session.promptAsync` against the existing `sessionID`.
- Sessions persist on disk in opencode's data directory. They survive opencode-server crashes (supervisor restart leaves the data dir untouched) and dalang daemon restarts, but **not** machine changes — same caveat as codex.
- Documented in the README; not mitigated. Failures surface as `turn_ended_with_error` with reason `resume_failed` and recover via the worker's existing retry path.

### 10. Validation and auth probes

Additions to `validate.ts`:

- New error codes:
  - `missing_opencode_executable_path`
  - `invalid_opencode_model_format` (model not in `provider/model` form)
  - `opencode_auth_inactive` (binary missing or non-zero exit)
  - `opencode_provider_not_authed` (`auth list` does not include the provider prefix from `model`)
- New helper `probeOpencodeAuth(executablePath, model)`:
  1. Spawn `<executablePath> --version`. Non-zero exit → `opencode_auth_inactive`.
  2. Parse `model` → `providerID`. (Re-checked here even though zod already validates the shape, so the error code is reported correctly during the probe.)
  3. Spawn `<executablePath> auth list --json` (text-parse fallback if `--json` is unavailable in the installed version). If `providerID` is absent → `opencode_provider_not_authed`.
- All new errors are sub-codes of the existing `workflow_validation_error` classification.
- Auth probes are gated by `agent_provider`: only `probeOpencodeAuth` runs when `provider: "opencode"`.

### 11. Testing

Following repo conventions (`bun test`, real I/O where feasible, mocks at the SDK boundary only):

- **`opencode-event-mapper.test.ts`** — feed sample SSE event shapes (captured from SDK type defs) and assert `RuntimeEvent` output. Mirrors the existing Claude and Codex mapper tests.
- **Config validation tests** — `agent_provider: "opencode"` without `opencode:` block → validation error. `model` not in `provider/model` form → `invalid_opencode_model_format`. Default-provider case continues to work.
- **Runner selection test** — orchestrator picks the right `RunQuery` for each of the three provider values. Uses fake `RunQuery`s; no real subprocess.
- **`agent-runner` integration test with a fake opencode-shaped event sequence** — same harness as the existing Claude/Codex integration tests. Proves `agent-runner.ts` stays generic across all three providers.
- **`opencode-server.ts` supervisor tests** — fake child-process abstraction, simulate clean exit, crash, restart, exhausted retries. Verifies the cap on retries and the `opencode_server_unavailable` surfacing.
- **`probeOpencodeAuth` tests** — stub binary covers: binary missing, `auth list` lacks the provider, success.
- **No live opencode server in CI**, parallel to how Claude and Codex are not run live.

### 12. Migration / rollout

- Existing `WORKFLOW.md` files keep working unchanged.
- A new section in the dalang README documents the `agent_provider: "opencode"` setting, the `opencode:` block, the `provider/model` format, and the requirement to run `opencode auth login <provider>` before starting dalang.
- The `init-workflow-md` skill is updated to optionally scaffold an `opencode:` block when the user picks opencode during init.

### 13. Out of scope (v1)

- Per-issue / per-state routing. Same single-seam-for-future as in the codex design.
- Mid-flight provider switching on a single issue.
- Exposing opencode's per-tool permission knobs.
- opencode "agents" (`TuiOptions.agent` — custom prompt/tool configs).
- MCP server passthrough into the opencode session.
- Custom commands or instructions files specific to opencode.
- Renaming `claude_totals`.
- Cross-provider cost or token-usage normalization beyond the existing `tokens` mapping.
