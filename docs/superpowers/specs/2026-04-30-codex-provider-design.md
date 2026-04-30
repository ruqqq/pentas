# Codex Provider Support — Design

**Status:** Draft
**Date:** 2026-04-30
**Scope:** dalang

## Summary

Add OpenAI Codex (`@openai/codex-sdk`) as a second agent provider alongside Claude (`@anthropic-ai/claude-agent-sdk`). Provider is chosen per-workflow via a top-level `agent_provider` discriminator in `WORKFLOW.md`. The choice is global to a workflow run; per-issue or per-state routing is explicitly out of scope for v1.

The agent layer is already provider-agnostic at the seam (`RunQuery` interface, `RuntimeEvent` union). This change adds a second concrete `RunQuery` implementation, a second event mapper, and the config plumbing to select between them. `agent-runner.ts`, retry/backoff, concurrency control, prompt construction, and HTTP observability are unchanged.

## Goals

- Run dalang's existing workflow against Codex without changing prompts, retry semantics, or observability.
- Honor the user's existing Codex CLI subscription auth (`codex login`) so no API key is required for the common case.
- Keep the door open for future per-issue routing without baking routing into the core today.
- Non-breaking for existing `WORKFLOW.md` files (they default to `agent_provider: "claude"`).

## Non-Goals

- Per-issue / per-state provider routing.
- Mid-flight provider switching on a single issue.
- Cross-provider abstraction of permission semantics (each provider keeps its native vocabulary).
- Cost or token-usage normalization across providers.
- Codex-specific features without a Claude analog (custom MCP wiring, custom instructions files).

## Background

Today's agent layer:

- `agent-runner.ts` consumes a `RunQuery` (async-iterable factory) and a generic `AgentConfig`. It owns the multi-turn loop, retry, abort handling, and tracker refresh.
- `sdk-runner.ts` is the only Claude-specific binding — it wraps `query()` from `@anthropic-ai/claude-agent-sdk`.
- `event-mapper.ts` translates Claude SDK message shapes into `RuntimeEvent`s.
- `prompt-builder.ts` builds prompts from tracker context. Prompts are model-agnostic.
- Config has a `claude:` block and a `ClaudePermissionMode` enum.

OpenAI ships an official `@openai/codex-sdk` (npm) that wraps the `codex` CLI and exposes `runStreamed()` returning an async generator of structured events. Authentication uses `codex login` (ChatGPT subscription) or `OPENAI_API_KEY` — same mechanism as the Codex CLI itself, so no new auth code is required in dalang. GPT-5.5 (the current default model) is only available via ChatGPT subscription auth, not API key.

## Design

### 1. Module layout

```
packages/dalang/src/agent/
  agent-runner.ts        (unchanged behavior; AgentConfig shape changes — §3)
  sdk-runner.ts          (Claude — unchanged)
  codex-runner.ts        (NEW — wraps @openai/codex-sdk)
  event-mapper.ts        (Claude — unchanged)
  codex-event-mapper.ts  (NEW — Codex events → RuntimeEvent)
  prompt-builder.ts      (unchanged)
  transcript.ts          (unchanged)
```

### 2. Config schema (Option B: non-breaking superset)

`WorkflowFrontMatter` adds an `agent_provider` discriminator and an optional `codex:` block. The existing `claude:` block stays and is still the default.

```ts
export const AgentProvider = z.enum(["claude", "codex"]);

export const CodexSandboxMode = z.enum(["read-only", "workspace-write", "danger-full-access"]);

export const CodexApprovalPolicy = z.enum(["untrusted", "on-failure", "on-request", "never"]);

export const CodexSchema = z.object({
  executable_path: z.string().min(1),
  model: z.string().min(1),
  sandbox_mode: CodexSandboxMode,
  approval_policy: CodexApprovalPolicy,
  turn_timeout_ms: z.number().int().positive(),
  read_timeout_ms: z.number().int().positive(),
  stall_timeout_ms: z.number().int(),
});

export const WorkflowFrontMatterSchema = z.object({
  // ...existing fields unchanged...
  agent_provider: AgentProvider.default("claude"),
  claude: ClaudeSchema.optional(),
  codex: CodexSchema.optional(),
});
```

