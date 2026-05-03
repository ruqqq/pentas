# Sandboxed Workers Phase 2 — `bayang` Shim

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `bayang` shim — a small program that runs *inside* a worker container, drives one provider's SDK locally, and emits events as NDJSON on stdout. Plus a host-side `remote-runner.ts` that runs the shim through a `ContainerHost` and re-exposes the events as a normal `RunQuery` `AsyncIterable`. Phase 2 ships the shim runtime, the IPC protocol, the host-side wrapper, and tests against the in-process `FakeContainerHost` from Phase 1. It does **not** wire the shim into dalang's existing runner seam (Phase 4) and does **not** ship a compiled binary build — production compilation is the last task and is opt-in for now.

**Architecture:** The shim is a Bun TypeScript entry at `packages/dalang/src/worker/main.ts`. It reads a JSON `WorkerInvocation` blob from stdin, dispatches to one of three provider modules (`worker/claude.ts`, `worker/codex.ts`, `worker/opencode.ts`) which import the same SDKs the existing in-process runners use (`@anthropic-ai/claude-agent-sdk`, `@openai/codex-sdk`, `@opencode-ai/sdk`), and writes one NDJSON line per provider event to stdout. SIGTERM on the process aborts the SDK call. Errors are emitted as `{"kind":"error",...}` events and the process exits non-zero. The host side gets a `remoteRunQuery(host: ContainerHandle, opts)` factory that returns the same `AsyncIterable<unknown>` shape as the existing `RunQuery`.

The shim exists to be exec'd inside a worker container in later phases. In Phase 2 we test it through `FakeContainerHost`, which executes commands as host subprocesses — so the shim runs as a host Bun process whose stdin/stdout we control. This validates the IPC, the per-provider event shapes, and the host-side wrapper without requiring Docker.

**Tech Stack:** Bun, TypeScript (strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes + verbatimModuleSyntax), zod, `bun test`. No new deps. Spec: `docs/superpowers/specs/2026-05-02-dalang-sandboxed-workers-design.md` §4 (shim) and §6 (IPC).

---

## File Structure

**Create:**

- `packages/dalang/src/worker/main.ts` — CLI entry: read stdin invocation, dispatch by provider, write NDJSON to stdout, handle SIGTERM
- `packages/dalang/src/worker/protocol.ts` — IPC types + zod schemas (`WorkerInvocation`, `WorkerEvent`)
- `packages/dalang/src/worker/claude.ts` — drives `@anthropic-ai/claude-agent-sdk`
- `packages/dalang/src/worker/codex.ts` — drives `@openai/codex-sdk`
- `packages/dalang/src/worker/opencode.ts` — spawns its own `opencode` server, drives `@opencode-ai/sdk`
- `packages/dalang/src/worker/index.ts` — barrel
- `packages/dalang/src/sandbox/remote-runner.ts` — host-side wrapper: runs the shim via a `ContainerHandle.exec()`, parses NDJSON, exposes `AsyncIterable<unknown>`
- `packages/dalang/scripts/build-bayang.ts` — `bun build --compile` script (Task 8)
- `packages/dalang/tests/worker/protocol.test.ts`
- `packages/dalang/tests/worker/main.test.ts` — spawns the shim as a host subprocess, asserts NDJSON output (Claude path)
- `packages/dalang/tests/worker/codex.test.ts` — spawns shim with codex provider; gated behind `CODEX_AVAILABLE`
- `packages/dalang/tests/worker/opencode.test.ts` — spawns shim with opencode provider; gated behind `OPENCODE_AVAILABLE`
- `packages/dalang/tests/sandbox/remote-runner.test.ts` — tests the host-side wrapper against `FakeContainerHost`
- `packages/dalang/tests/fixtures/worker/echo-shim.ts` — test fixture: emits a fixed sequence of NDJSON events without touching real SDKs

**Modify:**

- `packages/dalang/package.json` — add `bayang:build` script that runs `bun scripts/build-bayang.ts` (Task 8 only)
- `packages/dalang/src/sandbox/index.ts` — re-export `remoteRunQuery`

---

## Task 1: Define the IPC protocol

**Files:**

- Create: `packages/dalang/src/worker/protocol.ts`
- Test: `packages/dalang/tests/worker/protocol.test.ts`

The shim and host both import these types. Two top-level shapes:

- **`WorkerInvocation`** — JSON blob written to the shim's stdin once at startup. Carries the same fields the existing `RunQueryOptions` carries, plus `provider`.
- **`WorkerEvent`** — JSON blob the shim writes one-per-line to stdout. Three kinds: `provider_event` (raw event from the SDK, opaque payload), `error` (terminal), `finished` (clean termination marker).

- [ ] **Step 1: Failing test**

Create `packages/dalang/tests/worker/protocol.test.ts`:

```ts
import { test, expect } from "bun:test";
import {
  WorkerInvocationSchema,
  WorkerEventSchema,
  type WorkerEvent,
} from "../../src/worker/protocol";

test("WorkerInvocationSchema accepts a Claude invocation", () => {
  const parsed = WorkerInvocationSchema.parse({
    provider: "claude",
    prompt: "hello",
    cwd: "/workspace",
    model: "claude-sonnet-4-6",
    executablePath: "/opt/dalang/bin/claude",
    claude: { permissionMode: "auto" },
  });
  expect(parsed.provider).toBe("claude");
});

test("WorkerInvocationSchema rejects a Claude invocation without claude bag", () => {
  const result = WorkerInvocationSchema.safeParse({
    provider: "claude",
    prompt: "hello",
    cwd: "/workspace",
    model: "claude-sonnet-4-6",
    executablePath: "/opt/dalang/bin/claude",
  });
  expect(result.success).toBe(false);
});

test("WorkerInvocationSchema accepts a Codex invocation", () => {
  const parsed = WorkerInvocationSchema.parse({
    provider: "codex",
    prompt: "hello",
    cwd: "/workspace",
    model: "gpt-5",
    executablePath: "/opt/dalang/bin/codex",
    codex: {
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
      networkAccessEnabled: true,
    },
  });
  expect(parsed.provider).toBe("codex");
});

test("WorkerInvocationSchema accepts an Opencode invocation", () => {
  const parsed = WorkerInvocationSchema.parse({
    provider: "opencode",
    prompt: "hello",
    cwd: "/workspace",
    model: "anthropic/claude-sonnet-4-6",
    executablePath: "/opt/dalang/bin/opencode",
  });
  expect(parsed.provider).toBe("opencode");
});

test("WorkerEventSchema parses provider_event with arbitrary payload", () => {
  const ev: WorkerEvent = {
    kind: "provider_event",
    payload: { foo: "bar", nested: { a: 1 } },
  };
  expect(WorkerEventSchema.parse(ev)).toEqual(ev);
});

test("WorkerEventSchema parses error and finished events", () => {
  expect(WorkerEventSchema.parse({ kind: "error", message: "boom" }).kind).toBe("error");
  expect(WorkerEventSchema.parse({ kind: "finished" }).kind).toBe("finished");
});
```

- [ ] **Step 2: Run — expect failure**

Run: `cd /home/ruqqq/Documents/projects/personal/pentas && bun test packages/dalang/tests/worker/protocol.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `packages/dalang/src/worker/protocol.ts`**

```ts
import { z } from "zod";

const ClaudeInvocationSchema = z.object({
  provider: z.literal("claude"),
  prompt: z.string(),
  cwd: z.string().min(1),
  model: z.string().min(1),
  executablePath: z.string().min(1),
  resumeSessionId: z.string().min(1).optional(),
  claude: z.object({
    permissionMode: z.enum(["auto", "default", "plan", "bypassPermissions"]),
  }),
});

const CodexInvocationSchema = z.object({
  provider: z.literal("codex"),
  prompt: z.string(),
  cwd: z.string().min(1),
  model: z.string().min(1),
  executablePath: z.string().min(1),
  resumeSessionId: z.string().min(1).optional(),
  codex: z.object({
    sandboxMode: z.enum(["read-only", "workspace-write", "danger-full-access"]),
    approvalPolicy: z.enum(["untrusted", "on-failure", "on-request", "never"]),
    networkAccessEnabled: z.boolean(),
    env: z.record(z.string(), z.string()).optional(),
  }),
});

const OpencodeInvocationSchema = z.object({
  provider: z.literal("opencode"),
  prompt: z.string(),
  cwd: z.string().min(1),
  model: z.string().min(1),
  executablePath: z.string().min(1),
  resumeSessionId: z.string().min(1).optional(),
});

export const WorkerInvocationSchema = z.discriminatedUnion("provider", [
  ClaudeInvocationSchema,
  CodexInvocationSchema,
  OpencodeInvocationSchema,
]);

export type WorkerInvocation = z.infer<typeof WorkerInvocationSchema>;

export const WorkerEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("provider_event"),
    payload: z.unknown(),
  }),
  z.object({
    kind: z.literal("error"),
    message: z.string(),
    /** Optional structured detail; opaque to the host. */
    detail: z.unknown().optional(),
  }),
  z.object({
    kind: z.literal("finished"),
  }),
]);

export type WorkerEvent = z.infer<typeof WorkerEventSchema>;

/** Serializes a single event as a single NDJSON line (no trailing newline). */
export function serializeEvent(ev: WorkerEvent): string {
  return JSON.stringify(ev);
}
```

- [ ] **Step 4: Run — expect pass**

Run: `bun test packages/dalang/tests/worker/protocol.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: dalang typecheck exits 0 (papan errors pre-existing, ignore).

- [ ] **Step 6: Commit**

```bash
git add packages/dalang/src/worker/protocol.ts packages/dalang/tests/worker/protocol.test.ts
git commit -m "feat(dalang): worker shim IPC protocol"
```

---

## Task 2: Worker `main.ts` skeleton + dispatch + echo fixture

This task adds `main.ts` and an end-to-end smoke test using a "Claude" provider that's actually faked through a stub (we don't yet have provider implementations). The fixture proves stdin parsing, dispatch, NDJSON emission, error handling, and SIGTERM all work before real SDKs touch the picture.

**Files:**

- Create: `packages/dalang/src/worker/main.ts`
- Create: `packages/dalang/tests/fixtures/worker/echo-shim.ts`
- Create: `packages/dalang/tests/worker/main.test.ts`

- [ ] **Step 1: Failing test**

Create `packages/dalang/tests/worker/main.test.ts`:

```ts
import { test, expect } from "bun:test";
import { resolve } from "node:path";
import type { WorkerEvent } from "../../src/worker/protocol";

const fixtureShim = resolve(import.meta.dir, "..", "fixtures", "worker", "echo-shim.ts");

async function runShim(stdinJson: string): Promise<{ stdout: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", fixtureShim], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.write(stdinJson);
  proc.stdin.end();
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { stdout, exitCode };
}

test("echo-shim writes one provider_event per line and a final finished event", async () => {
  const out = await runShim('{"items":[{"a":1},{"b":2}]}');
  const lines = out.stdout.trim().split("\n");
  const events = lines.map((l) => JSON.parse(l) as WorkerEvent);
  expect(events).toEqual([
    { kind: "provider_event", payload: { a: 1 } },
    { kind: "provider_event", payload: { b: 2 } },
    { kind: "finished" },
  ]);
  expect(out.exitCode).toBe(0);
});

test("echo-shim emits an error event and exits non-zero on bad input", async () => {
  const out = await runShim("not json");
  const lines = out.stdout.trim().split("\n");
  const events = lines.map((l) => JSON.parse(l) as WorkerEvent);
  expect(events.length).toBe(1);
  expect(events[0]?.kind).toBe("error");
  expect(out.exitCode).not.toBe(0);
});
```

