# Codex Provider Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OpenAI Codex (`@openai/codex-sdk`) as a second agent provider in dalang, selectable per-workflow via a top-level `agent_provider` field in WORKFLOW.md.

**Architecture:** The agent layer's existing `RunQuery` interface and `RuntimeEvent` union already form a provider-agnostic seam. This plan adds (1) a `codex:` config block alongside `claude:` with an `agent_provider` discriminator, (2) a `codex-runner.ts` that wraps `@openai/codex-sdk`'s `runStreamed()`, and (3) a `codex-event-mapper.ts` that translates Codex events to `RuntimeEvent`. `agent-runner.ts`, retry/backoff, concurrency control, and prompt construction are unchanged. Existing WORKFLOW.md files keep working — `agent_provider` defaults to `"claude"`.

**Tech Stack:** Bun, TypeScript, Zod (config), `@openai/codex-sdk` (new dep), `@anthropic-ai/claude-agent-sdk` (existing), `bun test`.

**Spec:** `docs/superpowers/specs/2026-04-30-codex-provider-design.md`

---

## File Structure

**New files:**
- `packages/dalang/src/agent/codex-runner.ts` — wraps `@openai/codex-sdk`, returns an `AsyncIterable<unknown>`. Mirrors `sdk-runner.ts`.
- `packages/dalang/src/agent/codex-event-mapper.ts` — translates Codex SDK events to dalang `RuntimeEvent`. Mirrors `event-mapper.ts`.
- `packages/dalang/tests/agent/codex-event-mapper.test.ts` — unit tests for the Codex event mapper.
- `packages/dalang/tests/agent/codex-runner.test.ts` — smoke test that the runner returns an async iterable.
- `packages/dalang/tests/agent/agent-runner-codex.test.ts` — integration test running `runAttempt` with a fake Codex event stream.

**Modified files:**
- `packages/dalang/src/config/schema.ts` — add `agent_provider`, `CodexSchema`, defaults, and post-parse refinement.
- `packages/dalang/src/config/validate.ts` — add `missing_codex_executable_path`, `codex_auth_inactive`, `probeCodexAuth`, branch `validateForDispatch` on provider.
- `packages/dalang/src/agent/agent-runner.ts` — reshape `AgentConfig` and `RunQueryOptions` into discriminated unions; pass through provider-specific bag.
- `packages/dalang/src/agent/sdk-runner.ts` — read `permissionMode` from the new `claude` bag instead of a flat field.
- `packages/dalang/src/orchestrator/orchestrator.ts` — build `AgentConfig` from the active provider's config block; thread it into `runAttempt`.
- `packages/dalang/src/cli/bootstrap.ts` — select `runQuery` based on `agent_provider`.
- `packages/dalang/tests/config/schema.test.ts` — add coverage for `agent_provider`, refinement, and codex defaults.
- `packages/dalang/tests/config/validate.test.ts` — add coverage for codex provider validation paths.
- `packages/dalang/tests/agent/sdk-runner.test.ts` — update to new options shape.
- `packages/dalang/tests/agent/agent-runner.test.ts` — update Claude tests to new `AgentConfig` shape.
- `packages/dalang/package.json` — add `@openai/codex-sdk` dependency.

---

### Task 1: Install `@openai/codex-sdk` and add Codex schemas

**Files:**
- Modify: `packages/dalang/package.json`
- Modify: `packages/dalang/src/config/schema.ts`

- [ ] **Step 1: Install the dependency**

Run from the repo root:

```bash
bun add @openai/codex-sdk --cwd packages/dalang
```

Expected: `package.json` and `bun.lock` updated; `node_modules/@openai/codex-sdk` exists.

- [ ] **Step 2: Add Codex schemas, `agent_provider`, and defaults to `schema.ts`**

Open `packages/dalang/src/config/schema.ts`. Above `ClaudePermissionMode`, add:

```ts
export const AgentProvider = z.enum(["claude", "codex"]);

export const CodexSandboxMode = z.enum([
  "read-only",
  "workspace-write",
  "danger-full-access",
]);

export const CodexApprovalPolicy = z.enum([
  "untrusted",
  "on-failure",
  "on-request",
  "never",
]);

export const CodexSchema = z.object({
  executable_path: z.string().min(1),
  model: z.string().min(1),
  sandbox_mode: CodexSandboxMode,
  approval_policy: CodexApprovalPolicy,
  turn_timeout_ms: z.number().int().positive(),
  read_timeout_ms: z.number().int().positive(),
  stall_timeout_ms: z.number().int(),
});
```

Update `WorkflowFrontMatterSchema` — add `agent_provider` (defaults to `"claude"`) and an optional `codex` block; keep `claude` as-is for now (it stays required in this task; we relax it in Task 2):

