# Provider State Overrides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add provider-specific global reasoning settings and per-state model/reasoning overrides in `WORKFLOW.md`, with lint coverage and host/sandbox runner propagation.

**Architecture:** Keep overrides inside each provider block and resolve the active provider's effective runtime config at dispatch time from the issue state. Schema validation owns provider-specific value shapes; `dalang lint` catches dead override state keys; runners receive resolved model/reasoning fields through existing `AgentConfig` and worker invocation paths.

**Tech Stack:** Bun, TypeScript, Zod, Liquid workflow loader/linter, Claude Agent SDK, OpenAI Codex SDK, opencode SDK, dalang sandbox worker protocol.

---

## File Structure

- Modify `packages/dalang/src/config/schema.ts`: add provider-specific reasoning fields and `state_overrides` schemas/defaults.
- Modify `packages/dalang/tests/config/schema.test.ts`: cover defaults and provider-specific validation.
- Modify `packages/dalang/src/config/workflow-linter.ts`: lint active provider override state keys against `control_plane.active_states`.
- Modify `packages/dalang/tests/config/workflow-linter.test.ts`: cover accepted and rejected override state keys.
- Modify `packages/dalang/src/agent/agent-runner.ts`: extend provider config and run-query option types with Claude/Codex reasoning fields and pass them through.
- Modify `packages/dalang/src/agent/claude-options.ts`: map Claude `effort` into SDK query options.
- Modify `packages/dalang/src/agent/codex-runner.ts`: map Codex `modelReasoningEffort` into SDK thread options.
- Modify `packages/dalang/tests/agent/agent-runner.test.ts`, `packages/dalang/tests/agent/agent-runner-codex.test.ts`, `packages/dalang/tests/agent/sdk-runner.test.ts`, and `packages/dalang/tests/agent/codex-runner.test.ts`: verify option propagation.
- Modify `packages/dalang/src/orchestrator/orchestrator.ts`: resolve active provider state overrides and include effective config in spawn logs.
- Modify `packages/dalang/tests/orchestrator/orchestrator.test.ts`: verify state-specific model/reasoning resolution for Claude, Codex, and opencode plus global fallback and hot reload.
- Modify `packages/dalang/src/worker/protocol.ts`: carry Claude/Codex reasoning fields through sandbox worker invocations.
- Modify `packages/dalang/src/worker/claude.ts` and `packages/dalang/src/worker/codex.ts`: pass worker reasoning fields into provider SDKs.
- Modify `packages/dalang/src/sandbox/sandboxed-runner.ts`: include reasoning fields when building worker invocations.
- Modify `packages/dalang/tests/worker/protocol.test.ts` and `packages/dalang/tests/sandbox/sandboxed-runner.test.ts`: verify sandbox serialization.

### Task 1: Schema Support

**Files:**
- Modify: `packages/dalang/src/config/schema.ts`
- Test: `packages/dalang/tests/config/schema.test.ts`

- [ ] **Step 1: Add failing schema tests**

Append these tests to `packages/dalang/tests/config/schema.test.ts`:

```ts
test("provider state_overrides default to empty objects", () => {
  const claudeCfg = applyDefaults({});
  expect(claudeCfg.claude?.state_overrides).toEqual({});

  const codexCfg = applyDefaults({ agent_provider: "codex" });
  expect(codexCfg.codex?.state_overrides).toEqual({});

  const opencodeCfg = applyDefaults({
    agent_provider: "opencode",
    opencode: { model: "anthropic/claude-sonnet-4-6" },
  });
  expect(opencodeCfg.opencode?.state_overrides).toEqual({});
});

test("claude accepts global and per-state effort", () => {
  const cfg = applyDefaults({
    claude: {
      effort: "high",
      state_overrides: {
        Planning: { model: "claude-opus-4-7", effort: "max" },
      },
    },
  });
  const parsed = WorkflowFrontMatterSchema.parse(cfg);
  expect(parsed.claude?.effort).toBe("high");
  expect(parsed.claude?.state_overrides.Planning?.effort).toBe("max");
});

test("claude rejects unknown effort values", () => {
  const cfg = applyDefaults({
    claude: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      effort: "turbo" as any,
      state_overrides: {},
    },
  });
  expect(() => WorkflowFrontMatterSchema.parse(cfg)).toThrow();
});

test("codex accepts global and per-state model_reasoning_effort", () => {
  const cfg = applyDefaults({
    agent_provider: "codex",
    codex: {
      model_reasoning_effort: "high",
      state_overrides: {
        Planning: { model: "gpt-5.5", model_reasoning_effort: "xhigh" },
      },
    },
  });
  const parsed = WorkflowFrontMatterSchema.parse(cfg);
  expect(parsed.codex?.model_reasoning_effort).toBe("high");
  expect(parsed.codex?.state_overrides.Planning?.model_reasoning_effort).toBe("xhigh");
});

test("codex rejects unknown model_reasoning_effort values", () => {
  const cfg = applyDefaults({
    agent_provider: "codex",
    codex: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      model_reasoning_effort: "max" as any,
    },
  });
  expect(() => WorkflowFrontMatterSchema.parse(cfg)).toThrow();
});

test("opencode state override model must stay in provider/model form", () => {
  const cfg = applyDefaults({
    agent_provider: "opencode",
    opencode: {
      model: "anthropic/claude-sonnet-4-6",
      state_overrides: {
        Planning: { model: "not-provider-model" },
      },
    },
  });
  expect(() => WorkflowFrontMatterSchema.parse(cfg)).toThrow(/provider\/model/);
});
```