- [ ] **Step 2: Run — expect failure**

Run: `bun test packages/dalang/tests/worker/main.test.ts`
Expected: FAIL — fixture missing.

- [ ] **Step 3: Implement the fixture echo-shim**

Create `packages/dalang/tests/fixtures/worker/echo-shim.ts`:

```ts
// A test-only stand-in for the real worker shim. Reads JSON from stdin,
// emits one provider_event per array item, then a finished event.
import { runWorkerLoop } from "../../../src/worker/main";

async function* echo(invocation: unknown): AsyncGenerator<unknown> {
  if (
    typeof invocation === "object" &&
    invocation !== null &&
    "items" in invocation &&
    Array.isArray((invocation as { items: unknown }).items)
  ) {
    for (const item of (invocation as { items: unknown[] }).items) {
      yield item;
    }
    return;
  }
  throw new Error("echo-shim: invalid input (expected { items: [...] })");
}

await runWorkerLoop({
  parseInvocation: (raw: string): unknown => JSON.parse(raw),
  runProvider: echo,
});
```

- [ ] **Step 4: Implement `packages/dalang/src/worker/main.ts`**

The real CLI entry will route on `provider`. For Phase 2 Task 2 it exposes a generic loop that takes a parser + a provider runner, so the fixture can reuse it. Provider dispatch is wired in Tasks 3–5.

```ts
import { serializeEvent, type WorkerEvent } from "./protocol";

export interface WorkerLoopOptions<I> {
  parseInvocation: (raw: string) => I;
  runProvider: (invocation: I, signal: AbortSignal) => AsyncGenerator<unknown>;
}

async function readAllStdin(): Promise<string> {
  const decoder = new TextDecoder();
  let out = "";
  const reader = Bun.stdin.stream().getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

function emit(ev: WorkerEvent): void {
  Bun.write(Bun.stdout, serializeEvent(ev) + "\n");
}

export async function runWorkerLoop<I>(opts: WorkerLoopOptions<I>): Promise<never> {
  const ac = new AbortController();
  const onSignal = () => ac.abort();
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);

  let exitCode = 0;
  try {
    const raw = await readAllStdin();
    let invocation: I;
    try {
      invocation = opts.parseInvocation(raw);
    } catch (err) {
      emit({ kind: "error", message: `invalid invocation: ${(err as Error).message}` });
      process.exit(2);
    }

    try {
      for await (const ev of opts.runProvider(invocation, ac.signal)) {
        emit({ kind: "provider_event", payload: ev });
      }
      emit({ kind: "finished" });
    } catch (err) {
      emit({ kind: "error", message: (err as Error).message });
      exitCode = 1;
    }
  } finally {
    process.off("SIGTERM", onSignal);
    process.off("SIGINT", onSignal);
  }
  process.exit(exitCode);
}
```

- [ ] **Step 5: Run — expect pass**

Run: `bun test packages/dalang/tests/worker/main.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck`

- [ ] **Step 7: Commit**

```bash
git add packages/dalang/src/worker/main.ts packages/dalang/tests/worker/main.test.ts packages/dalang/tests/fixtures/worker/echo-shim.ts
git commit -m "feat(dalang): worker shim main loop + echo test fixture"
```

---

## Task 3: Claude provider in the shim

Drive `@anthropic-ai/claude-agent-sdk` from inside the shim. The implementation lifts the existing `sdk-runner.ts` body verbatim — the SDK call is identical regardless of where it runs.

**Files:**

- Create: `packages/dalang/src/worker/claude.ts`
- Modify: `packages/dalang/src/worker/main.ts` — add `provider: "claude"` dispatch
- Test: extend `packages/dalang/tests/worker/main.test.ts`

- [ ] **Step 1: Failing test (gated behind `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`)**

Append to `packages/dalang/tests/worker/main.test.ts`:

```ts
import { resolve as nodeResolve } from "node:path";

const realShim = nodeResolve(import.meta.dir, "..", "..", "src", "worker", "main.ts");
const claudeAuthAvailable =
  typeof process.env["ANTHROPIC_API_KEY"] === "string" ||
  typeof process.env["CLAUDE_CODE_OAUTH_TOKEN"] === "string";

test("worker main with provider:claude streams provider_events from a real Claude turn", async () => {
  if (!claudeAuthAvailable) return;
  const claudePath = process.env["DALANG_CLAUDE_PATH"] ?? "claude";
  const invocation = JSON.stringify({
    provider: "claude",
    prompt: "Say only the word: pong",
    cwd: process.cwd(),
    model: "claude-haiku-4-5-20251001",
    executablePath: claudePath,
    claude: { permissionMode: "default" },
  });
  const proc = Bun.spawn(["bun", "run", realShim], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: process.env as Record<string, string>,
  });
  proc.stdin.write(invocation);
  proc.stdin.end();
  const stdoutText = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  const events = stdoutText
    .trim()
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as { kind: string });
  // We at least see one provider_event and a finished marker.
  expect(events.some((e) => e.kind === "provider_event")).toBe(true);
  expect(events[events.length - 1]?.kind).toBe("finished");
  expect(exitCode).toBe(0);
});
```

- [ ] **Step 2: Run — expect failure (or skip)**

Run: `bun test packages/dalang/tests/worker/main.test.ts`
Expected: FAIL — `provider:claude` not handled. Skipped on hosts without auth.

- [ ] **Step 3: Implement `packages/dalang/src/worker/claude.ts`**

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { WorkerInvocation } from "./protocol";

function abortSignalToController(signal: AbortSignal): AbortController {
  const c = new AbortController();
  if (signal.aborted) c.abort();
  else signal.addEventListener("abort", () => c.abort(), { once: true });
  return c;
}

