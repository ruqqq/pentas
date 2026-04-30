# Opencode Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opencode as a third agent provider in dalang (alongside claude and codex), gated by `agent_provider: "opencode"` in `WORKFLOW.md`, using a single shared opencode HTTP server for all workers.

**Architecture:** A new `opencode-server.ts` module owns one shared opencode server (spawned lazily, restarted on crash, shut down on daemon exit) and the global SSE event stream. A new `opencode-runner.ts` implements `RunQuery` by creating sessions, calling `session.promptAsync`, and tailing per-session events from a shared fan-out. A new `opencode-event-mapper.ts` translates opencode SSE events to dalang's `RuntimeEvent` union. The existing `agent-runner.ts` seam is unchanged except for a new branch in the event mapper switch and an `opencode` discriminator on `AgentConfig` / `RunQueryOptions`. Permissions are hardcoded to `allow` (not exposed in config).

**Tech Stack:** Bun, TypeScript (strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes), zod, `@opencode-ai/sdk` (1.14.30), `bun test`. Spec: `docs/superpowers/specs/2026-04-30-opencode-provider-design.md`.

---

## File Structure

**Create:**
- `packages/dalang/src/agent/opencode-server.ts` — singleton server + SSE fan-out
- `packages/dalang/src/agent/opencode-runner.ts` — `RunQuery` implementation
- `packages/dalang/src/agent/opencode-event-mapper.ts` — opencode events → `RuntimeEvent`
- `packages/dalang/tests/agent/opencode-server.test.ts`
- `packages/dalang/tests/agent/opencode-runner.test.ts`
- `packages/dalang/tests/agent/opencode-event-mapper.test.ts`
- `packages/dalang/tests/agent/agent-runner-opencode.test.ts`

**Modify:**
- `packages/dalang/package.json` — add `@opencode-ai/sdk` dep
- `packages/dalang/src/config/schema.ts` — add `OpencodeSchema`, extend `AgentProvider` and `applyDefaults`, extend `superRefine`
- `packages/dalang/src/config/validate.ts` — add `probeOpencodeAuth`, new `ValidationCode`s
- `packages/dalang/src/agent/agent-runner.ts` — add `OpencodeAgentConfig`, `OpencodeRunQueryOptions`, branch in `driveOneTurn`'s mapper switch
- `packages/dalang/src/orchestrator/orchestrator.ts` — extend `buildAgentConfig` and `reconcile`'s stall-timeout lookup
- `packages/dalang/src/cli/bootstrap.ts` — pick `opencodeRunQuery`, run `probeOpencodeAuth`, wire daemon shutdown
- `packages/dalang/tests/config/schema.test.ts` — opencode validation cases
- `packages/dalang/tests/config/validate.test.ts` — `probeOpencodeAuth` cases
- `packages/dalang/README.md` — document `agent_provider: "opencode"`

---

## Task 1: Install `@opencode-ai/sdk` and verify it loads

**Files:**
- Modify: `packages/dalang/package.json`

- [ ] **Step 1: Add dependency**

```bash
cd packages/dalang && bun add @opencode-ai/sdk@1.14.30
```

- [ ] **Step 2: Verify install resolves**

Run: `cd packages/dalang && bun -e 'import("@opencode-ai/sdk").then(m => console.log(Object.keys(m).slice(0,5)))'`
Expected: prints an array containing at least `createOpencode`, `createOpencodeClient`, `createOpencodeServer`.

- [ ] **Step 3: Typecheck still passes**

Run: `bun run typecheck` (from repo root)
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/dalang/package.json bun.lock
git commit -m "chore(dalang): add @opencode-ai/sdk dependency"
```

---

## Task 2: Extend `AgentProvider` enum and add `OpencodeSchema`

**Files:**
- Modify: `packages/dalang/src/config/schema.ts:42-65, 90-119, 155-181, 214-225`
- Test: `packages/dalang/tests/config/schema.test.ts`

- [ ] **Step 1: Write a failing test for the extended `AgentProvider` enum**

Append to `packages/dalang/tests/config/schema.test.ts`:

```ts
import { test, expect } from "bun:test";
import { applyDefaults, WorkflowFrontMatterSchema } from "../../src/config/schema";

test("agent_provider accepts \"opencode\"", () => {
  const cfg = applyDefaults({ agent_provider: "opencode", opencode: { model: "anthropic/claude-sonnet-4-6" } });
  const parsed = WorkflowFrontMatterSchema.safeParse(cfg);
  expect(parsed.success).toBe(true);
});

test("agent_provider=\"opencode\" without opencode block fails superRefine", () => {
  const cfg = applyDefaults({ agent_provider: "opencode" });
  // applyDefaults for opencode with no provided opencode block should leave opencode missing,
  // so superRefine fires.
  delete (cfg as Record<string, unknown>).opencode;
  const parsed = WorkflowFrontMatterSchema.safeParse(cfg);
  expect(parsed.success).toBe(false);
  if (!parsed.success) {
    expect(parsed.error.issues.some((i) => i.path[0] === "opencode")).toBe(true);
  }
});

test("opencode.model must be in provider/model form", () => {
  const cfg = applyDefaults({ agent_provider: "opencode", opencode: { model: "no-slash" } });
  const parsed = WorkflowFrontMatterSchema.safeParse(cfg);
  expect(parsed.success).toBe(false);
});
```

- [ ] **Step 2: Run the new tests — expect failures**

Run: `cd packages/dalang && bun test tests/config/schema.test.ts -t opencode`
Expected: FAIL — `"opencode"` not in enum, `OpencodeSchema` undefined, `applyDefaults` doesn't know opencode.

- [ ] **Step 3: Extend `AgentProvider` and add `OpencodeSchema` in `packages/dalang/src/config/schema.ts`**

Replace the line `export const AgentProvider = z.enum(["claude", "codex"]);` with:

```ts
export const AgentProvider = z.enum(["claude", "codex", "opencode"]);
```

After `CodexSchema` (around line 65), add:

```ts
export const OpencodeSchema = z.object({
  executable_path: z.string().min(1),
  model: z.string().min(1).regex(/^[^/]+\/.+$/, "model must be in providerID/modelID form"),
  small_model: z.string().min(1).regex(/^[^/]+\/.+$/).optional(),
  turn_timeout_ms: z.number().int().positive(),
  read_timeout_ms: z.number().int().positive(),
  stall_timeout_ms: z.number().int(),
});
```

In `RawWorkflowFrontMatterSchema` (around line 90), add a line after `codex: CodexSchema.optional(),`:

```ts
  opencode: OpencodeSchema.optional(),
```

In the `superRefine` block (around line 104), add a third clause after the codex one:

```ts
  if (cfg.agent_provider === "opencode" && !cfg.opencode) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["opencode"],
      message: "opencode block is required when agent_provider is \"opencode\"",
    });
  }
```

In `DEFAULTS` (around line 164), add after the `codex:` block:

```ts
  opencode: {
    executable_path: "opencode",
    model: "anthropic/claude-sonnet-4-6",
    turn_timeout_ms: 3600000,
    read_timeout_ms: 5000,
    stall_timeout_ms: 300000,
  },