- [ ] **Step 2: Run schema tests to verify failure**

Run: `bun test packages/dalang/tests/config/schema.test.ts`

Expected: FAIL with errors mentioning missing `state_overrides`, `effort`, or `model_reasoning_effort` schema properties.

- [ ] **Step 3: Add provider override schemas**

In `packages/dalang/src/config/schema.ts`, replace the provider schemas with this structure. Keep the existing exported provider enums above these definitions:

```ts
const StateOverrideKey = z.string().min(1);

const ClaudeEffort = z.enum(["low", "medium", "high", "xhigh", "max"]);

const ClaudeStateOverrideSchema = z
  .object({
    model: z.string().min(1).optional(),
    effort: ClaudeEffort.optional(),
  })
  .strict();

export const ClaudeSchema = z.object({
  executable_path: z.string().min(1),
  model: z.string().min(1),
  effort: ClaudeEffort.optional(),
  permission_mode: ClaudePermissionMode,
  turn_timeout_ms: z.number().int().positive(),
  read_timeout_ms: z.number().int().positive(),
  stall_timeout_ms: z.number().int(),
  state_overrides: z.record(StateOverrideKey, ClaudeStateOverrideSchema).default({}),
});

const CodexReasoningEffort = z.enum(["minimal", "low", "medium", "high", "xhigh"]);

const CodexStateOverrideSchema = z
  .object({
    model: z.string().min(1).optional(),
    model_reasoning_effort: CodexReasoningEffort.optional(),
  })
  .strict();

export const CodexSchema = z.object({
  executable_path: z.string().min(1),
  model: z.string().min(1),
  model_reasoning_effort: CodexReasoningEffort.optional(),
  sandbox_mode: CodexSandboxMode,
  approval_policy: CodexApprovalPolicy,
  network_access_enabled: z.boolean().default(true),
  turn_timeout_ms: z.number().int().positive(),
  read_timeout_ms: z.number().int().positive(),
  stall_timeout_ms: z.number().int(),
  state_overrides: z.record(StateOverrideKey, CodexStateOverrideSchema).default({}),
});

const OpencodeStateOverrideSchema = z
  .object({
    model: z
      .string()
      .min(1)
      .regex(/^[^/]+\/.+$/, "model must be in providerID/modelID form")
      .optional(),
  })
  .strict();

export const OpencodeSchema = z.object({
  executable_path: z.string().min(1),
  model: z
    .string()
    .min(1)
    .regex(/^[^/]+\/.+$/, "model must be in providerID/modelID form"),
  state_overrides: z.record(StateOverrideKey, OpencodeStateOverrideSchema).default({}),
  turn_timeout_ms: z.number().int().positive(),
  read_timeout_ms: z.number().int().positive(),
  stall_timeout_ms: z.number().int(),
});
```

Update `DEFAULTS` provider blocks to include:

```ts
state_overrides: {},
```

Add `model_reasoning_effort` and `effort` only when there is an intentional default. For this implementation, leave both absent by default so existing behavior remains unchanged.

- [ ] **Step 4: Run schema tests**

Run: `bun test packages/dalang/tests/config/schema.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit schema support**

```bash
git add packages/dalang/src/config/schema.ts packages/dalang/tests/config/schema.test.ts
git commit -m "feat(dalang): add provider state override schema"
```

### Task 2: Workflow Linter Support

**Files:**
- Modify: `packages/dalang/src/config/workflow-linter.ts`
- Test: `packages/dalang/tests/config/workflow-linter.test.ts`

- [ ] **Step 1: Add failing linter tests**

Append these tests to `packages/dalang/tests/config/workflow-linter.test.ts`:

```ts
test("lint accepts active provider state overrides for active states", async () => {
  const path = await writeWorkflow(
    "{{ issue.title }}",
    `
control_plane:
  kind: papan
  endpoint: http://localhost:3001
  active_states: ["Planning", "In Dev"]
  terminal_states: ["Done"]
claude:
  state_overrides:
    planning:
      model: claude-opus-4-7
      effort: max
`,
  );

  const result = await lintWorkflow(path);

  expect(result.ok).toBe(true);
  expect(result.diagnostics).toEqual([]);
});