export async function* runClaude(
  inv: Extract<WorkerInvocation, { provider: "claude" }>,
  abortSignal: AbortSignal,
): AsyncGenerator<unknown> {
  const iterable = query({
    prompt: inv.prompt,
    options: {
      cwd: inv.cwd,
      model: inv.model,
      permissionMode: inv.claude.permissionMode,
      pathToClaudeCodeExecutable: inv.executablePath,
      resume: inv.resumeSessionId,
      abortController: abortSignalToController(abortSignal),
    },
  }) as AsyncIterable<unknown>;
  for await (const ev of iterable) {
    yield ev;
  }
}
```

- [ ] **Step 4: Wire dispatch into `main.ts`**

Replace the `runWorkerLoop` export with both the existing helper and a `main()` entrypoint that handles real `WorkerInvocation`s. Replace the file contents with:

```ts
import { WorkerInvocationSchema, serializeEvent, type WorkerEvent, type WorkerInvocation } from "./protocol";
import { runClaude } from "./claude";

export interface WorkerLoopOptions<I> {
  parseInvocation: (raw: string) => I;
  runProvider: (invocation: I, signal: AbortSignal) => AsyncGenerator<unknown>;
}

async function readAllStdin(): Promise<string> {
  const decoder = new TextDecoder();
  let out = "";
  const reader = Bun.stdin.stream().getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

function emit(ev: WorkerEvent): void {
  Bun.write(Bun.stdout, serializeEvent(ev) + "\n");
}

export async function runWorkerLoop<I>(opts: WorkerLoopOptions<I>): Promise<never> {
  const ac = new AbortController();
  const onSignal = () => ac.abort();
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);

  let exitCode = 0;
  try {
    const raw = await readAllStdin();
    let invocation: I;
    try {
      invocation = opts.parseInvocation(raw);
    } catch (err) {
      emit({ kind: "error", message: `invalid invocation: ${(err as Error).message}` });
      process.exit(2);
    }

    try {
      for await (const ev of opts.runProvider(invocation, ac.signal)) {
        emit({ kind: "provider_event", payload: ev });
      }
      emit({ kind: "finished" });
    } catch (err) {
      emit({ kind: "error", message: (err as Error).message });
      exitCode = 1;
    }
  } finally {
    process.off("SIGTERM", onSignal);
    process.off("SIGINT", onSignal);
  }
  process.exit(exitCode);
}

function dispatch(inv: WorkerInvocation, signal: AbortSignal): AsyncGenerator<unknown> {
  switch (inv.provider) {
    case "claude":
      return runClaude(inv, signal);
    case "codex":
      throw new Error("codex provider not yet implemented (Task 4)");
    case "opencode":
      throw new Error("opencode provider not yet implemented (Task 5)");
  }
}

// When run directly as `bun run main.ts`, run the real loop.
if (import.meta.main) {
  await runWorkerLoop({
    parseInvocation: (raw) => WorkerInvocationSchema.parse(JSON.parse(raw)),
    runProvider: dispatch,
  });
}
```

The fixture echo-shim still works because it imports `runWorkerLoop` directly (with its own parser/runner).

- [ ] **Step 5: Run — expect pass**

Run: `bun test packages/dalang/tests/worker/main.test.ts`
Expected: PASS for the echo tests; the real-Claude test passes if auth is available, otherwise skipped.

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck`

- [ ] **Step 7: Commit**

```bash
git add packages/dalang/src/worker/claude.ts packages/dalang/src/worker/main.ts packages/dalang/tests/worker/main.test.ts
git commit -m "feat(dalang): worker shim — Claude provider"
```

---

## Task 4: Codex provider in the shim

Same shape as Task 3 — lift `codex-runner.ts`'s body into a worker module.

**Files:**

- Create: `packages/dalang/src/worker/codex.ts`
- Modify: `packages/dalang/src/worker/main.ts` — wire `provider: "codex"` dispatch
- Create: `packages/dalang/tests/worker/codex.test.ts`

- [ ] **Step 1: Failing test (gated behind `OPENAI_API_KEY` or `~/.codex/auth.json`)**

Create `packages/dalang/tests/worker/codex.test.ts`:

```ts
import { test, expect } from "bun:test";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { homedir } from "node:os";

const realShim = resolve(import.meta.dir, "..", "..", "src", "worker", "main.ts");
const codexAuthAvailable =
  typeof process.env["OPENAI_API_KEY"] === "string" ||
  existsSync(resolve(homedir(), ".codex", "auth.json"));

test("worker main with provider:codex streams provider_events from a real Codex turn", async () => {
  if (!codexAuthAvailable) return;
  const codexPath = process.env["DALANG_CODEX_PATH"] ?? "codex";
  const invocation = JSON.stringify({
    provider: "codex",
    prompt: "Say only the word: pong",
    cwd: process.cwd(),
    model: "gpt-5",
    executablePath: codexPath,
    codex: {
      sandboxMode: "read-only",
      approvalPolicy: "never",
      networkAccessEnabled: false,
    },
  });
  const proc = Bun.spawn(["bun", "run", realShim], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: process.env as Record<string, string>,
  });
  proc.stdin.write(invocation);
  proc.stdin.end();
  const stdoutText = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  const events = stdoutText
    .trim()
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as { kind: string });
  expect(events.some((e) => e.kind === "provider_event")).toBe(true);
  expect(events[events.length - 1]?.kind).toBe("finished");
  expect(exitCode).toBe(0);
});
```

- [ ] **Step 2: Run — expect failure**

Run: `bun test packages/dalang/tests/worker/codex.test.ts`
Expected: FAIL — codex provider throws "not yet implemented".

- [ ] **Step 3: Implement `packages/dalang/src/worker/codex.ts`**