```

In `applyDefaults` (around line 214), update the provider handling to a 3-way:

```ts
export function applyDefaults(raw: unknown): WorkflowFrontMatter {
  const provider = ((raw as { agent_provider?: string } | null | undefined)?.agent_provider
    ?? DEFAULTS.agent_provider) as "claude" | "codex" | "opencode";
  const base = deepClone(DEFAULTS) as Record<string, unknown>;
  if (provider === "codex") {
    delete base.claude;
    delete base.opencode;
  } else if (provider === "opencode") {
    delete base.claude;
    delete base.codex;
  } else {
    delete base.codex;
    delete base.opencode;
  }
  const merged = deepMerge(base as typeof DEFAULTS, raw ?? {}) as WorkflowFrontMatter;
  return merged;
}
```

- [ ] **Step 4: Run the schema tests — expect pass**

Run: `cd packages/dalang && bun test tests/config/schema.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Run full typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/dalang/src/config/schema.ts packages/dalang/tests/config/schema.test.ts
git commit -m "feat(dalang): extend WorkflowFrontMatter with opencode provider schema"
```

---

## Task 3: Add `probeOpencodeAuth` and validation codes

**Files:**
- Modify: `packages/dalang/src/config/validate.ts`
- Test: `packages/dalang/tests/config/validate.test.ts`

- [ ] **Step 1: Write failing tests for new validation codes and probe**

Append to `packages/dalang/tests/config/validate.test.ts`:

```ts
import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeOpencodeAuth, validateForDispatch, ValidationError } from "../../src/config/validate";
import { applyDefaults } from "../../src/config/schema";

function makeFakeBin(script: string): string {
  const dir = mkdtempSync(join(tmpdir(), "opencode-bin-"));
  const path = join(dir, "opencode");
  writeFileSync(path, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  chmodSync(path, 0o755);
  return path;
}

test("probeOpencodeAuth returns null when version OK and provider is in auth list", async () => {
  const bin = makeFakeBin(`
case "$1" in
  --version) echo "opencode 1.0.0"; exit 0;;
  auth)      echo '[{"provider":"anthropic"}]'; exit 0;;
esac
exit 0
`);
  const err = await probeOpencodeAuth(bin, "anthropic/claude-sonnet-4-6");
  expect(err).toBeNull();
});

test("probeOpencodeAuth returns error when --version exits non-zero", async () => {
  const bin = makeFakeBin(`exit 1`);
  const err = await probeOpencodeAuth(bin, "anthropic/foo");
  expect(err).not.toBeNull();
  expect(err).toContain("opencode probe");
});

test("probeOpencodeAuth returns error when provider missing from auth list", async () => {
  const bin = makeFakeBin(`
case "$1" in
  --version) echo "opencode 1.0.0"; exit 0;;
  auth)      echo '[{"provider":"openai"}]'; exit 0;;
esac
exit 0
`);
  const err = await probeOpencodeAuth(bin, "anthropic/claude-sonnet-4-6");
  expect(err).not.toBeNull();
  expect(err).toContain("anthropic");
});

test("validateForDispatch fails when agent_provider=opencode but block missing", () => {
  const cfg = applyDefaults({ agent_provider: "opencode" });
  delete (cfg as Record<string, unknown>).opencode;
  expect(() => validateForDispatch(cfg)).toThrow(ValidationError);
});
```

- [ ] **Step 2: Run new tests — expect failure**

Run: `cd packages/dalang && bun test tests/config/validate.test.ts -t opencode`
Expected: FAIL — `probeOpencodeAuth` undefined.

- [ ] **Step 3: Add validation code and probe in `packages/dalang/src/config/validate.ts`**

Extend the `ValidationCode` union (replace the existing union):

```ts
export type ValidationCode =
  | "unsupported_tracker_kind"
  | "missing_tracker_api_key"
  | "missing_claude_executable_path"
  | "missing_codex_executable_path"
  | "missing_opencode_executable_path"
  | "missing_repo_config"
  | "claude_auth_inactive"
  | "codex_auth_inactive"
  | "opencode_auth_inactive"
  | "opencode_provider_not_authed";
```

Extend `validateForDispatch` (add a third `else if`):

```ts
  } else if (cfg.agent_provider === "opencode") {
    if (!cfg.opencode || cfg.opencode.executable_path.trim().length === 0) {
      throw new ValidationError("missing_opencode_executable_path", "opencode.executable_path is required");
    }
  }
```

Add `probeOpencodeAuth` at the end of the file:

```ts
/**
 * Probes opencode CLI by:
 *   1. Running `<bin> --version` (any non-zero → opencode_auth_inactive).
 *   2. Running `<bin> auth` and checking the provider prefix from `model`
 *      appears in stdout (JSON list or text). If absent → opencode_provider_not_authed.
 *
 * Returns null on success, or a human-readable error string on failure.
 */
export async function probeOpencodeAuth(executablePath: string, model: string): Promise<string | null> {
  const version = Bun.spawn([executablePath, "--version"], { stdout: "pipe", stderr: "pipe" });
  const versionExit = await version.exited;
  if (versionExit !== 0) {
    return `opencode probe failed: exit code ${versionExit}`;
  }
  const slash = model.indexOf("/");
  if (slash <= 0) {
    return `opencode probe failed: model "${model}" not in providerID/modelID form`;
  }
  const providerId = model.slice(0, slash);
  const auth = Bun.spawn([executablePath, "auth"], { stdout: "pipe", stderr: "pipe" });
  const authExit = await auth.exited;
  const stdout = await new Response(auth.stdout).text();
  if (authExit !== 0) {
    const stderr = await new Response(auth.stderr).text();
    return `opencode auth probe failed: ${(stderr.trim() || stdout.trim() || `exit code ${authExit}`)}`;
  }
  if (!stdout.includes(providerId)) {
    return `opencode auth probe: provider "${providerId}" not authenticated (run \`opencode auth login ${providerId}\`)`;
  }
  return null;
}
```

- [ ] **Step 4: Run validate tests — expect pass**

Run: `cd packages/dalang && bun test tests/config/validate.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/dalang/src/config/validate.ts packages/dalang/tests/config/validate.test.ts
git commit -m "feat(dalang): add probeOpencodeAuth and opencode validation codes"
```

---

## Task 4: Extend `AgentConfig` and `RunQueryOptions` in `agent-runner.ts`

**Files:**
- Modify: `packages/dalang/src/agent/agent-runner.ts:7-53, 142-189`

- [ ] **Step 1: Add the opencode discriminant types**

After `CodexAgentConfig` (around line 25), add:

```ts
export interface OpencodeAgentConfig extends CommonAgentConfig {
  provider: "opencode";
  smallModel?: string;
}
```

Replace the `AgentConfig` type alias (line 27):

```ts
export type AgentConfig = ClaudeAgentConfig | CodexAgentConfig | OpencodeAgentConfig;
```

After `CodexRunQueryOptions` (around line 49), add:

```ts
export type OpencodeRunQueryOptions = CommonRunQueryOptions & {
  opencode: { smallModel?: string };
  claude?: never;
  codex?: never;
};
```

Update the existing two RunQueryOptions variants to include `opencode?: never`:

```ts
export type ClaudeRunQueryOptions = CommonRunQueryOptions & {
  claude: { permissionMode: ClaudeAgentConfig["permissionMode"] };
  codex?: never;
  opencode?: never;
};