test("lint rejects active provider state overrides outside active states", async () => {
  const path = await writeWorkflow(
    "{{ issue.title }}",
    `
control_plane:
  kind: papan
  endpoint: http://localhost:3001
  active_states: ["In Dev"]
  terminal_states: ["Done"]
claude:
  state_overrides:
    Planning:
      model: claude-opus-4-7
      effort: max
`,
  );

  const result = await lintWorkflow(path);

  expect(result.ok).toBe(false);
  expect(result.diagnostics.map((d) => d.message)).toContain(
    "claude.state_overrides.Planning does not match any active state",
  );
});

test("lint ignores inactive provider state_overrides", async () => {
  const path = await writeWorkflow(
    "{{ issue.title }}",
    `
agent_provider: codex
control_plane:
  kind: papan
  endpoint: http://localhost:3001
  active_states: ["Planning"]
  terminal_states: ["Done"]
codex:
  state_overrides:
    Planning:
      model: gpt-5.5
      model_reasoning_effort: high
claude:
  state_overrides:
    Not Active:
      model: claude-opus-4-7
      effort: max
`,
  );

  const result = await lintWorkflow(path);

  expect(result.ok).toBe(true);
  expect(result.diagnostics).toEqual([]);
});
```

- [ ] **Step 2: Run linter tests to verify failure**

Run: `bun test packages/dalang/tests/config/workflow-linter.test.ts`

Expected: FAIL because override state keys are not linted yet.

- [ ] **Step 3: Add lint diagnostic code**

In `packages/dalang/src/config/workflow-linter.ts`, add `"inactive_state_override"` to `WorkflowLintDiagnostic["code"]`:

```ts
    | "invalid_liquid_for"
    | "inactive_state_override";
```

In `lintWorkflow()`, after the existing Liquid diagnostics line, add:

```ts
  diagnostics.push(...lintProviderStateOverrides(loaded.config));
```

Add this helper near the bottom of the file:

```ts
function lintProviderStateOverrides(cfg: WorkflowFrontMatter): WorkflowLintDiagnostic[] {
  const provider = cfg.agent_provider;
  const active = new Set(cfg.control_plane.active_states.map((state) => state.toLowerCase()));
  const overrides =
    provider === "claude"
      ? cfg.claude?.state_overrides
      : provider === "codex"
        ? cfg.codex?.state_overrides
        : cfg.opencode?.state_overrides;
  if (!overrides) return [];

  const diagnostics: WorkflowLintDiagnostic[] = [];
  for (const state of Object.keys(overrides)) {
    if (active.has(state.toLowerCase())) continue;
    diagnostics.push({
      severity: "error",
      code: "inactive_state_override",
      message: `${provider}.state_overrides.${state} does not match any active state`,
    });
  }
  return diagnostics;
}
```

- [ ] **Step 4: Run linter tests**

Run: `bun test packages/dalang/tests/config/workflow-linter.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit linter support**

```bash
git add packages/dalang/src/config/workflow-linter.ts packages/dalang/tests/config/workflow-linter.test.ts
git commit -m "feat(dalang): lint provider state overrides"
```

### Task 3: Agent Runner Option Plumbing

**Files:**
- Modify: `packages/dalang/src/agent/agent-runner.ts`
- Modify: `packages/dalang/src/agent/claude-options.ts`
- Modify: `packages/dalang/src/agent/codex-runner.ts`
- Test: `packages/dalang/tests/agent/agent-runner.test.ts`
- Test: `packages/dalang/tests/agent/agent-runner-codex.test.ts`
- Test: `packages/dalang/tests/agent/sdk-runner.test.ts`
- Test: `packages/dalang/tests/agent/codex-runner.test.ts`

- [ ] **Step 1: Add failing runAttempt propagation tests**

In `packages/dalang/tests/agent/agent-runner.test.ts`, add:

```ts
test("runAttempt passes Claude effort into runQuery options", async () => {
  let observedEffort: string | null = null;
  const result = await runAttempt({
    ...baseDeps([]),
    config: {
      ...baseDeps([]).config,
      effort: "max",
    },
    issue,
    attempt: null,
    runQuery: async function* (opts) {
      observedEffort = opts.claude?.effort ?? null;
      yield { type: "system", subtype: "init", session_id: "sess-effort" };
      yield {
        type: "result",
        subtype: "success",
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      };
    },
    onEvent: () => {},
  });

  expect(result.success).toBe(true);
  expect(observedEffort).toBe("max");
});
```

In `packages/dalang/tests/agent/agent-runner-codex.test.ts`, add:

```ts
test("runAttempt passes Codex model reasoning effort into runQuery options", async () => {
  let observedEffort: string | null = null;

  const result = await runAttempt({
    issue,
    attempt: 1,
    promptTemplate: "{{ issue.title }}",
    workspacePath: "/tmp/workspace",
    config: {
      provider: "codex" as const,
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
      networkAccessEnabled: false,
      model: "gpt-5.5",
      modelReasoningEffort: "xhigh",
      executablePath: "codex",
      turnTimeoutMs: 60000,
      readTimeoutMs: 5000,
      stallTimeoutMs: 30000,
      maxTurns: 1,
    },
    controlPlane: { kind: "papan", endpoint: "http://localhost", api_key: null },
    trackerRefresh: async () => null,
    isActiveState: () => false,
    runQuery: async function* (opts) {
      observedEffort = opts.codex?.modelReasoningEffort ?? null;
      yield { type: "thread.started", thread_id: "codex-thread-effort" };
      yield { type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } };
    },
    onEvent: () => {},
  });

  expect(result.success).toBe(true);
  expect(observedEffort).toBe("xhigh");
});
```