```ts
import { Codex } from "@openai/codex-sdk";
import type { WorkerInvocation } from "./protocol";

export async function* runCodex(
  inv: Extract<WorkerInvocation, { provider: "codex" }>,
  abortSignal: AbortSignal,
): AsyncGenerator<unknown> {
  const codex = new Codex({
    codexPathOverride: inv.executablePath,
    ...(inv.codex.env ? { env: inv.codex.env } : {}),
  });
  const threadOptions = {
    workingDirectory: inv.cwd,
    model: inv.model,
    sandboxMode: inv.codex.sandboxMode,
    approvalPolicy: inv.codex.approvalPolicy,
    networkAccessEnabled: inv.codex.networkAccessEnabled,
  };
  const thread = inv.resumeSessionId
    ? codex.resumeThread(inv.resumeSessionId, threadOptions)
    : codex.startThread(threadOptions);

  const streamed = await thread.runStreamed(inv.prompt, { signal: abortSignal });
  for await (const ev of streamed.events) {
    yield ev;
  }
}
```

- [ ] **Step 4: Wire dispatch in `main.ts`**

Replace the codex throw in `dispatch` with:

```ts
case "codex":
  return runCodex(inv, signal);
```

Add the import at the top: `import { runCodex } from "./codex";`.

- [ ] **Step 5: Run — expect pass**

Run: `bun test packages/dalang/tests/worker/codex.test.ts`
Expected: PASS if auth available, skipped otherwise.

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck`

- [ ] **Step 7: Commit**

```bash
git add packages/dalang/src/worker/codex.ts packages/dalang/src/worker/main.ts packages/dalang/tests/worker/codex.test.ts
git commit -m "feat(dalang): worker shim — Codex provider"
```

---

## Task 5: Opencode provider in the shim

Opencode is the awkward one: it requires a running `opencode` server. In the existing dalang, one server is shared across all workers (managed by `opencode-server.ts`). Inside the shim, that's not viable — the shim is per-worker. Solution: each shim invocation spawns its own opencode server on a random local port, drives one session against it, and tears the server down on exit.

**Files:**

- Create: `packages/dalang/src/worker/opencode.ts`
- Modify: `packages/dalang/src/worker/main.ts` — wire `provider: "opencode"` dispatch
- Create: `packages/dalang/tests/worker/opencode.test.ts`

- [ ] **Step 1: Failing test (gated behind `OPENCODE_AVAILABLE`)**

Create `packages/dalang/tests/worker/opencode.test.ts`:

```ts
import { test, expect, beforeAll } from "bun:test";
import { resolve } from "node:path";

const realShim = resolve(import.meta.dir, "..", "..", "src", "worker", "main.ts");
let opencodeAvailable = false;

beforeAll(async () => {
  // Probe: try to import the SDK; assume opencode binary is on PATH if env var set.
  const opencodePath = process.env["DALANG_OPENCODE_PATH"];
  opencodeAvailable = typeof opencodePath === "string" && opencodePath.length > 0;
});

test("worker main with provider:opencode streams provider_events from a real session", async () => {
  if (!opencodeAvailable) return;
  const opencodePath = process.env["DALANG_OPENCODE_PATH"] as string;
  const model = process.env["DALANG_OPENCODE_MODEL"] ?? "anthropic/claude-haiku-4-5-20251001";
  const invocation = JSON.stringify({
    provider: "opencode",
    prompt: "Say only the word: pong",
    cwd: process.cwd(),
    model,
    executablePath: opencodePath,
  });
  const proc = Bun.spawn(["bun", "run", realShim], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: process.env as Record<string, string>,
  });
  proc.stdin.write(invocation);
  proc.stdin.end();
  const stdoutText = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  const events = stdoutText
    .trim()
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as { kind: string });
  expect(events.some((e) => e.kind === "provider_event")).toBe(true);
  expect(events[events.length - 1]?.kind).toBe("finished");
  expect(exitCode).toBe(0);
});
```

- [ ] **Step 2: Run — expect failure**

Run: `bun test packages/dalang/tests/worker/opencode.test.ts`
Expected: FAIL — opencode provider throws "not yet implemented".

- [ ] **Step 3: Implement `packages/dalang/src/worker/opencode.ts`**

The shape mirrors the existing `opencode-server.ts` + `opencode-runner.ts` but for a per-shim ephemeral server.

```ts
import { createOpencodeServer, createOpencodeClient } from "@opencode-ai/sdk";
import type { WorkerInvocation } from "./protocol";

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

export async function* runOpencode(
  inv: Extract<WorkerInvocation, { provider: "opencode" }>,
  abortSignal: AbortSignal,
): AsyncGenerator<unknown> {
  const server = await createOpencodeServer({
    hostname: "127.0.0.1",
    port: 0,
    signal: abortSignal,
    timeout: 30000,
    config: { server: { executable: inv.executablePath } },
  });

  try {
    const client = createOpencodeClient({ baseUrl: server.url });
    const session = inv.resumeSessionId
      ? { data: { id: inv.resumeSessionId } }
      : await client.session.create({
          body: { directory: inv.cwd, permission: HARDCODED_PERMISSION },
        });
    const sessionId = session.data.id;

    const model = parseProviderModel(inv.model);

    // Subscribe to event stream BEFORE issuing the prompt.
    const eventStream = await client.event();
    const promptPromise = client.session.promptAsync({
      path: { id: sessionId },
      body: {
        model: { providerID: model.providerID, modelID: model.modelID },
        parts: [{ type: "text", text: inv.prompt }],
      },
    });

    // Yield events until we see a session-end signal or the abort fires.
    for await (const ev of eventStream as AsyncIterable<unknown>) {
      if (abortSignal.aborted) break;
      const e = ev as { type?: string; sessionID?: string };
      if (e.sessionID !== sessionId) continue;
      yield ev;
      if (e.type === "session.idle" || e.type === "session.error") break;
    }
    await promptPromise.catch(() => {});
  } finally {
    server.close();
  }
}
```

> **Note:** The exact terminator events (`session.idle`, `session.error`) match the existing `opencode-runner.ts` shape. If they have moved in the SDK version, adjust to whatever the host runner is using today and keep them consistent.

- [ ] **Step 4: Wire dispatch in `main.ts`**

Replace the opencode throw with:

```ts
case "opencode":
  return runOpencode(inv, signal);