**Validation rule (post-parse refinement):** the block matching `agent_provider` must be present. The other is permitted but ignored. Existing workflows keep working because `agent_provider` defaults to `"claude"` and they already have a `claude:` block.

**Defaults for the `codex:` block:**

- `executable_path: "codex"`
- `model: "gpt-5.5"`
- `sandbox_mode: "workspace-write"`
- `approval_policy: "never"` (matches the spirit of `claude.permission_mode: "auto"`)
- `turn_timeout_ms`, `read_timeout_ms`, `stall_timeout_ms`: same numeric defaults as `claude:`

**Permission/sandbox modes are kept native (Option 1a from brainstorm):** no abstract `safe | edits | full-auto` enum. Each provider validates its own enum. Avoids a leaky equivalence (e.g. Codex's `approval_policy: "on-failure"` has no Claude analog).

### 3. AgentConfig and RunQueryOptions reshape

`AgentConfig` (consumed by `runAttempt`) currently has a flat `permissionMode` field. Replace with a discriminated provider bag:

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

`RunQueryOptions` gets the same shape — drop the bare `permissionMode` field and add typed provider bags:

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
}
```

The orchestrator wires the right bag based on `agent_provider`. Each runner ignores the other bag. `runAttempt` itself does not branch on provider — it remains generic.

### 4. Runner selection (orchestrator wiring)

At the point where the worker today calls `runAttempt` with `runQuery: sdkRunQuery`, branch:

```ts
const runQuery = config.provider === "codex" ? codexRunQuery : sdkRunQuery;
```

No changes to retry, backoff, concurrency, abort, or tracker-refresh code.

### 5. Codex runner

`codex-runner.ts` mirrors `sdk-runner.ts` in shape — small wrapper translating `RunQueryOptions` into the SDK's API. Pseudocode (exact SDK surface verified at implementation time against the installed `@openai/codex-sdk` version):

```ts
import { Codex } from "@openai/codex-sdk";
import type { RunQuery, RunQueryOptions } from "./agent-runner";