- [ ] **Step 2: Add failing direct SDK option tests**

In `packages/dalang/tests/agent/sdk-runner.test.ts`, add:

```ts
test("buildClaudeQueryOptions maps effort", () => {
  const opts = buildClaudeQueryOptions({
    prompt: "noop",
    cwd: "/tmp",
    claude: { permissionMode: "auto", effort: "xhigh" },
    model: "claude-opus-4-7",
    executablePath: "/nonexistent/path/to/claude",
  });

  expect(opts.options?.effort).toBe("xhigh");
});
```

In `packages/dalang/tests/agent/codex-runner.test.ts`, add a smoke test that constructs an iterable with the new option:

```ts
test("codexRunQuery accepts model reasoning effort", () => {
  const it = codexRunQuery({
    prompt: "hello",
    cwd: "/tmp",
    codex: {
      sandboxMode: "read-only",
      approvalPolicy: "never",
      networkAccessEnabled: false,
      modelReasoningEffort: "high",
    },
    model: "gpt-5.5",
    executablePath: "codex",
  });
  expect(typeof (it as AsyncIterable<unknown>)[Symbol.asyncIterator]).toBe("function");
});
```

- [ ] **Step 3: Run agent tests to verify failure**

Run:

```bash
bun test packages/dalang/tests/agent/agent-runner.test.ts packages/dalang/tests/agent/agent-runner-codex.test.ts packages/dalang/tests/agent/sdk-runner.test.ts packages/dalang/tests/agent/codex-runner.test.ts
```

Expected: FAIL with TypeScript/runtime failures for missing `effort` and `modelReasoningEffort` fields.

- [ ] **Step 4: Extend agent-runner types and option construction**

In `packages/dalang/src/agent/agent-runner.ts`:

```ts
export interface ClaudeAgentConfig extends CommonAgentConfig {
  provider: "claude";
  permissionMode: "auto" | "default" | "plan" | "bypassPermissions";
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
}
```

```ts
export interface CodexAgentConfig extends CommonAgentConfig {
  provider: "codex";
  sandboxMode: "read-only" | "workspace-write" | "danger-full-access";
  approvalPolicy: "untrusted" | "on-failure" | "on-request" | "never";
  networkAccessEnabled: boolean;
  modelReasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
  env?: Record<string, string>;
}
```

Update `ClaudeRunQueryOptions`:

```ts
claude: {
  permissionMode: ClaudeAgentConfig["permissionMode"];
  effort?: ClaudeAgentConfig["effort"];
};
```

Update `CodexRunQueryOptions["codex"]`:

```ts
modelReasoningEffort?: CodexAgentConfig["modelReasoningEffort"];
```

In `driveOneTurn()`, include optional fields:

```ts
claude: {
  permissionMode: opts.config.permissionMode,
  ...(opts.config.effort ? { effort: opts.config.effort } : {}),
}
```

```ts
...(opts.config.modelReasoningEffort
  ? { modelReasoningEffort: opts.config.modelReasoningEffort }
  : {}),
```

- [ ] **Step 5: Map provider SDK options**

In `packages/dalang/src/agent/claude-options.ts`, add `effort` to the returned SDK options:

```ts
...(opts.claude.effort ? { effort: opts.claude.effort } : {}),
```

Place it inside `options`, next to `model` and `permissionMode`.

In `packages/dalang/src/agent/codex-runner.ts`, add the Codex thread option:

```ts
...(opts.codex.modelReasoningEffort
  ? { modelReasoningEffort: opts.codex.modelReasoningEffort }
  : {}),
```

Place it inside `threadOptions`, next to `model`.

- [ ] **Step 6: Run agent tests**

Run:

```bash
bun test packages/dalang/tests/agent/agent-runner.test.ts packages/dalang/tests/agent/agent-runner-codex.test.ts packages/dalang/tests/agent/sdk-runner.test.ts packages/dalang/tests/agent/codex-runner.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit runner option plumbing**

```bash
git add packages/dalang/src/agent/agent-runner.ts packages/dalang/src/agent/claude-options.ts packages/dalang/src/agent/codex-runner.ts packages/dalang/tests/agent/agent-runner.test.ts packages/dalang/tests/agent/agent-runner-codex.test.ts packages/dalang/tests/agent/sdk-runner.test.ts packages/dalang/tests/agent/codex-runner.test.ts
git commit -m "feat(dalang): pass provider reasoning options"
```

### Task 4: Orchestrator State Override Resolution

**Files:**
- Modify: `packages/dalang/src/orchestrator/orchestrator.ts`
- Test: `packages/dalang/tests/orchestrator/orchestrator.test.ts`

- [ ] **Step 1: Add failing orchestrator tests**

Append these tests to `packages/dalang/tests/orchestrator/orchestrator.test.ts`:

```ts
test("dispatch applies Claude state override model and effort", async () => {
  const root = await tmpRoot();
  const tracker = new FakeControlPlane();
  tracker.candidates = [issue("i1", "Planning")];
  tracker.byIds["i1"] = issue("i1", "Done");
  const cfg = applyDefaults({
    control_plane: {
      kind: "papan",
      endpoint: "http://localhost:1",
      active_states: ["Planning"],
      terminal_states: ["Done"],
    },
    workspace: { root },
    agent: { max_concurrent_agents: 1, max_turns: 1 },
    polling: { interval_ms: 1000 },
    claude: {
      model: "claude-sonnet-4-6",
      effort: "medium",
      state_overrides: {
        Planning: { model: "claude-opus-4-7", effort: "max" },
      },
    },
  });

  let observed: { model: string; effort: string | null } | null = null;
  const orch = new Orchestrator({
    controlPlane: tracker,
    config: cfg,
    promptTemplate: "x",
    runQuery: async function* (opts) {
      observed = { model: opts.model, effort: opts.claude?.effort ?? null };
      yield { type: "system", subtype: "init", session_id: "s1" };
      yield { type: "result", subtype: "success", usage: { total_tokens: 1 } };
    },
  });

  await orch.tick();
  await orch.drainPendingForTest();

  expect(observed).toEqual({ model: "claude-opus-4-7", effort: "max" });
});

test("dispatch applies Codex state override model and reasoning effort", async () => {
  const root = await tmpRoot();
  const tracker = new FakeControlPlane();
  tracker.candidates = [issue("i1", "Planning")];
  tracker.byIds["i1"] = issue("i1", "Done");
  const cfg = applyDefaults({
    agent_provider: "codex",
    control_plane: {
      kind: "papan",
      endpoint: "http://localhost:1",
      active_states: ["Planning"],
      terminal_states: ["Done"],
    },
    workspace: { root },
    agent: { max_concurrent_agents: 1, max_turns: 1 },
    polling: { interval_ms: 1000 },
    codex: {
      model: "gpt-5.4",
      model_reasoning_effort: "low",
      state_overrides: {
        Planning: { model: "gpt-5.5", model_reasoning_effort: "xhigh" },
      },
    },
  });

  let observed: { model: string; effort: string | null } | null = null;
  const orch = new Orchestrator({
    controlPlane: tracker,
    config: cfg,
    promptTemplate: "x",
    runQuery: async function* (opts) {
      observed = { model: opts.model, effort: opts.codex?.modelReasoningEffort ?? null };
      yield { type: "thread.started", thread_id: "c1" };
      yield { type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } };
    },
  });

  await orch.tick();
  await orch.drainPendingForTest();

  expect(observed).toEqual({ model: "gpt-5.5", effort: "xhigh" });
});

test("dispatch applies opencode state override model", async () => {
  const root = await tmpRoot();
  const tracker = new FakeControlPlane();
  tracker.candidates = [issue("i1", "Planning")];
  tracker.byIds["i1"] = issue("i1", "Done");
  const cfg = applyDefaults({
    agent_provider: "opencode",
    control_plane: {
      kind: "papan",
      endpoint: "http://localhost:1",
      active_states: ["Planning"],
      terminal_states: ["Done"],
    },
    workspace: { root },
    agent: { max_concurrent_agents: 1, max_turns: 1 },
    polling: { interval_ms: 1000 },
    opencode: {
      model: "anthropic/claude-sonnet-4-6",
      state_overrides: {
        Planning: { model: "anthropic/claude-opus-4-7" },
      },
    },
  });

  let observedModel: string | null = null;
  const orch = new Orchestrator({
    controlPlane: tracker,
    config: cfg,
    promptTemplate: "x",
    runQuery: async function* (opts) {
      observedModel = opts.model;
      yield { type: "session.created", properties: { info: { id: "o1" } } };
      yield { type: "session.idle", properties: { sessionID: "o1", tokens: { input: 1, output: 1, reasoning: 0 } } };
    },
  });

  await orch.tick();
  await orch.drainPendingForTest();

  expect(observedModel).toBe("anthropic/claude-opus-4-7");
});