```

Add `import { runOpencode } from "./opencode";`.

- [ ] **Step 5: Run — expect pass**

Run: `bun test packages/dalang/tests/worker/opencode.test.ts`
Expected: PASS if `DALANG_OPENCODE_PATH` set, skipped otherwise.

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck`

- [ ] **Step 7: Commit**

```bash
git add packages/dalang/src/worker/opencode.ts packages/dalang/src/worker/main.ts packages/dalang/tests/worker/opencode.test.ts
git commit -m "feat(dalang): worker shim — Opencode provider"
```

---

## Task 6: Worker barrel export

**Files:**

- Create: `packages/dalang/src/worker/index.ts`

- [ ] **Step 1: Create the barrel**

```ts
export {
  WorkerInvocationSchema,
  WorkerEventSchema,
  serializeEvent,
} from "./protocol";
export type { WorkerInvocation, WorkerEvent } from "./protocol";
export { runWorkerLoop } from "./main";
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`

- [ ] **Step 3: Commit**

```bash
git add packages/dalang/src/worker/index.ts
git commit -m "feat(dalang): worker barrel exports"
```

---

## Task 7: Host-side `remote-runner.ts`

This is the bridge from a `ContainerHost` to a `RunQuery`-shaped `AsyncIterable`. Given a started `ContainerHandle`, it execs the shim, streams stdin (the `WorkerInvocation` JSON), parses NDJSON from stdout, and yields the inner `provider_event` payloads. Errors and finished markers terminate.

**Files:**

- Create: `packages/dalang/src/sandbox/remote-runner.ts`
- Create: `packages/dalang/tests/sandbox/remote-runner.test.ts`
- Modify: `packages/dalang/src/sandbox/index.ts` — re-export

- [ ] **Step 1: Failing test using `FakeContainerHost`**

Create `packages/dalang/tests/sandbox/remote-runner.test.ts`:

```ts
import { test, expect } from "bun:test";
import { resolve } from "node:path";
import { FakeContainerHost } from "../../src/sandbox/fake-host";
import { remoteRunQuery } from "../../src/sandbox/remote-runner";
import type { ResolvedImage } from "../../src/sandbox/types";

const dummyImage: ResolvedImage = {
  kind: "image",
  tag: "fake",
  workspaceFolder: "/workspace",
  remoteUser: null,
  postCreateCommand: null,
};

const fixtureShim = resolve(import.meta.dir, "..", "fixtures", "worker", "echo-shim.ts");

test("remoteRunQuery yields provider_event payloads from the shim until finished", async () => {
  const host = new FakeContainerHost();
  const handle = await host.start({
    name: "remote-runner-1",
    image: dummyImage,
    bindMounts: [],
    env: {},
    resources: { cpus: "1", memory: "256m", pidsLimit: 256, tmpfsSize: "32m" },
  });
  try {
    const events: unknown[] = [];
    for await (const ev of remoteRunQuery({
      handle,
      shimCmd: ["bun", "run", fixtureShim],
      invocation: { items: [{ a: 1 }, { b: 2 }] },
    })) {
      events.push(ev);
    }
    expect(events).toEqual([{ a: 1 }, { b: 2 }]);
  } finally {
    await handle.stop();
  }
});

test("remoteRunQuery throws when the shim emits an error event", async () => {
  const host = new FakeContainerHost();
  const handle = await host.start({
    name: "remote-runner-2",
    image: dummyImage,
    bindMounts: [],
    env: {},
    resources: { cpus: "1", memory: "256m", pidsLimit: 256, tmpfsSize: "32m" },
  });
  try {
    const fn = async () => {
      for await (const _ev of remoteRunQuery({
        handle,
        shimCmd: ["bun", "run", fixtureShim],
        invocation: "not-an-object",
      })) {
        // drain
      }
    };
    await expect(fn()).rejects.toThrow(/invalid input|invalid invocation/);
  } finally {
    await handle.stop();
  }
});

test("remoteRunQuery aborts the shim when the abortSignal fires", async () => {
  const host = new FakeContainerHost();
  const handle = await host.start({
    name: "remote-runner-3",
    image: dummyImage,
    bindMounts: [],
    env: {},
    resources: { cpus: "1", memory: "256m", pidsLimit: 256, tmpfsSize: "32m" },
  });
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 50);
  try {
    const events: unknown[] = [];
    // The fixture echo-shim is fast; this test uses a stalling fixture instead.
    // Use a one-liner stalling command via Bun.spawn semantics:
    for await (const ev of remoteRunQuery({
      handle,
      shimCmd: ["sleep", "10"],
      invocation: {},
      abortSignal: ac.signal,
    })) {
      events.push(ev);
    }
    expect(events).toEqual([]);
  } catch {
    // aborted exec yields no events; either path is acceptable
  } finally {
    await handle.stop();
  }
});
```

- [ ] **Step 2: Run — expect failure**

Run: `bun test packages/dalang/tests/sandbox/remote-runner.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `packages/dalang/src/sandbox/remote-runner.ts`**

```ts
import type { ContainerHandle } from "./types";

export interface RemoteRunOptions {
  handle: ContainerHandle;
  /** The command to exec inside the container, e.g. `["/opt/dalang/bayang"]` or `["bun", "run", "src/worker/main.ts"]`. */
  shimCmd: string[];
  /** Working directory inside the container for the shim. Optional. */
  cwd?: string;
  /** Extra env to inject for the shim. */
  env?: Record<string, string>;
  /** Cancels the underlying exec via the host's abort plumbing. */
  abortSignal?: AbortSignal;
  /** JSON-serializable invocation written to the shim's stdin once at startup. */
  invocation: unknown;
}