```ts
export const WorkflowFrontMatterSchema = z.object({
  tracker: TrackerSchema,
  repo: RepoSchema,
  polling: PollingSchema,
  workspace: WorkspaceSchema,
  hooks: HooksSchema,
  agent: AgentSchema,
  agent_provider: AgentProvider.default("claude"),
  claude: ClaudeSchema,
  codex: CodexSchema.optional(),
  server: ServerSchema,
  pr_checks: PrChecksSchema,
});
```

Add Codex defaults to `DEFAULTS`:

```ts
const DEFAULTS = {
  // ...existing fields unchanged...
  agent_provider: "claude",
  claude: {
    executable_path: "claude",
    model: "claude-opus-4-7",
    permission_mode: "auto",
    turn_timeout_ms: 3600000,
    read_timeout_ms: 5000,
    stall_timeout_ms: 300000,
  },
  codex: {
    executable_path: "codex",
    model: "gpt-5.5",
    sandbox_mode: "workspace-write",
    approval_policy: "never",
    turn_timeout_ms: 3600000,
    read_timeout_ms: 5000,
    stall_timeout_ms: 300000,
  },
  // ...
};
```

- [ ] **Step 3: Add a test for the new defaults and shape**

Append to `packages/dalang/tests/config/schema.test.ts`:

```ts
test("applyDefaults fills codex block and defaults agent_provider to claude", () => {
  const result = applyDefaults({});
  expect(result.agent_provider).toBe("claude");
  expect(result.codex?.executable_path).toBe("codex");
  expect(result.codex?.model).toBe("gpt-5.5");
  expect(result.codex?.sandbox_mode).toBe("workspace-write");
  expect(result.codex?.approval_policy).toBe("never");
});

test("accepts agent_provider=codex with a codex block", () => {
  const cfg = applyDefaults({ agent_provider: "codex" });
  const parsed = WorkflowFrontMatterSchema.parse(cfg);
  expect(parsed.agent_provider).toBe("codex");
  expect(parsed.codex?.model).toBe("gpt-5.5");
});

test("rejects unknown codex.sandbox_mode", () => {
  const bad = applyDefaults({});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (bad.codex as any).sandbox_mode = "kitchen-sink";
  expect(() => WorkflowFrontMatterSchema.parse(bad)).toThrow();
});
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test packages/dalang/tests/config/schema.test.ts
```

Expected: all tests pass, including existing ones.

- [ ] **Step 5: Run typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/dalang/package.json bun.lock \
  packages/dalang/src/config/schema.ts \
  packages/dalang/tests/config/schema.test.ts
git commit -m "feat(dalang): add codex schemas and agent_provider discriminator"
```

---

### Task 2: Add post-parse refinement (active provider block must be present)

**Files:**
- Modify: `packages/dalang/src/config/schema.ts`
- Modify: `packages/dalang/tests/config/schema.test.ts`

- [ ] **Step 1: Write a failing test — codex provider with no codex block must reject**

Append to `packages/dalang/tests/config/schema.test.ts`:

```ts
test("rejects agent_provider=codex without a codex block", () => {
  const cfg = applyDefaults({}) as Record<string, unknown>;
  cfg.agent_provider = "codex";
  delete cfg.codex;
  expect(() => WorkflowFrontMatterSchema.parse(cfg)).toThrow(/codex/i);
});

test("rejects agent_provider=claude without a claude block", () => {
  const cfg = applyDefaults({}) as Record<string, unknown>;
  delete cfg.claude;
  expect(() => WorkflowFrontMatterSchema.parse(cfg)).toThrow(/claude/i);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
bun test packages/dalang/tests/config/schema.test.ts -t "without"
```

Expected: failures — current schema either accepts the input or fails for unrelated reasons.

- [ ] **Step 3: Make `claude` optional and add `superRefine`**

In `schema.ts`, change `claude: ClaudeSchema` to `claude: ClaudeSchema.optional()` inside `WorkflowFrontMatterSchema`. Then wrap the schema with `.superRefine`:

```ts
const RawWorkflowFrontMatterSchema = z.object({
  tracker: TrackerSchema,
  repo: RepoSchema,
  polling: PollingSchema,
  workspace: WorkspaceSchema,
  hooks: HooksSchema,
  agent: AgentSchema,
  agent_provider: AgentProvider.default("claude"),
  claude: ClaudeSchema.optional(),
  codex: CodexSchema.optional(),
  server: ServerSchema,
  pr_checks: PrChecksSchema,
});

export const WorkflowFrontMatterSchema = RawWorkflowFrontMatterSchema.superRefine((cfg, ctx) => {
  if (cfg.agent_provider === "claude" && !cfg.claude) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["claude"],
      message: "claude block is required when agent_provider is \"claude\"",
    });
  }
  if (cfg.agent_provider === "codex" && !cfg.codex) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["codex"],
      message: "codex block is required when agent_provider is \"codex\"",
    });
  }
});

export type WorkflowFrontMatter = z.infer<typeof WorkflowFrontMatterSchema>;
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test packages/dalang/tests/config/
```

Expected: all schema and reload tests pass, including the new ones.

- [ ] **Step 5: Commit**

```bash
git add packages/dalang/src/config/schema.ts \
  packages/dalang/tests/config/schema.test.ts