export const codexRunQuery: RunQuery = (opts: RunQueryOptions) => {
  const codex = new Codex({ pathToCodexExecutable: opts.executablePath });

  const thread = opts.resumeSessionId
    ? codex.resumeThread(opts.resumeSessionId)
    : codex.startThread({
        workingDirectory: opts.cwd,
        model: opts.model,
        sandboxMode: opts.codex?.sandboxMode,
        approvalPolicy: opts.codex?.approvalPolicy,
      });

  const { events } = thread.runStreamed(opts.prompt, {
    abortSignal: opts.abortSignal,
  });
  return events as AsyncIterable<unknown>;
};
```

If the SDK API differs at implementation time (e.g. different method names), the runner adapts; the contract upstream (`AsyncIterable<unknown>` of events with stable per-event `type` discriminator) is what `agent-runner.ts` and `codex-event-mapper.ts` depend on.

### 6. Codex event mapper

`codex-event-mapper.ts` translates Codex SDK events into the existing `RuntimeEvent` union. Initial mapping table (event names verified against the installed SDK at implementation time):

| Codex event                             | RuntimeEvent                         |
| --------------------------------------- | ------------------------------------ |
| First event with `threadId` populated   | `session_started` (thread_id set)    |
| `agent_message` / `agent_message.delta` | `notification` (truncated text)      |
| `tool_call` (start)                     | `notification` (`tool_use:<name>`)   |
| `tool_call.completed`                   | `notification` (`tool_result`)       |
| `task.completed` / final `result`       | `turn_completed` (usage mapped)      |
| `task.failed` / error event             | `turn_ended_with_error` (reason)     |
| Auth/startup error                      | `startup_failed` (reason from event) |
| Anything else                           | `other_message` with raw `type`      |

**Token usage:** the Codex SDK exposes `input_tokens`, `output_tokens`, and (per April 2026 changelog) `reasoning_tokens`. Map to dalang's existing `tokens` shape:

- `input_tokens` → `input_tokens`
- `output_tokens + reasoning_tokens` → `output_tokens`
- `total_tokens`: prefer the SDK-provided field if present, else compute `input + output`.

This keeps `claude_totals` shape-compatible across providers. (The field name `claude_totals` is now slightly misleading but renaming it is out of scope for this change — it stays for spec/data continuity.)

**Known SDK gaps** (mirroring the TODOs in `event-mapper.ts`): if Codex doesn't surface a per-approval streaming event, dalang doesn't fabricate one. The fields `turn_input_required` / `unsupported_tool_call` only map when the SDK emits an equivalent.

### 7. Resume / thread_id semantics

- Each runner emits `session_started` with a `thread_id` after the first event.
- `agent-runner.ts` passes that `thread_id` back as `resumeSessionId` on the next turn.
- Claude interprets it as a server-side `resume`. Codex interprets it as `resumeThread()` against a local rollout file in `~/.codex/`.
- **Caveat:** Codex sessions are local to the host. If dalang is restarted on a different machine or `~/.codex/` is wiped, resume fails. v1 surfaces this as `turn_ended_with_error` with reason `resume_failed` (mapped from whatever Codex emits) and lets the worker recover via its existing retry path. Documented; not mitigated.

### 8. Validation and auth probes

Additions to `validate.ts`:

- New error codes:
  - `missing_codex_executable_path`
  - `codex_auth_inactive`
- New helper: `probeCodexAuth(executablePath)`. Spawns `<executablePath> --version` (and a session/auth subcommand if one is stable) — non-zero exit → `codex_auth_inactive`.
- Auth probes are gated by `agent_provider`: only `probeClaudeAuth` runs for `provider: "claude"`, only `probeCodexAuth` runs for `provider: "codex"`.
- All new errors are sub-codes of the existing `workflow_validation_error` classification.

### 9. Testing

Following repo conventions (`bun test`, real I/O where feasible, mocks at the SDK boundary only):

- **`codex-event-mapper.test.ts`** — feed sample Codex SDK message shapes (captured from SDK type defs / docs); assert `RuntimeEvent` output. Mirrors `event-mapper.test.ts` for Claude.
- **Config validation tests** — `agent_provider: "codex"` without `codex:` block → validation error. Default-provider case keeps working with existing `claude:` block. Both blocks present → only the active one is consulted for runtime use.
- **Runner selection test** — orchestrator picks the right `RunQuery` based on `provider`. Uses a fake `RunQuery` that records calls; no real subprocess.
- **`agent-runner` integration test with a fake Codex stream** — same harness as the existing Claude integration test, swapping in a Codex-shaped event sequence. Verifies `agent-runner.ts` is genuinely provider-agnostic across the multi-turn loop, abort handling, and token accumulation.
- **`probeCodexAuth` test** — exercises against a stub binary, mirroring how Claude's probe is tested.
- **No live Codex CLI in CI**, parallel to how we don't run live Claude.

### 10. Migration / rollout

- Existing `WORKFLOW.md` files keep working unchanged (default `agent_provider: "claude"`).
- A new section in the dalang README documents the `agent_provider` field, the `codex:` block, and the GPT-5.5 / subscription-auth caveat.
- The `init-workflow-md` skill is updated to optionally scaffold a `codex:` block when the user picks Codex during init.

### 11. Out of scope (v1)

- Per-issue / per-state routing. Design leaves a single seam where this would slot in: a function `(issue) => provider` that today returns the static config value.
- Mid-flight provider switching on a single issue.
- Renaming `claude_totals` to a provider-neutral name. (Out of scope; keeps spec/data continuity.)
- Cross-provider cost or token-usage normalization.
- Codex-specific features without a Claude analog (custom MCP wiring, custom instructions files).