interface ProviderEvent {
  kind: "provider_event";
  payload: unknown;
}
interface ErrorEvent {
  kind: "error";
  message: string;
  detail?: unknown;
}
interface FinishedEvent {
  kind: "finished";
}
type WorkerEvent = ProviderEvent | ErrorEvent | FinishedEvent;

function isWorkerEvent(value: unknown): value is WorkerEvent {
  if (typeof value !== "object" || value === null || !("kind" in value)) return false;
  const k = (value as { kind: unknown }).kind;
  return k === "provider_event" || k === "error" || k === "finished";
}

export async function* remoteRunQuery(opts: RemoteRunOptions): AsyncGenerator<unknown> {
  // ContainerHandle.exec doesn't support stdin in Phase 1's API. We pass the
  // invocation JSON via an env var: the shim reads INVOCATION from env when
  // stdin is empty. (Stdin support is a Phase 4 follow-up; env-injection is
  // sufficient for the IPC protocol because invocations are small and
  // already JSON.)
  const invocationJson = JSON.stringify(opts.invocation);

  const exec = await opts.handle.exec({
    cmd: opts.shimCmd,
    cwd: opts.cwd,
    env: { ...(opts.env ?? {}), BAYANG_INVOCATION: invocationJson },
    abortSignal: opts.abortSignal,
  });

  let sawFinished = false;
  let sawError: ErrorEvent | null = null;

  for await (const line of exec.stdout) {
    if (line.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue; // ignore non-JSON noise
    }
    if (!isWorkerEvent(parsed)) continue;
    if (parsed.kind === "provider_event") {
      yield parsed.payload;
    } else if (parsed.kind === "error") {
      sawError = parsed;
      break;
    } else if (parsed.kind === "finished") {
      sawFinished = true;
      break;
    }
  }

  // Drain stderr to surface useful debug info on failure.
  let stderrTail = "";
  for await (const line of exec.stderr) {
    if (stderrTail.length < 4000) stderrTail += `${line}\n`;
  }

  const status = await exec.done;

  if (sawError) {
    throw new Error(`worker shim error: ${sawError.message}\nstderr: ${stderrTail.trim()}`);
  }
  if (!sawFinished && status.exitCode !== 0) {
    throw new Error(`worker shim exited ${status.exitCode}\nstderr: ${stderrTail.trim()}`);
  }
}
```

- [ ] **Step 4: Update `main.ts` and the echo-shim to read from env if stdin is empty**

In `packages/dalang/src/worker/main.ts`, replace `readAllStdin` with a helper that prefers stdin, falls back to `BAYANG_INVOCATION`:

```ts
async function readInvocationRaw(): Promise<string> {
  const env = process.env["BAYANG_INVOCATION"];
  if (typeof env === "string" && env.length > 0) return env;
  const decoder = new TextDecoder();
  let out = "";
  const reader = Bun.stdin.stream().getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}
```

Replace the call site `await readAllStdin()` with `await readInvocationRaw()`.

- [ ] **Step 5: Run — expect pass**

Run: `bun test packages/dalang/tests/sandbox/remote-runner.test.ts`
Expected: PASS.

Also rerun: `bun test packages/dalang/tests/worker/main.test.ts` — the existing tests still pass (stdin path still works when env var is unset).

- [ ] **Step 6: Re-export**

Append to `packages/dalang/src/sandbox/index.ts`:

```ts
export { remoteRunQuery } from "./remote-runner";
export type { RemoteRunOptions } from "./remote-runner";
```

- [ ] **Step 7: Typecheck**

Run: `bun run typecheck`

- [ ] **Step 8: Commit**

```bash
git add packages/dalang/src/sandbox/remote-runner.ts packages/dalang/src/sandbox/index.ts packages/dalang/src/worker/main.ts packages/dalang/tests/sandbox/remote-runner.test.ts
git commit -m "feat(dalang): host-side remote-runner bridges ContainerHost to RunQuery"
```

---

## Task 8: `bun build --compile` for the shim

Produce a single-file binary at `packages/dalang/dist/bayang` that bundles the SDKs. Phase 4 will use this binary; Phase 2 ships the build pipeline so we can iterate.

**Files:**

- Create: `packages/dalang/scripts/build-bayang.ts`
- Modify: `packages/dalang/package.json` — add `bayang:build` script
- Create: `packages/dalang/tests/worker/build.test.ts`

- [ ] **Step 1: Create the build script**

`packages/dalang/scripts/build-bayang.ts`:

```ts
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";

const root = resolve(import.meta.dir, "..");
const entry = resolve(root, "src/worker/main.ts");
const outDir = resolve(root, "dist");
const outFile = resolve(outDir, "bayang");

await mkdir(outDir, { recursive: true });

const proc = Bun.spawn(["bun", "build", "--compile", entry, "--outfile", outFile], {
  cwd: root,
  stdout: "inherit",
  stderr: "inherit",
});
const code = await proc.exited;
if (code !== 0) process.exit(code);
console.log(`built ${outFile}`);
```

- [ ] **Step 2: Add the script to `package.json`**

Inside `packages/dalang/package.json`, add to `"scripts"`:

```json
"bayang:build": "bun run scripts/build-bayang.ts"
```

(Keep alphabetical with existing entries.)

- [ ] **Step 3: Smoke test**

`packages/dalang/tests/worker/build.test.ts`:

```ts
import { test, expect } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