export type CodexRunQueryOptions = CommonRunQueryOptions & {
  codex: {
    sandboxMode: CodexAgentConfig["sandboxMode"];
    approvalPolicy: CodexAgentConfig["approvalPolicy"];
  };
  claude?: never;
  opencode?: never;
};
```

Replace `RunQueryOptions`:

```ts
export type RunQueryOptions = ClaudeRunQueryOptions | CodexRunQueryOptions | OpencodeRunQueryOptions;
```

- [ ] **Step 2: Update the queryOpts construction in `driveOneTurn`**

Replace the `queryOpts` ternary (around line 160):

```ts
    const queryOpts: RunQueryOptions =
      opts.config.provider === "claude"
        ? { ...baseOpts, claude: { permissionMode: opts.config.permissionMode } }
        : opts.config.provider === "codex"
          ? {
              ...baseOpts,
              codex: {
                sandboxMode: opts.config.sandboxMode,
                approvalPolicy: opts.config.approvalPolicy,
              },
            }
          : {
              ...baseOpts,
              opencode: opts.config.smallModel !== undefined
                ? { smallModel: opts.config.smallModel }
                : {},
            };
```

- [ ] **Step 3: Update the event-mapper switch (placeholder for now)**

Replace the line `const evt = opts.config.provider === "codex" ? mapCodexEvent(raw) : mapSdkMessage(raw);` (around line 177) with:

```ts
      const evt =
        opts.config.provider === "codex"   ? mapCodexEvent(raw) :
        opts.config.provider === "opencode" ? mapOpencodeEvent(raw) :
        mapSdkMessage(raw);
```

Add the import at the top of the file (after `mapCodexEvent`):

```ts
import { mapOpencodeEvent } from "./opencode-event-mapper";
```

(This will fail to compile until Task 5 lands. That's expected — we land them together at commit time below.)

- [ ] **Step 4: Stub the mapper module so the file compiles**

Create `packages/dalang/src/agent/opencode-event-mapper.ts` with a placeholder:

```ts
import type { RuntimeEvent } from "../types";
export function mapOpencodeEvent(_raw: unknown): RuntimeEvent | null {
  return null;
}
```

- [ ] **Step 5: Run typecheck and full tests**

Run: `bun run typecheck && cd packages/dalang && bun test`
Expected: typecheck clean; all existing tests still pass (the new branch in `driveOneTurn` is unreachable until config sets `provider: "opencode"`).

- [ ] **Step 6: Commit**

```bash
git add packages/dalang/src/agent/agent-runner.ts packages/dalang/src/agent/opencode-event-mapper.ts
git commit -m "feat(dalang): extend AgentConfig and RunQueryOptions with opencode provider"
```

---

## Task 5: Implement `opencode-event-mapper.ts`

**Files:**
- Modify: `packages/dalang/src/agent/opencode-event-mapper.ts` (replace stub)
- Test: `packages/dalang/tests/agent/opencode-event-mapper.test.ts`

opencode SSE event names (from `@opencode-ai/sdk` 1.14.30 types):

- `session.created` / `session.updated` — session lifecycle
- `session.idle` — turn finished
- `session.error` — turn failed
- `message.updated` — message metadata (role, model)
- `message.part.updated` — incremental text/tool/reasoning content
- `message.part.removed` — part removed
- `permission.updated` — should not fire (we hardcode `allow`); map to `notification` if it does
- `installation.update.available`, `lsp.*`, `file.*`, etc. — ignored (`other_message`)

- [ ] **Step 1: Write failing tests**

Create `packages/dalang/tests/agent/opencode-event-mapper.test.ts`:

```ts
import { test, expect } from "bun:test";
import { mapOpencodeEvent } from "../../src/agent/opencode-event-mapper";

test("session.created with sessionID maps to session_started", () => {
  const evt = mapOpencodeEvent({
    type: "session.created",
    properties: { info: { id: "ses-1" } },
  });
  expect(evt?.event).toBe("session_started");
  expect((evt as { thread_id?: string }).thread_id).toBe("ses-1");
});

test("session.idle maps to turn_completed and folds reasoning into output", () => {
  const evt = mapOpencodeEvent({
    type: "session.idle",
    properties: {
      sessionID: "ses-1",
      tokens: { input: 100, output: 50, reasoning: 30 },
    },
  });
  expect(evt?.event).toBe("turn_completed");
  expect(evt?.usage?.input_tokens).toBe(100);
  expect(evt?.usage?.output_tokens).toBe(80);
  expect(evt?.usage?.total_tokens).toBe(180);
});

test("session.idle without tokens still maps to turn_completed (zero usage)", () => {
  const evt = mapOpencodeEvent({ type: "session.idle", properties: { sessionID: "ses-1" } });
  expect(evt?.event).toBe("turn_completed");
  expect(evt?.usage?.input_tokens).toBe(0);
});

test("session.error maps to turn_ended_with_error with reason", () => {
  const evt = mapOpencodeEvent({
    type: "session.error",
    properties: { sessionID: "ses-1", error: { message: "boom" } },
  });
  expect(evt?.event).toBe("turn_ended_with_error");
  expect((evt as { reason?: string }).reason).toBe("boom");
});

test("message.part.updated text part maps to notification with truncated text", () => {
  const evt = mapOpencodeEvent({
    type: "message.part.updated",
    properties: { part: { type: "text", text: "hello" } },
  });
  expect(evt?.event).toBe("notification");
  expect((evt as { message: string }).message).toBe("hello");
});

test("message.part.updated tool part with status=running maps to tool_use:<name>", () => {
  const evt = mapOpencodeEvent({
    type: "message.part.updated",
    properties: { part: { type: "tool", tool: "bash", state: { status: "running" } } },
  });
  expect(evt?.event).toBe("notification");
  expect((evt as { message: string }).message).toBe("tool_use:bash");
});

test("message.part.updated tool part with status=completed maps to tool_result", () => {
  const evt = mapOpencodeEvent({
    type: "message.part.updated",
    properties: { part: { type: "tool", tool: "bash", state: { status: "completed" } } },
  });
  expect(evt?.event).toBe("notification");
  expect((evt as { message: string }).message).toBe("tool_result");
});

test("message.part.updated reasoning part maps to null", () => {
  const evt = mapOpencodeEvent({
    type: "message.part.updated",
    properties: { part: { type: "reasoning", text: "thinking" } },
  });
  expect(evt).toBeNull();
});

test("server.connected maps to null (handled by runner, not surfaced)", () => {
  expect(mapOpencodeEvent({ type: "server.connected" })).toBeNull();
});

test("unknown type falls through to other_message with the raw type", () => {
  const evt = mapOpencodeEvent({ type: "lsp.client.diagnostics" });
  expect(evt?.event).toBe("other_message");
  expect((evt as { message: string }).message).toBe("lsp.client.diagnostics");
});