test("dispatch uses provider global values when state has no override", async () => {
  const root = await tmpRoot();
  const tracker = new FakeControlPlane();
  tracker.candidates = [issue("i1", "In Dev")];
  tracker.byIds["i1"] = issue("i1", "Done");
  const cfg = applyDefaults({
    agent_provider: "codex",
    control_plane: {
      kind: "papan",
      endpoint: "http://localhost:1",
      active_states: ["In Dev"],
      terminal_states: ["Done"],
    },
    workspace: { root },
    agent: { max_concurrent_agents: 1, max_turns: 1 },
    polling: { interval_ms: 1000 },
    codex: {
      model: "gpt-5.4",
      model_reasoning_effort: "low",
      state_overrides: {
        Planning: { model: "gpt-5.5", model_reasoning_effort: "xhigh" },
      },
    },
  });

  let observed: { model: string; effort: string | null } | null = null;
  const orch = new Orchestrator({
    controlPlane: tracker,
    config: cfg,
    promptTemplate: "x",
    runQuery: async function* (opts) {
      observed = { model: opts.model, effort: opts.codex?.modelReasoningEffort ?? null };
      yield { type: "thread.started", thread_id: "c1" };
      yield { type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } };
    },
  });

  await orch.tick();
  await orch.drainPendingForTest();

  expect(observed).toEqual({ model: "gpt-5.4", effort: "low" });
});