git commit -m "feat(dalang): require provider block matching agent_provider"
```

---

### Task 3: Reshape `AgentConfig` and `RunQueryOptions` into discriminated unions

This task changes the runtime types but only the Claude branch is wired. Codex branch types are added so tasks 6–7 can fill them in cleanly.

**Files:**
- Modify: `packages/dalang/src/agent/agent-runner.ts`
- Modify: `packages/dalang/src/agent/sdk-runner.ts`
- Modify: `packages/dalang/src/orchestrator/orchestrator.ts`
- Modify: `packages/dalang/tests/agent/sdk-runner.test.ts`
- Modify: `packages/dalang/tests/agent/agent-runner.test.ts`

- [ ] **Step 1: Update `AgentConfig` and `RunQueryOptions` in `agent-runner.ts`**

Replace the existing `AgentConfig` and `RunQueryOptions` interfaces in `packages/dalang/src/agent/agent-runner.ts` with:

```ts
export interface CommonAgentConfig {
  model: string;
  executablePath: string;
  turnTimeoutMs: number;
  readTimeoutMs: number;
  stallTimeoutMs: number;
  maxTurns: number;
}

export interface ClaudeAgentConfig extends CommonAgentConfig {
  provider: "claude";
  permissionMode: "auto" | "default" | "plan" | "bypassPermissions";
}

export interface CodexAgentConfig extends CommonAgentConfig {
  provider: "codex";
  sandboxMode: "read-only" | "workspace-write" | "danger-full-access";
  approvalPolicy: "untrusted" | "on-failure" | "on-request" | "never";
}

export type AgentConfig = ClaudeAgentConfig | CodexAgentConfig;

export interface RunQueryOptions {
  prompt: string;
  cwd: string;
  model: string;
  executablePath: string;
  abortSignal?: AbortSignal;
  resumeSessionId?: string;
  claude?: { permissionMode: ClaudeAgentConfig["permissionMode"] };
  codex?: {
    sandboxMode: CodexAgentConfig["sandboxMode"];
    approvalPolicy: CodexAgentConfig["approvalPolicy"];
  };
}
```

In the same file, update `driveOneTurn` so it threads the provider bag rather than a flat `permissionMode`. Replace the `runQuery` call inside `driveOneTurn`:

```ts
const iter = opts.runQuery({
  prompt: opts.prompt,
  cwd: opts.workspacePath,
  model: opts.config.model,
  executablePath: opts.config.executablePath,
  abortSignal: turnAbort.signal,
  resumeSessionId: opts.resumeSessionId,
  claude:
    opts.config.provider === "claude"
      ? { permissionMode: opts.config.permissionMode }
      : undefined,
  codex:
    opts.config.provider === "codex"
      ? {
          sandboxMode: opts.config.sandboxMode,
          approvalPolicy: opts.config.approvalPolicy,
        }
      : undefined,
});
```

- [ ] **Step 2: Update `sdk-runner.ts` to read `permissionMode` from the bag**

Replace the body of `sdk-runner.ts` with:

```ts
// packages/dalang/src/agent/sdk-runner.ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { RunQuery, RunQueryOptions } from "./agent-runner";

export const sdkRunQuery: RunQuery = (opts: RunQueryOptions) => {
  const permissionMode = opts.claude?.permissionMode ?? "default";
  return query({
    prompt: opts.prompt,
    options: {
      cwd: opts.cwd,
      model: opts.model,
      permissionMode,
      pathToClaudeCodeExecutable: opts.executablePath,
      resume: opts.resumeSessionId,
      abortController: opts.abortSignal ? abortSignalToController(opts.abortSignal) : undefined,
    },
  }) as AsyncIterable<unknown>;
};