test("null and non-object inputs return null", () => {
  expect(mapOpencodeEvent(null)).toBeNull();
  expect(mapOpencodeEvent(42)).toBeNull();
});
```

- [ ] **Step 2: Run — expect failures**

Run: `cd packages/dalang && bun test tests/agent/opencode-event-mapper.test.ts`
Expected: all assertions fail (stub returns `null`).

- [ ] **Step 3: Replace the stub with the real mapper**

Overwrite `packages/dalang/src/agent/opencode-event-mapper.ts`:

```ts
import type { RuntimeEvent } from "../types";

const TRUNC = 2000;

function truncate(s: string): string {
  if (s.length <= TRUNC) return s;
  return s.slice(0, TRUNC) + `... [truncated ${s.length - TRUNC} bytes]`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function notification(message: string): RuntimeEvent {
  return { event: "notification", timestamp: nowIso(), message };
}

interface RawEvent {
  type?: unknown;
  properties?: unknown;
}

function getProps(raw: RawEvent): Record<string, unknown> | null {
  if (raw.properties && typeof raw.properties === "object") {
    return raw.properties as Record<string, unknown>;
  }
  return null;
}

function mapPart(part: Record<string, unknown>): RuntimeEvent | null {
  const partType = part.type;
  if (partType === "text") {
    const text = typeof part.text === "string" ? part.text : "";
    if (!text) return null;
    return notification(truncate(text));
  }
  if (partType === "tool") {
    const tool = typeof part.tool === "string" ? part.tool : "?";
    const state = part.state as { status?: unknown } | undefined;
    const status = state && typeof state.status === "string" ? state.status : "";
    if (status === "completed" || status === "error") return notification("tool_result");
    if (status === "running" || status === "pending") return notification(`tool_use:${tool}`);
    return null;
  }
  // reasoning, file, etc. — not surfaced
  return null;
}

export function mapOpencodeEvent(raw: unknown): RuntimeEvent | null {
  if (raw === null || raw === undefined || typeof raw !== "object") return null;
  const e = raw as RawEvent;
  const t = typeof e.type === "string" ? e.type : null;
  if (t === null) return { event: "malformed", timestamp: nowIso() };

  const props = getProps(e);

  switch (t) {
    case "session.created": {
      const info = props && typeof props.info === "object" ? (props.info as Record<string, unknown>) : null;
      const id = info && typeof info.id === "string" ? info.id : null;
      const out: RuntimeEvent = { event: "session_started", timestamp: nowIso() };
      if (id) out.thread_id = id;
      return out;
    }
    case "session.updated":
      return null;
    case "session.idle": {
      const tokens = props && typeof props.tokens === "object" ? (props.tokens as Record<string, unknown>) : null;
      const input = tokens && typeof tokens.input === "number" ? tokens.input : 0;
      const output = tokens && typeof tokens.output === "number" ? tokens.output : 0;
      const reasoning = tokens && typeof tokens.reasoning === "number" ? tokens.reasoning : 0;
      return {
        event: "turn_completed",
        timestamp: nowIso(),
        usage: {
          input_tokens: input,
          output_tokens: output + reasoning,
          total_tokens: input + output + reasoning,
        },
      };
    }
    case "session.error": {
      const out: RuntimeEvent = { event: "turn_ended_with_error", timestamp: nowIso() };
      const err = props?.error as { message?: unknown } | undefined;
      if (err && typeof err.message === "string") out.reason = err.message;
      return out;
    }
    case "message.part.updated": {
      const part = props && typeof props.part === "object" ? (props.part as Record<string, unknown>) : null;
      if (!part) return null;
      return mapPart(part);
    }
    case "message.part.removed":
    case "message.updated":
    case "server.connected":
    case "server.instance.disposed":
      return null;
    default:
      return { event: "other_message", timestamp: nowIso(), message: t };
  }
}
```

- [ ] **Step 4: Run mapper tests — expect pass**

Run: `cd packages/dalang && bun test tests/agent/opencode-event-mapper.test.ts`
Expected: all pass.

- [ ] **Step 5: Run full agent tests for regressions**

Run: `cd packages/dalang && bun test tests/agent/`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/dalang/src/agent/opencode-event-mapper.ts packages/dalang/tests/agent/opencode-event-mapper.test.ts
git commit -m "feat(dalang): map opencode SSE events to RuntimeEvent"
```

---

## Task 6: Implement `opencode-server.ts` (singleton + supervisor + SSE fan-out)

**Files:**
- Create: `packages/dalang/src/agent/opencode-server.ts`
- Test: `packages/dalang/tests/agent/opencode-server.test.ts`

**Design notes for this module:**
- The module exposes two functions: `getOpencodeClient(opts: { executablePath: string })` (lazy spawn, returns client) and `shutdownOpencodeServer()` (graceful close used by daemon shutdown).
- It maintains a `Map<sessionId, AsyncQueue<unknown>>` and reads `client.event()` once. Each event with `properties.sessionID` (or, for `session.created`, `properties.info.id`) is enqueued onto the matching queue.
- A `subscribeSession(sessionId)` returns an `AsyncIterable<unknown>` that yields events until the queue is closed.
- For testability, the server-spawn primitive and the SSE-source are both injectable (default to the real `@opencode-ai/sdk`).

- [ ] **Step 1: Write failing tests**

Create `packages/dalang/tests/agent/opencode-server.test.ts`:

```ts
import { test, expect } from "bun:test";
import {
  __resetOpencodeServerForTests,
  __setOpencodeFactoryForTests,
  getOpencodeClient,
  shutdownOpencodeServer,
  subscribeSession,
} from "../../src/agent/opencode-server";

interface FakeFactoryControls {
  spawned: number;
  emit: (e: unknown) => void;
  failNextSpawn?: boolean;
}

function makeFakeFactory(): FakeFactoryControls {
  const ctl: FakeFactoryControls = { spawned: 0, emit: () => {} };
  __setOpencodeFactoryForTests(async () => {
    if (ctl.failNextSpawn) {
      ctl.failNextSpawn = false;
      throw new Error("spawn failed");
    }
    ctl.spawned += 1;
    let push!: (v: { data: unknown } | null) => void;
    const queue: ({ data: unknown } | null)[] = [];
    const waiters: ((v: { data: unknown } | null) => void)[] = [];
    push = (v) => { if (waiters.length) waiters.shift()!(v); else queue.push(v); };
    ctl.emit = (e) => push({ data: e });
    const iter = {
      [Symbol.asyncIterator]() { return this; },
      async next() {
        const v = queue.length ? queue.shift()! : await new Promise<{ data: unknown } | null>((r) => waiters.push(r));
        if (v === null) return { done: true as const, value: undefined };
        return { done: false as const, value: v };
      },
    };
    const close = () => push(null);
    return {
      client: { event: () => Promise.resolve({ stream: iter as AsyncIterable<{ data: unknown }> }) },
      shutdown: async () => { close(); },
    };
  });
  return ctl;
}

test("getOpencodeClient spawns lazily and is cached", async () => {
  __resetOpencodeServerForTests();
  const ctl = makeFakeFactory();
  await getOpencodeClient({ executablePath: "opencode" });
  await getOpencodeClient({ executablePath: "opencode" });
  expect(ctl.spawned).toBe(1);
  await shutdownOpencodeServer();
});

test("subscribeSession yields events filtered by sessionID", async () => {
  __resetOpencodeServerForTests();
  const ctl = makeFakeFactory();
  await getOpencodeClient({ executablePath: "opencode" });

  const sub = subscribeSession("ses-1");
  const it = sub[Symbol.asyncIterator]();

  ctl.emit({ type: "session.created", properties: { info: { id: "ses-1" } } });
  ctl.emit({ type: "message.part.updated", properties: { sessionID: "other" } });
  ctl.emit({ type: "message.part.updated", properties: { sessionID: "ses-1", part: { type: "text", text: "hi" } } });

  const a = await it.next();
  expect((a.value as { type: string }).type).toBe("session.created");
  const b = await it.next();
  expect((b.value as { type: string }).type).toBe("message.part.updated");
  expect(((b.value as { properties: { sessionID: string } }).properties.sessionID)).toBe("ses-1");

  await shutdownOpencodeServer();
});

test("shutdownOpencodeServer closes subscribers", async () => {
  __resetOpencodeServerForTests();
  makeFakeFactory();
  await getOpencodeClient({ executablePath: "opencode" });
  const sub = subscribeSession("ses-1");
  await shutdownOpencodeServer();
  for await (const _ of sub) { /* should drain */ }
  expect(true).toBe(true);
});
```

- [ ] **Step 2: Run — expect failures**

Run: `cd packages/dalang && bun test tests/agent/opencode-server.test.ts`
Expected: imports fail (module missing).

- [ ] **Step 3: Implement the module**

Create `packages/dalang/src/agent/opencode-server.ts`:

```ts
// packages/dalang/src/agent/opencode-server.ts
//
// Owns a single shared opencode HTTP server for the whole dalang process.
// - Lazy spawn on first getOpencodeClient() call.
// - Crash supervision with bounded backoff (1s, 2s, 4s, 8s, max 5 attempts/60s).
// - Single SSE read loop fans out events to per-session queues.

interface OpencodeBackend {
  client: {
    event(): Promise<{ stream: AsyncIterable<{ data: unknown }> }>;
  };
  shutdown(): Promise<void>;
}

type OpencodeFactory = (opts: { executablePath: string }) => Promise<OpencodeBackend>;

const RESTART_BACKOFFS_MS = [1000, 2000, 4000, 8000, 8000] as const;
const RESTART_WINDOW_MS = 60_000;

let factory: OpencodeFactory = defaultFactory;
let backend: OpencodeBackend | null = null;
let starting: Promise<OpencodeBackend> | null = null;
let queues = new Map<string, Queue<unknown>>();
let restartAt: number[] = [];
let stopped = false;

interface Queue<T> {
  push(v: T): void;
  close(): void;
  iterable(): AsyncIterable<T>;
}

function makeQueue<T>(): Queue<T> {
  const buf: (T | null)[] = [];
  const waiters: ((v: T | null) => void)[] = [];
  let closed = false;
  return {
    push(v) {
      if (closed) return;
      if (waiters.length) waiters.shift()!(v);
      else buf.push(v);
    },
    close() {
      if (closed) return;
      closed = true;
      while (waiters.length) waiters.shift()!(null);
    },
    iterable() {
      return {
        [Symbol.asyncIterator]() {
          return {
            async next(): Promise<IteratorResult<T>> {
              if (buf.length) {
                const v = buf.shift();
                if (v === null || v === undefined) return { done: true, value: undefined as never };
                return { done: false, value: v };
              }
              if (closed) return { done: true, value: undefined as never };
              const v = await new Promise<T | null>((r) => waiters.push(r));
              if (v === null) return { done: true, value: undefined as never };
              return { done: false, value: v };
            },
          };
        },
      };
    },
  };
}

async function defaultFactory(opts: { executablePath: string }): Promise<OpencodeBackend> {
  const sdk = await import("@opencode-ai/sdk");
  const { url, close } = await sdk.createOpencodeServer({ hostname: "127.0.0.1", port: 0 });
  const client = sdk.createOpencodeClient({ baseUrl: url });
  return {
    client: {
      event: () => client.event() as Promise<{ stream: AsyncIterable<{ data: unknown }> }>,
    },
    shutdown: async () => { close(); },
  };
  // executablePath is reserved for future config of the spawn; not consumed by createOpencodeServer today.
}

function extractSessionId(raw: unknown): string | null {
  if (raw === null || typeof raw !== "object") return null;
  const e = raw as { type?: unknown; properties?: unknown };
  const props = e.properties as Record<string, unknown> | undefined;
  if (!props) return null;
  if (e.type === "session.created") {
    const info = props.info as { id?: unknown } | undefined;
    return info && typeof info.id === "string" ? info.id : null;
  }
  return typeof props.sessionID === "string" ? props.sessionID : null;
}

async function readLoop(b: OpencodeBackend): Promise<void> {
  try {
    const { stream } = await b.client.event();
    for await (const sse of stream) {
      const data = sse.data;
      const id = extractSessionId(data);
      if (id !== null) {
        const q = queues.get(id);
        if (q) q.push(data);
      }
    }
  } catch {
    // fall through to crash handling
  }
  if (stopped) return;
  // crash recovery
  const now = Date.now();
  restartAt = restartAt.filter((t) => now - t < RESTART_WINDOW_MS);
  if (restartAt.length >= RESTART_BACKOFFS_MS.length) {
    for (const q of queues.values()) q.close();
    queues = new Map();
    backend = null;
    return;
  }
  const delay = RESTART_BACKOFFS_MS[Math.min(restartAt.length, RESTART_BACKOFFS_MS.length - 1)]!;
  restartAt.push(now);
  backend = null;
  starting = null;
  await new Promise((r) => setTimeout(r, delay));
  // Lazy-restart on next getOpencodeClient call; queues stay open so existing
  // subscribers will get events from the next session lifecycle.
}

async function spawn(opts: { executablePath: string }): Promise<OpencodeBackend> {
  if (starting) return starting;
  starting = (async () => {
    const b = await factory(opts);
    backend = b;
    void readLoop(b);
    return b;
  })();
  return starting;
}

export async function getOpencodeClient(opts: { executablePath: string }): Promise<OpencodeBackend["client"]> {
  if (stopped) throw new Error("opencode_server_unavailable");
  if (backend) return backend.client;
  const b = await spawn(opts);
  return b.client;
}

export function subscribeSession(sessionId: string): AsyncIterable<unknown> {
  let q = queues.get(sessionId);
  if (!q) {
    q = makeQueue<unknown>();
    queues.set(sessionId, q);
  }
  return q.iterable();
}

export function unsubscribeSession(sessionId: string): void {
  const q = queues.get(sessionId);
  if (q) q.close();
  queues.delete(sessionId);
}

export async function shutdownOpencodeServer(): Promise<void> {
  stopped = true;
  for (const q of queues.values()) q.close();
  queues = new Map();
  if (backend) {
    const b = backend;
    backend = null;
    starting = null;
    try { await b.shutdown(); } catch { /* swallow */ }
  }
}

// Test hooks (NOT for production callers)
export function __setOpencodeFactoryForTests(f: OpencodeFactory): void { factory = f; }
export function __resetOpencodeServerForTests(): void {
  stopped = false;
  backend = null;
  starting = null;
  queues = new Map();
  restartAt = [];
  factory = defaultFactory;
}
```

- [ ] **Step 4: Run server tests — expect pass**

Run: `cd packages/dalang && bun test tests/agent/opencode-server.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/dalang/src/agent/opencode-server.ts packages/dalang/tests/agent/opencode-server.test.ts
git commit -m "feat(dalang): add shared opencode server with SSE fan-out"
```

---

## Task 7: Implement `opencode-runner.ts`

**Files:**
- Create: `packages/dalang/src/agent/opencode-runner.ts`
- Test: `packages/dalang/tests/agent/opencode-runner.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/dalang/tests/agent/opencode-runner.test.ts`:

```ts
import { test, expect } from "bun:test";
import { opencodeRunQuery } from "../../src/agent/opencode-runner";
import {
  __resetOpencodeServerForTests,
  __setOpencodeFactoryForTests,
} from "../../src/agent/opencode-server";

function installFakeBackend(opts: {
  onSessionCreate?: (body: unknown) => { id: string };
  onPrompt?: (body: unknown) => void;
  emitEvents?: (emit: (e: unknown) => void) => void;
}): void {
  __setOpencodeFactoryForTests(async () => {
    const queue: ({ data: unknown } | null)[] = [];
    const waiters: ((v: { data: unknown } | null) => void)[] = [];
    const push = (v: { data: unknown } | null) => {
      if (waiters.length) waiters.shift()!(v);
      else queue.push(v);
    };
    const emit = (e: unknown) => push({ data: e });
    if (opts.emitEvents) {
      // emit asynchronously so subscribers can attach first
      queueMicrotask(() => opts.emitEvents!(emit));
    }
    const iter = {
      [Symbol.asyncIterator]() { return this; },
      async next() {
        const v = queue.length ? queue.shift()! : await new Promise<{ data: unknown } | null>((r) => waiters.push(r));
        if (v === null) return { done: true as const, value: undefined };
        return { done: false as const, value: v };
      },
    };
    return {
      client: {
        event: () => Promise.resolve({ stream: iter as AsyncIterable<{ data: unknown }> }),
        session: {
          create: async ({ body }: { body: unknown }) => {
            const id = (opts.onSessionCreate ?? (() => ({ id: "ses-fake" })))(body).id;
            return { data: { id } };
          },
          promptAsync: async ({ body }: { body: unknown }) => {
            opts.onPrompt?.(body);
            return { data: { ok: true } };
          },
        },
      },
      shutdown: async () => { push(null); },
    };
  });
}

test("opencodeRunQuery throws when opts.opencode bag is missing (provider mismatch)", () => {
  expect(() =>
    opencodeRunQuery({
      prompt: "hi", cwd: "/tmp", model: "anthropic/claude",
      executablePath: "opencode",
      claude: { permissionMode: "auto" },
    } as never),
  ).toThrow(/provider mismatch/);
});

test("opencodeRunQuery throws when model has no provider/model split", () => {
  expect(() =>
    opencodeRunQuery({
      prompt: "hi", cwd: "/tmp", model: "no-slash",
      executablePath: "opencode",
      opencode: {},
    }),
  ).toThrow(/providerID/);
});

test("opencodeRunQuery creates a session, sends a prompt, and yields filtered events", async () => {
  __resetOpencodeServerForTests();
  let createdBody: unknown = null;
  let promptBody: unknown = null;
  installFakeBackend({
    onSessionCreate: (body) => { createdBody = body; return { id: "ses-1" }; },
    onPrompt: (body) => { promptBody = body; },
    emitEvents: (emit) => {
      emit({ type: "session.created", properties: { info: { id: "ses-1" } } });
      emit({ type: "message.part.updated", properties: { sessionID: "ses-1", part: { type: "text", text: "hi" } } });
      emit({ type: "session.idle", properties: { sessionID: "ses-1", tokens: { input: 1, output: 2, reasoning: 0 } } });
    },
  });

  const iter = opencodeRunQuery({
    prompt: "do the thing",
    cwd: "/tmp/ws",
    model: "anthropic/claude-sonnet-4-6",
    executablePath: "opencode",
    opencode: {},
  });

  const events: unknown[] = [];
  for await (const e of iter) {
    events.push(e);
    if ((e as { type: string }).type === "session.idle") break;
  }
  expect(events.length).toBe(3);
  expect((createdBody as { directory: string }).directory).toBe("/tmp/ws");
  expect((promptBody as { model: { providerID: string; modelID: string } }).model)
    .toEqual({ providerID: "anthropic", modelID: "claude-sonnet-4-6" });
});

test("opencodeRunQuery resumes an existing session id without calling create", async () => {
  __resetOpencodeServerForTests();
  let createCalls = 0;
  let promptedSessionId = "";
  installFakeBackend({
    onSessionCreate: () => { createCalls += 1; return { id: "should-not-be-used" }; },
    onPrompt: () => {},
    emitEvents: (emit) => {
      emit({ type: "session.idle", properties: { sessionID: "ses-resume", tokens: { input: 0, output: 0, reasoning: 0 } } });
    },
  });

  // Patch promptAsync to capture session id from the path arg via the runner. The fake
  // factory's session.promptAsync above ignores `path`; we re-install a richer fake here:
  __setOpencodeFactoryForTests(async () => {
    const queue: ({ data: unknown } | null)[] = [];
    const waiters: ((v: { data: unknown } | null) => void)[] = [];
    const push = (v: { data: unknown } | null) => { if (waiters.length) waiters.shift()!(v); else queue.push(v); };
    queueMicrotask(() => {
      push({ data: { type: "session.idle", properties: { sessionID: "ses-resume", tokens: { input: 0, output: 0, reasoning: 0 } } } });
    });
    const stream = {
      [Symbol.asyncIterator]() { return this; },
      async next() {
        const v = queue.length ? queue.shift()! : await new Promise<{ data: unknown } | null>((r) => waiters.push(r));
        if (v === null) return { done: true as const, value: undefined };
        return { done: false as const, value: v };
      },
    };
    return {
      client: {
        event: () => Promise.resolve({ stream: stream as AsyncIterable<{ data: unknown }> }),
        session: {
          create: async () => { createCalls += 1; return { data: { id: "should-not-be-used" } }; },
          promptAsync: async ({ path }: { path: { id: string } }) => { promptedSessionId = path.id; return { data: {} }; },
        },
      },
      shutdown: async () => { push(null); },
    };
  });

  const iter = opencodeRunQuery({
    prompt: "again",
    cwd: "/tmp/ws",
    model: "anthropic/claude-sonnet-4-6",
    executablePath: "opencode",
    resumeSessionId: "ses-resume",
    opencode: {},
  });
  for await (const _ of iter) break;

  expect(createCalls).toBe(0);
  expect(promptedSessionId).toBe("ses-resume");
});
```

- [ ] **Step 2: Run — expect failures (module missing)**

Run: `cd packages/dalang && bun test tests/agent/opencode-runner.test.ts`
Expected: imports fail.

- [ ] **Step 3: Implement the runner**

Create `packages/dalang/src/agent/opencode-runner.ts`:

```ts
// packages/dalang/src/agent/opencode-runner.ts
import type { RunQuery, RunQueryOptions } from "./agent-runner";
import {
  getOpencodeClient,
  subscribeSession,
  unsubscribeSession,
} from "./opencode-server";

interface OpencodeClient {
  event(): Promise<unknown>;
  session: {
    create(args: { body: { directory: string; permission?: unknown } }): Promise<{ data: { id: string } }>;
    promptAsync(args: {
      path: { id: string };
      body: {
        model: { providerID: string; modelID: string };
        parts: Array<{ type: "text"; text: string }>;
        mode?: string;
      };
    }): Promise<unknown>;
  };
}

const HARDCODED_PERMISSION = {
  edit: "allow",
  bash: "allow",
  webfetch: "allow",
  doom_loop: "allow",
} as const;

function parseProviderModel(model: string): { providerID: string; modelID: string } {
  const slash = model.indexOf("/");
  if (slash <= 0 || slash === model.length - 1) {
    throw new Error(`opencode model "${model}" must be in providerID/modelID form`);
  }
  return { providerID: model.slice(0, slash), modelID: model.slice(slash + 1) };
}

export const opencodeRunQuery: RunQuery = (opts: RunQueryOptions) => {
  if (!opts.opencode) {
    throw new Error("opencodeRunQuery requires opts.opencode (provider mismatch)");
  }
  const { providerID, modelID } = parseProviderModel(opts.model);

  async function* iterate(): AsyncGenerator<unknown> {
    const rawClient = await getOpencodeClient({ executablePath: opts.executablePath });
    const client = rawClient as unknown as OpencodeClient;

    let sessionId = opts.resumeSessionId ?? null;
    if (!sessionId) {
      const created = await client.session.create({
        body: { directory: opts.cwd, permission: HARDCODED_PERMISSION },
      });
      sessionId = created.data.id;
    }

    const sub = subscribeSession(sessionId);

    try {
      await client.session.promptAsync({
        path: { id: sessionId },
        body: {
          model: { providerID, modelID },
          parts: [{ type: "text", text: opts.prompt }],
          mode: "build",
        },
      });

      const aborted = (): boolean => Boolean(opts.abortSignal?.aborted);
      for await (const evt of sub) {
        if (aborted()) break;
        yield evt;
      }
    } finally {
      unsubscribeSession(sessionId);
    }
  }

  return iterate();
};
```

- [ ] **Step 4: Run runner tests — expect pass**

Run: `cd packages/dalang && bun test tests/agent/opencode-runner.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/dalang/src/agent/opencode-runner.ts packages/dalang/tests/agent/opencode-runner.test.ts
git commit -m "feat(dalang): implement opencode RunQuery via shared server"
```

---

## Task 8: Wire orchestrator `buildAgentConfig` and stall-timeout lookup

**Files:**
- Modify: `packages/dalang/src/orchestrator/orchestrator.ts:110-115, 353-382`

- [ ] **Step 1: Extend `reconcile`'s stall-timeout lookup**

Replace the `stallTimeoutMs` ternary in `reconcile()` (around line 110):

```ts
    const stallTimeoutMs =
      this.cfg.agent_provider === "codex"     ? this.cfg.codex!.stall_timeout_ms :
      this.cfg.agent_provider === "opencode"  ? this.cfg.opencode!.stall_timeout_ms :
      this.cfg.claude!.stall_timeout_ms;
```

- [ ] **Step 2: Extend `buildAgentConfig`**

After the codex `if` block in `buildAgentConfig()` (around line 369), add:

```ts
    if (this.cfg.agent_provider === "opencode") {
      if (!this.cfg.opencode) throw new Error("opencode block missing despite agent_provider=opencode");
      const oc = this.cfg.opencode;
      const cfg: AgentConfig = {
        provider: "opencode",
        ...common,
        model: oc.model,
        executablePath: oc.executable_path,
        turnTimeoutMs: oc.turn_timeout_ms,
        readTimeoutMs: oc.read_timeout_ms,
        stallTimeoutMs: oc.stall_timeout_ms,
      };
      if (oc.small_model !== undefined) cfg.smallModel = oc.small_model;
      return cfg;
    }
```

- [ ] **Step 3: Typecheck and run orchestrator tests**

Run: `bun run typecheck && cd packages/dalang && bun test tests/orchestrator/`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add packages/dalang/src/orchestrator/orchestrator.ts
git commit -m "feat(dalang): wire opencode provider through orchestrator config"
```

---

## Task 9: Wire `bootstrap.ts` (runner selection, auth probe, shutdown)

**Files:**
- Modify: `packages/dalang/src/cli/bootstrap.ts:1-100, end-of-file`

- [ ] **Step 1: Update imports**

Add at the top of `packages/dalang/src/cli/bootstrap.ts`:

```ts
import { opencodeRunQuery } from "../agent/opencode-runner";
import { shutdownOpencodeServer } from "../agent/opencode-server";
import { probeOpencodeAuth } from "../config/validate";
```

(`probeOpencodeAuth` joins the existing import from `../config/validate`. Keep imports DRY: edit the existing import line if there is one rather than duplicating.)

- [ ] **Step 2: Extend the auth probe block**

Replace the auth-probe `if (!this.opts.skipAuthProbe) { ... }` block (around line 46):

```ts
    if (!this.opts.skipAuthProbe) {
      if (wf.config.agent_provider === "codex") {
        const err = await probeCodexAuth(wf.config.codex!.executable_path);
        if (err) throw new ValidationError("codex_auth_inactive", err);
      } else if (wf.config.agent_provider === "opencode") {
        const err = await probeOpencodeAuth(wf.config.opencode!.executable_path, wf.config.opencode!.model);
        if (err) {
          // The probe distinguishes binary failure from missing-provider-auth in its message,
          // so map the message prefix to the right ValidationCode.
          const code = err.startsWith("opencode auth probe: provider")
            ? "opencode_provider_not_authed"
            : "opencode_auth_inactive";
          throw new ValidationError(code, err);
        }
      } else {
        const err = await probeClaudeAuth(wf.config.claude!.executable_path);
        if (err) throw new ValidationError("claude_auth_inactive", err);
      }
    }
```

- [ ] **Step 3: Extend the runner-selection ternary**

Replace the `runQuery` assignment block (around line 61):

```ts
    const runQuery = this.opts.runQueryFactory
      ? this.opts.runQueryFactory()
      : wf.config.agent_provider === "codex"
        ? codexRunQuery
        : wf.config.agent_provider === "opencode"
          ? opencodeRunQuery
          : sdkRunQuery;
```

- [ ] **Step 4: Wire shutdown of the opencode server in `Bootstrap.stop()`**

Locate the `stop()` method in `bootstrap.ts`. Add `await shutdownOpencodeServer().catch(() => {});` after the existing teardown of the orchestrator/server (or at the end of the method body if no other teardown exists). If no `stop()` method exists, search for whichever method handles shutdown (`close`, `dispose`) and add it there.

```ts
  async stop(): Promise<void> {
    // ...existing teardown...
    await shutdownOpencodeServer().catch(() => {});
  }
```

- [ ] **Step 5: Typecheck and bootstrap tests**

Run: `bun run typecheck && cd packages/dalang && bun test tests/cli/bootstrap.test.ts`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add packages/dalang/src/cli/bootstrap.ts
git commit -m "feat(dalang): wire opencode provider into bootstrap"
```

---

## Task 10: agent-runner integration test with opencode-shaped events

**Files:**
- Create: `packages/dalang/tests/agent/agent-runner-opencode.test.ts`

- [ ] **Step 1: Write the integration test**

Create `packages/dalang/tests/agent/agent-runner-opencode.test.ts`:

```ts
// packages/dalang/tests/agent/agent-runner-opencode.test.ts
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

test("runAttempt drives an opencode-shaped event stream end-to-end", async () => {
  const events: unknown[] = [
    { type: "session.created", properties: { info: { id: "ses-1" } } },
    { type: "message.part.updated", properties: { sessionID: "ses-1", part: { type: "text", text: "hello" } } },
    { type: "session.idle", properties: { sessionID: "ses-1", tokens: { input: 12, output: 7, reasoning: 3 } } },
  ];

  const collected: RuntimeEvent[] = [];
  const result = await runAttempt({
    issue,
    attempt: 1,
    promptTemplate: "{{ issue.title }}",
    workspacePath: "/tmp/workspace",
    config: {
      provider: "opencode" as const,
      model: "anthropic/claude-sonnet-4-6",
      executablePath: "opencode",
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
  expect(result.thread_id).toBe("ses-1");
  expect(result.tokens.input_tokens).toBe(12);
  expect(result.tokens.output_tokens).toBe(10); // 7 + 3 reasoning
  expect(result.tokens.total_tokens).toBe(22);
  expect(collected.some((e) => e.event === "session_started")).toBe(true);
  expect(collected.some((e) => e.event === "turn_completed")).toBe(true);
});
```

- [ ] **Step 2: Run — expect pass**

Run: `cd packages/dalang && bun test tests/agent/agent-runner-opencode.test.ts`
Expected: pass.

- [ ] **Step 3: Run the full agent suite for regressions**

Run: `cd packages/dalang && bun test tests/agent/`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add packages/dalang/tests/agent/agent-runner-opencode.test.ts
git commit -m "test(dalang): cover agent-runner end-to-end with opencode events"
```

---

## Task 11: README documentation

**Files:**
- Modify: `packages/dalang/README.md`

- [ ] **Step 1: Add an opencode section**

Open `packages/dalang/README.md`. Find the existing section that documents the `agent_provider` option and the `claude:` / `codex:` blocks. Append a new subsection after the codex block:

````markdown
### Using opencode (third-party model gateway)

Set `agent_provider: "opencode"` in `WORKFLOW.md` and add an `opencode:` block:

```yaml
agent_provider: opencode
opencode:
  executable_path: opencode
  model: anthropic/claude-sonnet-4-6   # provider/model — opencode picks the backend
  small_model: openai/gpt-4o-mini      # optional, used by opencode for title/summary turns
  turn_timeout_ms: 3600000
  read_timeout_ms: 5000
  stall_timeout_ms: 300000
```

Auth lives in opencode itself — run `opencode auth login <provider>` for each backend you intend to use (e.g. `opencode auth login anthropic`). dalang only checks at startup that the provider prefix in `model` is present in `opencode auth`'s output.

**Architectural notes:**

- dalang spawns one shared opencode server at startup and routes all workers through it. The server is shut down when dalang exits.
- Permissions for `edit`, `bash`, `webfetch`, and `doom_loop` are hardcoded to `allow`. dalang is headless; an `ask` mode would deadlock workers.
- Sessions are persisted in opencode's local data directory. They survive opencode-server crashes and dalang restarts on the same host, but not machine changes — same caveat as codex.
````

- [ ] **Step 2: Commit**

```bash
git add packages/dalang/README.md
git commit -m "docs(dalang): document opencode provider configuration"
```

---

## Task 12: Final integration check

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `bun test` (from repo root)
Expected: all pass.

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Run lint and format check**

Run: `bun run lint && bun run format:check`
Expected: lint clean. `format:check` may report failures on `.md` files only — those are an upstream `oxfmt` bug noted in CLAUDE.md and are not blocking.

- [ ] **Step 4: Manual smoke (optional, requires local opencode)**

If you have `opencode` installed and have run `opencode auth login <provider>`, scaffold a workflow with `agent_provider: "opencode"` and run dalang against a no-op issue. Confirm:

1. Daemon starts (one extra child process: the opencode server).
2. Worker picks up an issue, emits `session_started` with a `ses-...` id, then `turn_completed`.
3. Daemon SIGTERM cleanly stops the opencode server within 5s.

Skip this step if you don't have opencode locally — CI does not exercise the real binary.

- [ ] **Step 5: No commit (verification-only task)**

---

## Self-Review Checklist

After completing all tasks, verify:

- [ ] **Spec coverage** — every section of `2026-04-30-opencode-provider-design.md` maps to a task:
  - §1 Summary, §3 AgentConfig reshape → Task 4
  - §2 Config schema → Task 2
  - §4 Runner selection (orchestrator) → Task 8; (bootstrap) → Task 9
  - §5 Hardcoded permissions → Task 7 (in `HARDCODED_PERMISSION`)
  - §6 Server lifecycle, supervisor → Task 6
  - §7 Runner code → Task 7
  - §8 Event mapping → Task 5
  - §9 Resume semantics → Task 7 (resume path test)
  - §10 Validation + auth probes → Task 3 + Task 9
  - §11 Testing — tasks 5/6/7/10 cover mapper, server, runner, integration; tasks 2/3 cover config validation; orchestrator selection covered by orchestrator tests in Task 8
  - §12 Migration / rollout, README → Task 11
  - §13 Out of scope — confirmed nothing in plan touches per-issue routing, opencode "agents", MCP passthrough, or `claude_totals` rename
- [ ] **Placeholder scan** — no "TBD", "TODO", "fill in later", or "similar to Task N" anywhere
- [ ] **Type consistency** — `OpencodeAgentConfig.smallModel`, `OpencodeRunQueryOptions.opencode.smallModel`, `OpencodeSchema.small_model`, and `buildAgentConfig` opencode branch all use the same name
- [ ] **Method-name consistency** — `getOpencodeClient`, `subscribeSession`, `unsubscribeSession`, `shutdownOpencodeServer` are referenced identically in `opencode-runner.ts` and `bootstrap.ts`