test("hot reload changes provider state override for later dispatches", async () => {
  const root = await tmpRoot();
  const tracker = new FakeControlPlane();
  tracker.candidates = [issue("i1", "Planning"), issue("i2", "Planning")];
  tracker.byIds["i1"] = issue("i1", "Done");
  tracker.byIds["i2"] = issue("i2", "Done");
  const base = {
    agent_provider: "codex" as const,
    control_plane: {
      kind: "papan" as const,
      endpoint: "http://localhost:1",
      active_states: ["Planning"],
      terminal_states: ["Done"],
    },
    workspace: { root },
    agent: { max_concurrent_agents: 1, max_turns: 1 },
    polling: { interval_ms: 1000 },
  };
  const cfg = applyDefaults({
    ...base,
    codex: {
      model: "gpt-5.4",
      state_overrides: {
        Planning: { model: "gpt-5.5", model_reasoning_effort: "high" },
      },
    },
  });

  const observed: Array<{ model: string; effort: string | null }> = [];
  const orch = new Orchestrator({
    controlPlane: tracker,
    config: cfg,
    promptTemplate: "x",
    runQuery: async function* (opts) {
      observed.push({ model: opts.model, effort: opts.codex?.modelReasoningEffort ?? null });
      yield { type: "thread.started", thread_id: `c-${observed.length}` };
      yield { type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } };
    },
  });

  await orch.tick();
  await orch.drainPendingForTest();
  expect(observed[0]).toEqual({ model: "gpt-5.5", effort: "high" });

  tracker.candidates = [issue("i2", "Planning")];
  orch.updateConfig(
    applyDefaults({
      ...base,
      codex: {
        model: "gpt-5.4",
        state_overrides: {
          Planning: { model: "gpt-5.3", model_reasoning_effort: "low" },
        },
      },
    }),
    "x",
  );

  await orch.tick();
  await orch.drainPendingForTest();
  expect(observed[1]).toEqual({ model: "gpt-5.3", effort: "low" });
});
```

- [ ] **Step 2: Run orchestrator tests to verify failure**

Run: `bun test packages/dalang/tests/orchestrator/orchestrator.test.ts`

Expected: FAIL because `buildAgentConfig()` does not accept state and does not apply overrides.

- [ ] **Step 3: Implement effective provider config resolution**

In `packages/dalang/src/orchestrator/orchestrator.ts`, change the `runAttempt()` call from:

```ts
config: this.buildAgentConfig(),
```

to:

```ts
config: this.buildAgentConfig(issue.state),
```

Change the method signature:

```ts
private buildAgentConfig(state: string): AgentConfig {
```

At the top of `buildAgentConfig`, keep:

```ts
const common = {
  maxTurns: this.cfg.agent.max_turns,
};
```

For Codex, replace direct `this.cfg.codex` reads with:

```ts
const codex = this.resolveCodexConfig(state);
return {
  provider: "codex",
  ...common,
  model: codex.model,
  executablePath: this.cfg.codex.executable_path,
  turnTimeoutMs: this.cfg.codex.turn_timeout_ms,
  readTimeoutMs: this.cfg.codex.read_timeout_ms,
  stallTimeoutMs: this.cfg.codex.stall_timeout_ms,
  sandboxMode: this.cfg.codex.sandbox_mode,
  approvalPolicy: this.cfg.codex.approval_policy,
  networkAccessEnabled: this.cfg.codex.network_access_enabled,
  ...(codex.modelReasoningEffort
    ? { modelReasoningEffort: codex.modelReasoningEffort }
    : {}),
  env: this.buildCodexEnv(),
};
```

For opencode:

```ts
const oc = this.cfg.opencode;
const resolved = this.resolveOpencodeConfig(state);
return {
  provider: "opencode",
  ...common,
  model: resolved.model,
  executablePath: oc.executable_path,
  turnTimeoutMs: oc.turn_timeout_ms,
  readTimeoutMs: oc.read_timeout_ms,
  stallTimeoutMs: oc.stall_timeout_ms,
};
```

For Claude:

```ts
const claude = this.resolveClaudeConfig(state);
return {
  provider: "claude",
  ...common,
  model: claude.model,
  executablePath: this.cfg.claude.executable_path,
  turnTimeoutMs: this.cfg.claude.turn_timeout_ms,
  readTimeoutMs: this.cfg.claude.read_timeout_ms,
  stallTimeoutMs: this.cfg.claude.stall_timeout_ms,
  permissionMode: this.cfg.claude.permission_mode,
  ...(claude.effort ? { effort: claude.effort } : {}),
};
```

Add helper methods before `buildCodexEnv()`:

```ts
private findStateOverride<T>(overrides: Record<string, T>, state: string): { key: string; value: T } | null {
  const wanted = state.toLowerCase();
  for (const [key, value] of Object.entries(overrides)) {
    if (key.toLowerCase() === wanted) return { key, value };
  }
  return null;
}

private resolveClaudeConfig(state: string): {
  model: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  overrideKey: string | null;
} {
  if (!this.cfg.claude) throw new Error("claude block missing despite agent_provider=claude");
  const match = this.findStateOverride(this.cfg.claude.state_overrides, state);
  return {
    model: match?.value.model ?? this.cfg.claude.model,
    ...(match?.value.effort ?? this.cfg.claude.effort
      ? { effort: match?.value.effort ?? this.cfg.claude.effort }
      : {}),
    overrideKey: match?.key ?? null,
  };
}

private resolveCodexConfig(state: string): {
  model: string;
  modelReasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
  overrideKey: string | null;
} {
  if (!this.cfg.codex) throw new Error("codex block missing despite agent_provider=codex");
  const match = this.findStateOverride(this.cfg.codex.state_overrides, state);
  return {
    model: match?.value.model ?? this.cfg.codex.model,
    ...(match?.value.model_reasoning_effort ?? this.cfg.codex.model_reasoning_effort
      ? { modelReasoningEffort: match?.value.model_reasoning_effort ?? this.cfg.codex.model_reasoning_effort }
      : {}),
    overrideKey: match?.key ?? null,
  };
}

private resolveOpencodeConfig(state: string): { model: string; overrideKey: string | null } {
  if (!this.cfg.opencode) throw new Error("opencode block missing despite agent_provider=opencode");
  const match = this.findStateOverride(this.cfg.opencode.state_overrides, state);
  return {
    model: match?.value.model ?? this.cfg.opencode.model,
    overrideKey: match?.key ?? null,
  };
}
```

If line length becomes excessive, assign intermediate constants before return.

- [ ] **Step 4: Add observability fields**

In `runWorker()`, before the `this.log.info(..., "spawning agent")` call, compute:

```ts
const agentConfig = this.buildAgentConfig(issue.state);
const stateOverride = this.describeStateOverride(issue.state);
```

Pass `agentConfig` to `runAttempt()` instead of calling `buildAgentConfig()` again.

Add this log object fields:

```ts
model: agentConfig.model,
reasoning_effort:
  agentConfig.provider === "claude"
    ? (agentConfig.effort ?? null)
    : agentConfig.provider === "codex"
      ? (agentConfig.modelReasoningEffort ?? null)
      : null,
state_override_applied: stateOverride.applied,
state_override_key: stateOverride.key,
```

Add helper:

```ts
private describeStateOverride(state: string): { applied: boolean; key: string | null } {
  const overrides =
    this.cfg.agent_provider === "claude"
      ? (this.cfg.claude?.state_overrides ?? {})
      : this.cfg.agent_provider === "codex"
        ? (this.cfg.codex?.state_overrides ?? {})
        : (this.cfg.opencode?.state_overrides ?? {});
  const match = this.findStateOverride(overrides, state);
  return { applied: match !== null, key: match?.key ?? null };
}
```

- [ ] **Step 5: Run orchestrator tests**

Run: `bun test packages/dalang/tests/orchestrator/orchestrator.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit orchestrator resolution**

```bash
git add packages/dalang/src/orchestrator/orchestrator.ts packages/dalang/tests/orchestrator/orchestrator.test.ts
git commit -m "feat(dalang): resolve provider overrides by state"
```

### Task 5: Sandbox Worker Protocol

**Files:**
- Modify: `packages/dalang/src/worker/protocol.ts`
- Modify: `packages/dalang/src/worker/claude.ts`
- Modify: `packages/dalang/src/worker/codex.ts`
- Modify: `packages/dalang/src/sandbox/sandboxed-runner.ts`
- Test: `packages/dalang/tests/worker/protocol.test.ts`
- Test: `packages/dalang/tests/sandbox/sandboxed-runner.test.ts`

- [ ] **Step 1: Add failing worker protocol tests**

In `packages/dalang/tests/worker/protocol.test.ts`, update the Claude invocation test input:

```ts
claude: { permissionMode: "auto", effort: "xhigh" },
```

After `expect(parsed.provider).toBe("claude");`, add:

```ts
if (parsed.provider === "claude") {
  expect(parsed.claude.effort).toBe("xhigh");
}
```

Update the Codex invocation test input inside `codex`:

```ts
modelReasoningEffort: "high",
```

After the existing Codex assertions, add:

```ts
expect(parsed.codex.modelReasoningEffort).toBe("high");
```

- [ ] **Step 2: Add failing sandboxed-runner invocation test**

Open `packages/dalang/tests/sandbox/sandboxed-runner.test.ts` and find the test that uses `invocationOverride` or captures worker stdin. Add or update a test so the `RunQueryOptions` passed to `createSandboxedRunQuery()` includes:

```ts
claude: { permissionMode: "auto", effort: "max" },
```

Assert the captured invocation contains:

```ts
expect(invocation).toMatchObject({
  provider: "claude",
  claude: { permissionMode: "auto", effort: "max" },
});
```

Add a second Codex assertion using:

```ts
codex: {
  sandboxMode: "workspace-write",
  approvalPolicy: "never",
  networkAccessEnabled: true,
  modelReasoningEffort: "xhigh",
},
```

Assert:

```ts
expect(invocation).toMatchObject({
  provider: "codex",
  codex: { modelReasoningEffort: "xhigh" },
});
```

Use the existing fake host/captured invocation helpers in that test file; do not introduce a new sandbox test harness.

- [ ] **Step 3: Run worker and sandbox tests to verify failure**

Run:

```bash
bun test packages/dalang/tests/worker/protocol.test.ts packages/dalang/tests/sandbox/sandboxed-runner.test.ts
```

Expected: FAIL because protocol schemas and sandbox invocation builder do not preserve reasoning fields.

- [ ] **Step 4: Extend worker protocol schema**

In `packages/dalang/src/worker/protocol.ts`, update Claude bag:

```ts
claude: z.object({
  permissionMode: z.enum(["auto", "default", "plan", "bypassPermissions"]),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
}),
```

Update Codex bag:

```ts
modelReasoningEffort: z.enum(["minimal", "low", "medium", "high", "xhigh"]).optional(),
```

- [ ] **Step 5: Pass fields through sandbox invocation builder**

In `packages/dalang/src/sandbox/sandboxed-runner.ts`, update Claude invocation:

```ts
claude: {
  permissionMode: opts.claude.permissionMode,
  ...(opts.claude.effort ? { effort: opts.claude.effort } : {}),
},
```

Update Codex invocation:

```ts
...(opts.codex.modelReasoningEffort
  ? { modelReasoningEffort: opts.codex.modelReasoningEffort }
  : {}),
```

Place the Codex field inside the `codex` object.

- [ ] **Step 6: Pass fields inside worker implementations**

In `packages/dalang/src/worker/claude.ts`, include `effort` when building query options by passing `claude: inv.claude`; this should already work after protocol type update. Confirm no destructuring drops the field.

In `packages/dalang/src/worker/codex.ts`, update `threadOptions`:

```ts
...(inv.codex.modelReasoningEffort
  ? { modelReasoningEffort: inv.codex.modelReasoningEffort }
  : {}),
```

- [ ] **Step 7: Run worker and sandbox tests**

Run:

```bash
bun test packages/dalang/tests/worker/protocol.test.ts packages/dalang/tests/sandbox/sandboxed-runner.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit sandbox protocol support**

```bash
git add packages/dalang/src/worker/protocol.ts packages/dalang/src/worker/claude.ts packages/dalang/src/worker/codex.ts packages/dalang/src/sandbox/sandboxed-runner.ts packages/dalang/tests/worker/protocol.test.ts packages/dalang/tests/sandbox/sandboxed-runner.test.ts
git commit -m "feat(dalang): carry reasoning options to sandbox workers"
```

### Task 6: Final Integration Verification

**Files:**
- Modify only if verification reveals a defect in files already touched by Tasks 1-5.

- [ ] **Step 1: Run focused provider override tests**

Run:

```bash
bun test packages/dalang/tests/config/schema.test.ts packages/dalang/tests/config/workflow-linter.test.ts packages/dalang/tests/agent/agent-runner.test.ts packages/dalang/tests/agent/agent-runner-codex.test.ts packages/dalang/tests/agent/sdk-runner.test.ts packages/dalang/tests/agent/codex-runner.test.ts packages/dalang/tests/orchestrator/orchestrator.test.ts packages/dalang/tests/worker/protocol.test.ts packages/dalang/tests/sandbox/sandboxed-runner.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`

Expected: PASS.

- [ ] **Step 3: Run lint**

Run: `bun run lint`

Expected: PASS.

- [ ] **Step 4: Run full test suite**

Run: `bun test`

Expected: PASS.

- [ ] **Step 5: Verify repository diff**

Run: `git status --short`

Expected: only intended source/test files are modified.

Run: `git diff --stat`

Expected: changes are limited to dalang schema, linter, runner, orchestrator, worker protocol, sandbox runner, and tests.

- [ ] **Step 6: Commit final fixes if needed**

If Steps 1-4 required fixes after the prior task commits, commit them:

```bash
git add packages/dalang/src packages/dalang/tests
git commit -m "fix(dalang): complete provider state override integration"
```

If no fixes were needed, do not create an empty commit.