function abortSignalToController(signal: AbortSignal): AbortController {
  const c = new AbortController();
  if (signal.aborted) c.abort();
  else signal.addEventListener("abort", () => c.abort(), { once: true });
  return c;
}
```

- [ ] **Step 3: Update `orchestrator.ts` to build the discriminated `AgentConfig`**

In `packages/dalang/src/orchestrator/orchestrator.ts` around line 211, replace the `config: { ... }` block with a helper-built object:

```ts
config: this.buildAgentConfig(),
```

Add this method on the class (place it near other private helpers):

```ts
private buildAgentConfig(): AgentConfig {
  const common = {
    maxTurns: this.cfg.agent.max_turns,
  };
  if (this.cfg.agent_provider === "codex") {
    if (!this.cfg.codex) throw new Error("codex block missing despite agent_provider=codex");
    return {
      provider: "codex",
      ...common,
      model: this.cfg.codex.model,
      executablePath: this.cfg.codex.executable_path,
      turnTimeoutMs: this.cfg.codex.turn_timeout_ms,
      readTimeoutMs: this.cfg.codex.read_timeout_ms,
      stallTimeoutMs: this.cfg.codex.stall_timeout_ms,
      sandboxMode: this.cfg.codex.sandbox_mode,
      approvalPolicy: this.cfg.codex.approval_policy,
    };
  }
  if (!this.cfg.claude) throw new Error("claude block missing despite agent_provider=claude");
  return {
    provider: "claude",
    ...common,
    model: this.cfg.claude.model,
    executablePath: this.cfg.claude.executable_path,
    turnTimeoutMs: this.cfg.claude.turn_timeout_ms,
    readTimeoutMs: this.cfg.claude.read_timeout_ms,
    stallTimeoutMs: this.cfg.claude.stall_timeout_ms,
    permissionMode: this.cfg.claude.permission_mode,
  };
}
```

Add `import type { AgentConfig } from "../agent/agent-runner";` at the top of the file if it's not already imported.

- [ ] **Step 4: Update the `sdk-runner.test.ts` smoke test to the new options shape**

Replace the call site in `packages/dalang/tests/agent/sdk-runner.test.ts`:

```ts
const it = sdkRunQuery({
  prompt: "hello", cwd: "/tmp",
  claude: { permissionMode: "auto" },
  model: "claude-opus-4-7",
  executablePath: "claude",
});
```

(Drop the bare `permissionMode` field; everything else stays.)

- [ ] **Step 5: Update `agent-runner.test.ts` config fixtures**

In `packages/dalang/tests/agent/agent-runner.test.ts`, every `config: {...}` literal needs a `provider: "claude"` discriminator and the `permissionMode` stays where it is. For example:

```ts
config: {
  provider: "claude" as const,
  permissionMode: "auto",
  model: "claude-opus-4-7",
  executablePath: "claude",
  turnTimeoutMs: 60000,
  readTimeoutMs: 5000,
  stallTimeoutMs: 30000,
  maxTurns: 5,
}
```

Apply this update to every test that constructs an `AgentConfig` (use editor search for `permissionMode:` inside the test file).

- [ ] **Step 6: Run tests to verify everything still passes**

```bash
bun test packages/dalang/tests/agent/
bun run typecheck
```

Expected: green.

- [ ] **Step 7: Commit**

```bash
git add packages/dalang/src/agent/agent-runner.ts \
  packages/dalang/src/agent/sdk-runner.ts \
  packages/dalang/src/orchestrator/orchestrator.ts \
  packages/dalang/tests/agent/agent-runner.test.ts \
  packages/dalang/tests/agent/sdk-runner.test.ts
git commit -m "refactor(dalang): make AgentConfig and RunQueryOptions provider-discriminated"
```

---

### Task 4: Add `probeCodexAuth` and provider-branched validation

**Files:**
- Modify: `packages/dalang/src/config/validate.ts`
- Modify: `packages/dalang/tests/config/validate.test.ts`

- [ ] **Step 1: Write failing tests for the new validation paths**

Append to `packages/dalang/tests/config/validate.test.ts` (use the same pattern as the existing tests in that file):

```ts
import { applyDefaults } from "../../src/config/schema";
import { validateForDispatch, ValidationError, probeCodexAuth } from "../../src/config/validate";

test("validateForDispatch with codex provider rejects empty executable_path", () => {
  const cfg = applyDefaults({ agent_provider: "codex" });
  cfg.codex!.executable_path = "";
  expect(() => validateForDispatch(cfg)).toThrow(ValidationError);
  try {
    validateForDispatch(cfg);
  } catch (e) {
    expect((e as ValidationError).code).toBe("missing_codex_executable_path");
  }
});

test("validateForDispatch with claude provider does not require codex block fields", () => {
  const cfg = applyDefaults({});
  expect(cfg.agent_provider).toBe("claude");
  // Should not throw even if we corrupt codex (it's the inactive block).
  cfg.codex!.executable_path = "";
  expect(() => validateForDispatch(cfg)).not.toThrow();
});

test("probeCodexAuth resolves null on success", async () => {
  // /usr/bin/true exits 0 — used as a stand-in for a working codex binary.
  const result = await probeCodexAuth("/usr/bin/true");
  expect(result).toBeNull();
});