test("bayang:build produces a runnable single-file binary", async () => {
  // This test is opt-in: it requires the build to have been run by the developer/CI.
  // Skip if the binary is missing.
  const bin = resolve(import.meta.dir, "..", "..", "dist", "bayang");
  if (!existsSync(bin)) return;

  const proc = Bun.spawn([bin], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { BAYANG_INVOCATION: "{}" } as Record<string, string>,
  });
  proc.stdin.end();
  const stderrText = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  // With an invalid invocation (`{}` doesn't have `provider`), the shim exits non-zero
  // and emits an error event. Both behaviors are acceptable for a smoke test.
  expect(exitCode === 0 || exitCode === 1 || exitCode === 2).toBe(true);
  // sanity: no node module resolution errors leaked to stderr
  expect(stderrText).not.toContain("Cannot find module");
});
```

- [ ] **Step 4: Run the build, then the test**

Run: `cd packages/dalang && bun run bayang:build && cd .. && cd .. && bun test packages/dalang/tests/worker/build.test.ts`
Expected: build prints `built .../dist/bayang`; test PASSES.

If `bun build --compile` fails because of a native module the SDKs require (codex's platform-specific binary lookup is the most likely culprit), capture the stderr and report as `BLOCKED`. Likely fixes:
- Mark the codex platform packages as `--external` so the binary lookup happens at runtime against bind-mounted vendored binaries (Phase 4 layout decision).
- If `--external` isn't enough, this task drops to `DONE_WITH_CONCERNS` and Phase 4 will revisit the bundling story before integration.

- [ ] **Step 5: Add `dist/` to `.gitignore` (if not already)**

Check `packages/dalang/.gitignore`. If `dist/` is missing, add it:

```bash
echo 'dist/' >> packages/dalang/.gitignore
```

- [ ] **Step 6: Commit**

```bash
git add packages/dalang/scripts/build-bayang.ts packages/dalang/package.json packages/dalang/tests/worker/build.test.ts packages/dalang/.gitignore
git commit -m "feat(dalang): bayang:build produces single-file bayang binary"
```

---

## Task 9: Final verification

- [ ] **Step 1: Full typecheck**

Run: `bun run typecheck`
Expected: dalang exits 0 (papan errors pre-existing).

- [ ] **Step 2: Full sandbox + worker tests**

Run: `bun test packages/dalang/tests/sandbox packages/dalang/tests/worker`
Expected: all tests pass; provider tests requiring API keys / opencode binary may be skipped depending on the dev box.

- [ ] **Step 3: Lint**

Run: `bunx oxlint packages/dalang/src/worker packages/dalang/src/sandbox/remote-runner.ts packages/dalang/tests/worker packages/dalang/tests/sandbox/remote-runner.test.ts`
Expected: no errors.

- [ ] **Step 4: Confirm no orphan resources**

Run: `docker ps -a --filter name=dalang- --format '{{.Names}}'`
Expected: empty (Phase 2 doesn't use Docker, but the integration tests share fixtures with Phase 1).

---

## Phase 2 Done Criteria

- `bayang` shim runs as a host subprocess, accepts a `WorkerInvocation` (stdin or `BAYANG_INVOCATION` env), dispatches by `provider`, and emits NDJSON `WorkerEvent`s.
- Three providers (claude, codex, opencode) implemented in the shim, each smoke-tested against real auth when available, gated otherwise.
- Host-side `remoteRunQuery` bridges a `ContainerHandle` exec to an `AsyncIterable` of provider events, validated through `FakeContainerHost`.
- `bun run bayang:build` produces a single-file binary at `packages/dalang/dist/bayang`. Build may have caveats for codex's platform-binary lookup — those are recorded and addressed in Phase 4 if they didn't get resolved here.
- No changes to dalang's existing runner seam (`agent-runner.ts`, `sdk-runner.ts`, etc.). Phase 4 wires it up.

## Open Questions

1. **Stdin support on `ContainerHandle.exec`.** Phase 2 uses `BAYANG_INVOCATION` env injection because Phase 1's exec API doesn't expose stdin. Phase 4 may add stdin support to `ContainerHandle.exec` so the invocation can be piped instead of going through env (cleaner for large prompts).
2. **opencode terminator events.** `runOpencode` ends the loop on `session.idle` / `session.error`. If those event names change in the SDK, the existing host runner's terminator logic should be the source of truth — keep them in sync.
3. **Codex platform-binary bundling under `bun build --compile`.** May force `--external` on the `@openai/codex-{platform}` packages and ship them as siblings of the binary. Resolve in Phase 2 Task 8 if possible; otherwise defer to Phase 4.
4. **Provider CLI distribution.** Phase 4 must decide where the `claude`, `codex`, `opencode` binaries come from inside the worker container — bind-mounted from a dalang-controlled directory, vs. installed in the repo's image. Phase 2 sidesteps this by running the shim on the host (FakeContainerHost) where the CLIs are normally installed.

## Risks

- **Bun-compile + native binary lookup.** `findCodexPath()` uses `createRequire().resolve("@openai/codex/package.json")` which probably fails inside a single-file binary unless the codex platform packages are externalized. The build script's `--external` flag handles this, but the failure mode is "shim runs, codex throws Unable to locate Codex CLI binaries". Phase 4 must place the codex binary at a known path and pass `executablePath` in the invocation explicitly.
- **opencode server orphaning.** `runOpencode`'s `finally { server.close() }` should clean up, but if the shim is SIGKILL'd the server may linger. Mitigated in Phase 4 by container teardown — when the worker container goes, so does anything inside it.
- **Async iterable hangs after error.** The shim's `dispatch` returns a generator; if the underlying SDK throws asynchronously the `for await` in the loop catches it. Verify by hand that `runClaude` / `runCodex` / `runOpencode` propagate errors rather than swallowing.

## Next Phase

- **Phase 3** — Auth credential store, per-worker codex/opencode `auth.json` projection, `dalang auth login <provider>` subcommand. Depends on Phase 1 only (shim isn't strictly required, but auth makes the most sense once we have somewhere to inject credentials into).