test("probeCodexAuth resolves a message on failure", async () => {
  const result = await probeCodexAuth("/usr/bin/false");
  expect(typeof result).toBe("string");
  expect(result).toMatch(/codex/i);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
bun test packages/dalang/tests/config/validate.test.ts
```

Expected: failures (the new code/imports don't exist yet).

- [ ] **Step 3: Update `validate.ts`**

Replace `packages/dalang/src/config/validate.ts` with:

```ts
// packages/dalang/src/config/validate.ts
import type { WorkflowFrontMatter } from "./schema";
import { resolveEnvValue } from "./env-resolver";

export type ValidationCode =
  | "unsupported_tracker_kind"
  | "missing_tracker_api_key"
  | "missing_claude_executable_path"
  | "missing_codex_executable_path"
  | "missing_repo_config"
  | "claude_auth_inactive"
  | "codex_auth_inactive";

export class ValidationError extends Error {
  code: ValidationCode;
  constructor(code: ValidationCode, message: string) {
    super(message);
    this.code = code;
  }
}

export function validateForDispatch(cfg: WorkflowFrontMatter): void {
  if (cfg.tracker.kind !== "tok-juara") {
    throw new ValidationError("unsupported_tracker_kind", `unsupported tracker kind: ${cfg.tracker.kind}`);
  }
  if (cfg.tracker.api_key !== null && cfg.tracker.api_key !== undefined) {
    const resolved = resolveEnvValue(cfg.tracker.api_key);
    if (resolved === null && cfg.tracker.api_key.startsWith("$")) {
      throw new ValidationError("missing_tracker_api_key", `tracker.api_key resolves to empty: ${cfg.tracker.api_key}`);
    }
  }
  if (cfg.agent_provider === "claude") {
    if (!cfg.claude || cfg.claude.executable_path.trim().length === 0) {
      throw new ValidationError("missing_claude_executable_path", "claude.executable_path is required");
    }
  } else if (cfg.agent_provider === "codex") {
    if (!cfg.codex || cfg.codex.executable_path.trim().length === 0) {
      throw new ValidationError("missing_codex_executable_path", "codex.executable_path is required");
    }
  }
}

/** Probes `claude` CLI subscription status. Resolves `null` on success, error message on failure. */
export async function probeClaudeAuth(executablePath: string): Promise<string | null> {
  const proc = Bun.spawn([executablePath, "--version"], { stdout: "pipe", stderr: "pipe" });
  const exitCode = await proc.exited;
  if (exitCode === 0) return null;
  return `claude probe exited with code ${exitCode}`;
}

/** Probes `codex` CLI availability. Resolves `null` on success, error message on failure. */
export async function probeCodexAuth(executablePath: string): Promise<string | null> {
  const proc = Bun.spawn([executablePath, "--version"], { stdout: "pipe", stderr: "pipe" });
  const exitCode = await proc.exited;
  if (exitCode === 0) return null;
  return `codex probe exited with code ${exitCode}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test packages/dalang/tests/config/validate.test.ts
bun run typecheck
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add packages/dalang/src/config/validate.ts \
  packages/dalang/tests/config/validate.test.ts
git commit -m "feat(dalang): probeCodexAuth and provider-branched validation"
```

---

### Task 5: Codex event mapper — happy path

This task lands the file with a basic, well-tested mapping. Edge cases (errors, token usage) are added in Task 6.

**Files:**
- Create: `packages/dalang/src/agent/codex-event-mapper.ts`
- Create: `packages/dalang/tests/agent/codex-event-mapper.test.ts`

- [ ] **Step 1: Write failing tests for the happy-path mapping**

Create `packages/dalang/tests/agent/codex-event-mapper.test.ts`:

```ts
// packages/dalang/tests/agent/codex-event-mapper.test.ts
import { test, expect } from "bun:test";
import { mapCodexEvent } from "../../src/agent/codex-event-mapper";

test("thread.started event maps to session_started with thread_id", () => {
  const evt = mapCodexEvent({ type: "thread.started", threadId: "abc-123" });
  expect(evt?.event).toBe("session_started");
  expect(evt?.thread_id).toBe("abc-123");
});

test("agent_message maps to notification with truncated text", () => {
  const evt = mapCodexEvent({ type: "agent_message", text: "hello world" });
  expect(evt?.event).toBe("notification");
  expect((evt as { message: string }).message).toBe("hello world");
});

test("tool_call maps to notification with tool_use:<name>", () => {
  const evt = mapCodexEvent({ type: "tool_call", name: "shell" });
  expect(evt?.event).toBe("notification");
  expect((evt as { message: string }).message).toBe("tool_use:shell");
});

test("tool_call.completed maps to notification tool_result", () => {
  const evt = mapCodexEvent({ type: "tool_call.completed" });
  expect(evt?.event).toBe("notification");
  expect((evt as { message: string }).message).toBe("tool_result");
});

test("task.completed maps to turn_completed", () => {
  const evt = mapCodexEvent({ type: "task.completed" });
  expect(evt?.event).toBe("turn_completed");
});

test("unknown type falls through to other_message", () => {
  const evt = mapCodexEvent({ type: "something_new" });
  expect(evt?.event).toBe("other_message");
});

test("null and non-object inputs return null", () => {
  expect(mapCodexEvent(null)).toBeNull();
  expect(mapCodexEvent(42)).toBeNull();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
bun test packages/dalang/tests/agent/codex-event-mapper.test.ts
```

Expected: all fail — module does not exist.

- [ ] **Step 3: Implement the mapper**

Create `packages/dalang/src/agent/codex-event-mapper.ts`:

```ts
// packages/dalang/src/agent/codex-event-mapper.ts
import type { RuntimeEvent } from "../types";

const TRUNC = 2000;

function truncate(s: string): string {
  if (s.length <= TRUNC) return s;
  return s.slice(0, TRUNC) + `... [truncated ${s.length - TRUNC} bytes]`;
}

function nowIso(): string {
  return new Date().toISOString();
}

// Codex SDK exposes structured events from runStreamed(). The event names below
// reflect the @openai/codex-sdk contract as of April 2026; any drift should be
// caught by the tests in codex-event-mapper.test.ts and the integration test in
// agent-runner-codex.test.ts.
export function mapCodexEvent(raw: unknown): RuntimeEvent | null {
  if (raw === null || raw === undefined || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const type = m.type;

  if (type === "thread.started") {
    return {
      event: "session_started",
      timestamp: nowIso(),
      thread_id: typeof m.threadId === "string" ? m.threadId : undefined,
    };
  }

  if (type === "agent_message" || type === "agent_message.delta") {
    const text = typeof m.text === "string" ? m.text : "";
    return { event: "notification", timestamp: nowIso(), message: truncate(text) };
  }

  if (type === "tool_call") {
    const name = typeof m.name === "string" ? m.name : "?";
    return { event: "notification", timestamp: nowIso(), message: `tool_use:${name}` };
  }

  if (type === "tool_call.completed") {
    return { event: "notification", timestamp: nowIso(), message: "tool_result" };
  }

  if (type === "task.completed") {
    return { event: "turn_completed", timestamp: nowIso() };
  }

  if (typeof type === "string") {
    return { event: "other_message", timestamp: nowIso(), message: type };
  }
  return { event: "malformed", timestamp: nowIso() };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
bun test packages/dalang/tests/agent/codex-event-mapper.test.ts
bun run typecheck
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add packages/dalang/src/agent/codex-event-mapper.ts \
  packages/dalang/tests/agent/codex-event-mapper.test.ts
git commit -m "feat(dalang): codex-event-mapper happy-path mapping"
```

---

### Task 6: Codex event mapper — errors and token usage

**Files:**
- Modify: `packages/dalang/src/agent/codex-event-mapper.ts`
- Modify: `packages/dalang/tests/agent/codex-event-mapper.test.ts`

- [ ] **Step 1: Write failing tests for error and usage mapping**

Append to `packages/dalang/tests/agent/codex-event-mapper.test.ts`:

```ts
test("task.failed maps to turn_ended_with_error with reason", () => {
  const evt = mapCodexEvent({ type: "task.failed", reason: "timeout" });
  expect(evt?.event).toBe("turn_ended_with_error");
  expect((evt as { reason?: string }).reason).toBe("timeout");
});

test("startup error maps to startup_failed", () => {
  const evt = mapCodexEvent({ type: "error", phase: "startup", message: "auth_failed" });
  expect(evt?.event).toBe("startup_failed");
  expect((evt as { reason?: string }).reason).toBe("auth_failed");
});

test("task.completed propagates token usage with reasoning rolled into output", () => {
  const evt = mapCodexEvent({
    type: "task.completed",
    usage: { input_tokens: 100, output_tokens: 50, reasoning_tokens: 30 },
  });
  expect(evt?.event).toBe("turn_completed");
  expect(evt?.usage?.input_tokens).toBe(100);
  expect(evt?.usage?.output_tokens).toBe(80);
  expect(evt?.usage?.total_tokens).toBe(180);
});

test("task.completed prefers usage.total_tokens when provided", () => {
  const evt = mapCodexEvent({
    type: "task.completed",
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 99 },
  });
  expect(evt?.usage?.total_tokens).toBe(99);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
bun test packages/dalang/tests/agent/codex-event-mapper.test.ts
```

Expected: the four new tests fail.

- [ ] **Step 3: Extend the mapper**

In `codex-event-mapper.ts`, replace the `task.completed` branch with:

```ts
  if (type === "task.completed") {
    const u = m.usage as Record<string, unknown> | undefined;
    let usage: RuntimeEvent["usage"] | undefined;
    if (u) {
      const input = typeof u.input_tokens === "number" ? u.input_tokens : 0;
      const output = typeof u.output_tokens === "number" ? u.output_tokens : 0;
      const reasoning = typeof u.reasoning_tokens === "number" ? u.reasoning_tokens : 0;
      const total = typeof u.total_tokens === "number" ? u.total_tokens : input + output + reasoning;
      usage = {
        input_tokens: input,
        output_tokens: output + reasoning,
        total_tokens: total,
      };
    }
    return { event: "turn_completed", timestamp: nowIso(), usage };
  }

  if (type === "task.failed") {
    return {
      event: "turn_ended_with_error",
      timestamp: nowIso(),
      reason: typeof m.reason === "string" ? m.reason : undefined,
    };
  }

  if (type === "error" && m.phase === "startup") {
    return {
      event: "startup_failed",
      timestamp: nowIso(),
      reason: typeof m.message === "string" ? m.message : undefined,
    };
  }
```

Place these branches **above** the final `if (typeof type === "string")` fallthrough.

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test packages/dalang/tests/agent/codex-event-mapper.test.ts
bun run typecheck
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add packages/dalang/src/agent/codex-event-mapper.ts \
  packages/dalang/tests/agent/codex-event-mapper.test.ts
git commit -m "feat(dalang): codex-event-mapper error and token usage paths"
```

---

### Task 7: Codex runner

**Files:**
- Create: `packages/dalang/src/agent/codex-runner.ts`
- Create: `packages/dalang/tests/agent/codex-runner.test.ts`

- [ ] **Step 1: Write a smoke test for the runner**

Create `packages/dalang/tests/agent/codex-runner.test.ts`:

```ts
// packages/dalang/tests/agent/codex-runner.test.ts
import { test, expect } from "bun:test";
import { codexRunQuery } from "../../src/agent/codex-runner";

test("codexRunQuery returns an async iterable (smoke)", () => {
  const it = codexRunQuery({
    prompt: "hello",
    cwd: "/tmp",
    codex: { sandboxMode: "read-only", approvalPolicy: "never" },
    model: "gpt-5.5",
    executablePath: "codex",
  });
  expect(typeof (it as AsyncIterable<unknown>)[Symbol.asyncIterator]).toBe("function");
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
bun test packages/dalang/tests/agent/codex-runner.test.ts
```

Expected: failure — module does not exist.

- [ ] **Step 3: Implement the runner**

Create `packages/dalang/src/agent/codex-runner.ts`:

```ts
// packages/dalang/src/agent/codex-runner.ts
import { Codex } from "@openai/codex-sdk";
import type { RunQuery, RunQueryOptions } from "./agent-runner";

// Wraps @openai/codex-sdk so dalang's agent layer can drive Codex through the
// same RunQuery contract used for Claude. The exact SDK method names below
// reflect the package as of April 2026; if the SDK shape changes, this is the
// only file that needs to adapt.
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

If `@openai/codex-sdk` exposes different method or option names at install time, adjust this file (and only this file). The smoke test only checks that the return value is async-iterable; it does not exercise the SDK.

- [ ] **Step 4: Run the test to verify it passes**

```bash
bun test packages/dalang/tests/agent/codex-runner.test.ts
bun run typecheck
```

Expected: green. If typecheck fails because of an SDK API mismatch, fix `codex-runner.ts` to match the installed SDK's method names — same intent, different surface.

- [ ] **Step 5: Commit**

```bash
git add packages/dalang/src/agent/codex-runner.ts \
  packages/dalang/tests/agent/codex-runner.test.ts
git commit -m "feat(dalang): codex-runner wraps @openai/codex-sdk"
```

---

### Task 8: Wire runner selection into orchestrator and bootstrap

**Files:**
- Modify: `packages/dalang/src/cli/bootstrap.ts`
- Modify: `packages/dalang/src/orchestrator/orchestrator.ts`

- [ ] **Step 1: Update bootstrap to pick the runner from `agent_provider`**

In `packages/dalang/src/cli/bootstrap.ts`, find the line:

```ts
const runQuery = this.opts.runQueryFactory ? this.opts.runQueryFactory() : sdkRunQuery;
```

Replace it with:

```ts
const runQuery = this.opts.runQueryFactory
  ? this.opts.runQueryFactory()
  : cfg.agent_provider === "codex"
    ? codexRunQuery
    : sdkRunQuery;
```

Add `import { codexRunQuery } from "../agent/codex-runner";` near the existing `sdkRunQuery` import. `cfg` here refers to the loaded `WorkflowFrontMatter` already in scope; if the variable name differs, use the local variable that holds the parsed front matter.

- [ ] **Step 2: Verify the orchestrator still compiles and existing tests pass**

```bash
bun test packages/dalang/tests/
bun run typecheck
```

Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add packages/dalang/src/cli/bootstrap.ts
git commit -m "feat(dalang): select runQuery based on agent_provider"
```

---

### Task 9: End-to-end agent-runner test against a fake Codex stream

This proves `agent-runner.ts` is genuinely provider-agnostic.

**Files:**
- Create: `packages/dalang/tests/agent/agent-runner-codex.test.ts`

- [ ] **Step 1: Write the integration test**

Create `packages/dalang/tests/agent/agent-runner-codex.test.ts`:

```ts
// packages/dalang/tests/agent/agent-runner-codex.test.ts
import { test, expect } from "bun:test";
import { runAttempt } from "../../src/agent/agent-runner";
import type { NormalizedIssue, RuntimeEvent } from "../../src/types";

const issue: NormalizedIssue = {
  id: "iss-1",
  identifier: "TOK-1",
  title: "Test",
  description: null,
  priority: null,
  state: "Done",
  branch_name: null,
  url: "https://example.invalid/iss-1",
  external_ref: null,
  internal_ref: null,
  labels: [],
  blocked_by: [],
  created_at: "2026-04-30T00:00:00Z",
  updated_at: "2026-04-30T00:00:00Z",
};

test("runAttempt drives a Codex-shaped event stream end-to-end", async () => {
  // Fake Codex events: thread.started → agent_message → task.completed.
  const events: unknown[] = [
    { type: "thread.started", threadId: "codex-thread-1" },
    { type: "agent_message", text: "hello" },
    {
      type: "task.completed",
      usage: { input_tokens: 12, output_tokens: 7, reasoning_tokens: 3 },
    },
  ];

  // The runner here returns the Codex events directly — agent-runner uses the
  // Claude mapper unconditionally today, so this test only passes once the
  // event-mapper selection is wired (Task 10). Keep this test in the same
  // commit as Task 10 if running tests between tasks.
  const collected: RuntimeEvent[] = [];
  const result = await runAttempt({
    issue,
    attempt: 1,
    promptTemplate: "{{issue.title}}",
    workspacePath: "/tmp/workspace",
    config: {
      provider: "codex" as const,
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
      model: "gpt-5.5",
      executablePath: "codex",
      turnTimeoutMs: 60000,
      readTimeoutMs: 5000,
      stallTimeoutMs: 30000,
      maxTurns: 1,
    },
    tracker: { endpoint: "http://localhost", api_key: null },
    trackerRefresh: async () => null,
    isActiveState: () => false,
    runQuery: async function* () {
      for (const e of events) yield e;
    },
    onEvent: (e) => { collected.push(e); },
  });

  expect(result.success).toBe(true);
  expect(result.thread_id).toBe("codex-thread-1");
  expect(result.tokens.input_tokens).toBe(12);
  expect(result.tokens.output_tokens).toBe(10); // 7 + 3 reasoning
  expect(result.tokens.total_tokens).toBe(22);
  expect(collected.some((e) => e.event === "session_started")).toBe(true);
  expect(collected.some((e) => e.event === "turn_completed")).toBe(true);
});
```

- [ ] **Step 2: Run the test to confirm it fails for the right reason**

```bash
bun test packages/dalang/tests/agent/agent-runner-codex.test.ts
```

Expected: failures — `agent-runner.ts` currently routes every event through `mapSdkMessage` (Claude mapper). Codex events fall through to `other_message` so token totals are zero. Move on to Task 10.

---

### Task 10: Make `agent-runner` select the event mapper by provider

**Files:**
- Modify: `packages/dalang/src/agent/agent-runner.ts`

- [ ] **Step 1: Update `agent-runner.ts` to pick the mapper based on `config.provider`**

At the top of `packages/dalang/src/agent/agent-runner.ts`, add the import:

```ts
import { mapCodexEvent } from "./codex-event-mapper";
```

Inside `driveOneTurn`, replace `const evt = mapSdkMessage(raw);` with:

```ts
const evt =
  opts.config.provider === "codex" ? mapCodexEvent(raw) : mapSdkMessage(raw);
```

`opts.config` already lives on `DriveOneTurnOptions`. No other changes needed.

- [ ] **Step 2: Run all agent tests**

```bash
bun test packages/dalang/tests/agent/
bun run typecheck
```

Expected: green, including the new Codex integration test.

- [ ] **Step 3: Run the full test suite and lint**

```bash
bun test
bun run typecheck
bun run lint
```

Expected: green.

- [ ] **Step 4: Commit**

```bash
git add packages/dalang/src/agent/agent-runner.ts \
  packages/dalang/tests/agent/agent-runner-codex.test.ts
git commit -m "feat(dalang): select event mapper by provider in runAttempt"
```

---

### Task 11: Update spec cross-reference (no code)

**Files:**
- Modify: `docs/superpowers/specs/2026-04-29-dalang-orchestrator-design.md`

- [ ] **Step 1: Add a single line to the orchestrator spec linking to the codex provider design**

Open `docs/superpowers/specs/2026-04-29-dalang-orchestrator-design.md`. Find the section that describes the agent layer (look for `RunQuery` or `claude` config). Append a single sentence:

```markdown
> See `2026-04-30-codex-provider-design.md` for OpenAI Codex as an alternative `agent_provider`.
```

If the spec has no obvious agent-layer section header, add the note under "Configuration" or at the top of the file under the existing summary.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-04-29-dalang-orchestrator-design.md
git commit -m "docs(dalang): cross-link codex provider design from orchestrator spec"
```

---

## Verification Checklist

After all tasks complete, run from repo root:

```bash
bun test
bun run typecheck
bun run lint
```

All three must be green. Then verify by hand:

- [ ] WORKFLOW.md without `agent_provider` still loads (defaults to `"claude"`).
- [ ] WORKFLOW.md with `agent_provider: "codex"` and a populated `codex:` block parses.
- [ ] WORKFLOW.md with `agent_provider: "codex"` but no `codex:` block fails validation with a message mentioning `codex`.
- [ ] `git log` since the start of this branch shows one commit per task.
