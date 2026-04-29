# Dalang Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the dalang orchestrator daemon that polls the wayang tracker, dispatches per-issue work to git-worktree workspaces, and runs Claude Agent SDK sessions per issue, with hot-reloadable WORKFLOW.md, retries/reconciliation, and an HTTP observability surface.

**Architecture:** Bun + TypeScript, single in-process daemon. Single-authority orchestrator state (in-memory) mutated through one channel. Workers are async tasks driven by `@anthropic-ai/claude-agent-sdk` `query()` iterators. Workspace = `git worktree` off a shared bare clone. WORKFLOW.md (YAML front matter + Liquid prompt body) is hot-reloaded via chokidar with mtime-based defensive reload.

**Tech Stack:** Bun, TypeScript (tsgo type-checker), oxlint, oxfmt, `bun test`, `@anthropic-ai/claude-agent-sdk`, `liquidjs`, `yaml`, `chokidar`, `pino`, `Bun.serve`.

**Spec reference:** `docs/superpowers/specs/2026-04-29-dalang-orchestrator-design.md`. Section numbers below (e.g. §10.4) refer to that spec.

---

## File Structure

Root (already exists from spec phase):

```
tok-juara/
├── package.json                 # Bun workspaces root
├── tsconfig.base.json           # tsgo settings shared by packages
├── oxlint.json
├── .oxfmtrc
├── bunfig.toml
├── packages/
│   └── dalang/
│       ├── package.json
│       ├── tsconfig.json
│       ├── src/
│       │   ├── types.ts                    # NormalizedIssue, RunAttempt, LiveSession, RetryEntry, OrchestratorState
│       │   ├── index.ts                    # CLI entry / process bootstrap
│       │   ├── config/
│       │   │   ├── env-resolver.ts         # $VAR, ~, path expansion
│       │   │   ├── schema.ts               # zod typed schema for front matter
│       │   │   ├── workflow-loader.ts      # parse WORKFLOW.md + Liquid template
│       │   │   ├── reload.ts               # chokidar + mtime defensive reload
│       │   │   └── validate.ts             # preflight validation + claude auth probe
│       │   ├── tracker/
│       │   │   ├── adapter.ts              # TrackerAdapter interface
│       │   │   ├── normalize.ts            # defensive NormalizedIssue coercion
│       │   │   └── rest-adapter.ts         # wayang REST client
│       │   ├── workspace/
│       │   │   ├── sanitize.ts             # workspace key sanitization
│       │   │   ├── hooks.ts                # bash -lc execution with timeout + env
│       │   │   ├── git-worktree.ts         # repo extension semantics
│       │   │   └── workspace-manager.ts    # WorkspaceManager facade
│       │   ├── agent/
│       │   │   ├── prompt-builder.ts       # liquidjs strict + metadata injection
│       │   │   ├── event-mapper.ts         # SDK message → runtime event
│       │   │   └── agent-runner.ts         # SDK call + multi-turn loop + tokens
│       │   ├── orchestrator/
│       │   │   ├── state.ts                # OrchestratorState ops (pure)
│       │   │   ├── eligibility.ts          # candidate filter + sort
│       │   │   ├── retry.ts                # backoff math + timer mgmt
│       │   │   ├── reconcile.ts            # stall + tracker refresh
│       │   │   └── orchestrator.ts         # main poll loop (composition)
│       │   ├── http/
│       │   │   ├── server.ts               # Bun.serve setup
│       │   │   ├── routes.ts               # /api/v1/* handlers
│       │   │   └── dashboard.ts            # GET / HTML
│       │   └── logging/
│       │       └── logger.ts               # pino setup with required context fields
│       └── tests/                          # mirrors src/ structure
```

The repo root `package.json`, `tsconfig.base.json`, etc. are created in Task 1.

---

## Phase A — Bootstrap (Tasks 1–2)

### Task 1: Initialize bun workspace, lint, format, typecheck

**Files:**
- Create: `package.json` (root)
- Create: `tsconfig.base.json`
- Create: `oxlint.json`
- Create: `.oxfmtrc`
- Create: `bunfig.toml`
- Create: `.gitignore`
- Create: `packages/dalang/package.json`
- Create: `packages/dalang/tsconfig.json`
- Create: `packages/dalang/src/index.ts` (placeholder)

- [ ] **Step 1: Create root `package.json`**

```json
{
  "name": "tok-juara",
  "private": true,
  "version": "0.0.0",
  "workspaces": ["packages/*"],
  "scripts": {
    "typecheck": "bunx --bun tsgo --noEmit",
    "lint": "bunx --bun oxlint .",
    "format": "bunx --bun oxfmt .",
    "format:check": "bunx --bun oxfmt --check .",
    "test": "bun test"
  },
  "devDependencies": {
    "@typescript/native-preview": "latest",
    "oxlint": "latest",
    "oxfmt": "latest",
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023"],
    "types": ["bun-types"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 3: Create `oxlint.json`**

```json
{
  "rules": {
    "no-unused-vars": "error",
    "no-debugger": "error",
    "eqeqeq": "error"
  },
  "ignorePatterns": ["**/node_modules/**", "**/dist/**", "**/.git/**"]
}
```

- [ ] **Step 4: Create `.oxfmtrc`**

```json
{
  "lineWidth": 100,
  "indentWidth": 2,
  "useTabs": false
}
```

- [ ] **Step 5: Create `bunfig.toml`**

```toml
[install]
exact = true

[test]
preload = []
```

- [ ] **Step 6: Create `.gitignore`**

```
node_modules/
dist/
.repo.git/
.dalang/
*.log
.DS_Store
.env
.env.local
```

- [ ] **Step 7: Create `packages/dalang/package.json`**

```json
{
  "name": "@tok-juara/dalang",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "bin": {
    "dalang": "src/index.ts"
  },
  "scripts": {
    "dev": "bun run src/index.ts",
    "test": "bun test"
  },
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "latest",
    "chokidar": "^4.0.0",
    "liquidjs": "^10.0.0",
    "pino": "^9.0.0",
    "yaml": "^2.5.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/bun": "latest"
  }
}
```

- [ ] **Step 8: Create `packages/dalang/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 9: Create `packages/dalang/src/index.ts` placeholder**

```ts
console.log("dalang scaffold");
```

- [ ] **Step 10: Install dependencies**

Run: `bun install`
Expected: success, lockfile created.

- [ ] **Step 11: Verify toolchain**

Run: `bun run typecheck && bun run lint && bun run format:check`
Expected: all three pass with no errors.

- [ ] **Step 12: Commit**

```bash
git add package.json tsconfig.base.json oxlint.json .oxfmtrc bunfig.toml .gitignore bun.lock packages/dalang/
git commit -m "chore: scaffold bun workspace with dalang package and harness"
```

---

### Task 2: Define core domain types

**Files:**
- Create: `packages/dalang/src/types.ts`
- Create: `packages/dalang/tests/types.test.ts`

- [ ] **Step 1: Write a placeholder test confirming types compile**

```ts
// packages/dalang/tests/types.test.ts
import { test, expect } from "bun:test";
import type {
  NormalizedIssue,
  RunAttempt,
  LiveSession,
  RetryEntry,
  OrchestratorState,
  WorkspaceMeta,
  RuntimeEvent,
} from "../src/types";

test("NormalizedIssue is constructible", () => {
  const issue: NormalizedIssue = {
    id: "i_1",
    identifier: "JUARA-1",
    title: "t",
    description: null,
    priority: null,
    state: "Todo",
    branch_name: null,
    url: null,
    labels: [],
    blocked_by: [],
    created_at: null,
    updated_at: null,
  };
  expect(issue.id).toBe("i_1");
});

test("OrchestratorState has expected shape", () => {
  const state: OrchestratorState = {
    poll_interval_ms: 30000,
    max_concurrent_agents: 4,
    running: new Map(),
    claimed: new Set(),
    retry_attempts: new Map(),
    completed: new Set(),
    claude_totals: {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      seconds_running: 0,
    },
    rate_limits: null,
    workflow_mtime: null,
  };
  expect(state.running.size).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/dalang/tests/types.test.ts`
Expected: FAIL — `Cannot find module '../src/types'`.

- [ ] **Step 3: Write `packages/dalang/src/types.ts`**

```ts
// Domain types — match Symphony §4 with dalang renames (spec §5).

export interface BlockerRef {
  id: string | null;
  identifier: string | null;
  state: string | null;
}

export interface NormalizedIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  priority: number | null;
  state: string;
  branch_name: string | null;
  url: string | null;
  labels: string[];
  blocked_by: BlockerRef[];
  created_at: string | null;
  updated_at: string | null;
}

export interface WorkspaceMeta {
  path: string;
  workspace_key: string;
  created_now: boolean;
}

export type RunAttemptStatus =
  | "PreparingWorkspace"
  | "BuildingPrompt"
  | "LaunchingAgent"
  | "InitializingSession"
  | "StreamingTurn"
  | "Finishing"
  | "Succeeded"
  | "Failed"
  | "TimedOut"
  | "Stalled"
  | "CanceledByReconciliation";

export interface RunAttempt {
  issue_id: string;
  issue_identifier: string;
  attempt: number | null;
  workspace_path: string;
  started_at: string;
  status: RunAttemptStatus;
  error?: string | null;
}

export interface LiveSession {
  session_id: string;
  thread_id: string;
  turn_id: string;
  claude_session_pid: string | null;
  last_event: string | null;
  last_event_at: string | null;
  last_message: string | null;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  last_reported_input_tokens: number;
  last_reported_output_tokens: number;
  last_reported_total_tokens: number;
  turn_count: number;
}

export interface RetryEntry {
  issue_id: string;
  identifier: string;
  attempt: number;
  due_at_ms: number;
  timer_handle: ReturnType<typeof setTimeout> | null;
  error: string | null;
}

export interface RunningEntry {
  issue: NormalizedIssue;
  identifier: string;
  workspace_path: string;
  started_at: string;
  abort_controller: AbortController;
  retry_attempt: number | null;
  session: LiveSession | null;
}

export interface ClaudeTotals {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  seconds_running: number;
}

export interface RateLimitsSnapshot {
  // SDK-shaped payload; left loose for v1
  [key: string]: unknown;
}

export interface OrchestratorState {
  poll_interval_ms: number;
  max_concurrent_agents: number;
  running: Map<string, RunningEntry>;
  claimed: Set<string>;
  retry_attempts: Map<string, RetryEntry>;
  completed: Set<string>;
  claude_totals: ClaudeTotals;
  rate_limits: RateLimitsSnapshot | null;
  workflow_mtime: number | null;
}

export type RuntimeEventKind =
  | "session_started"
  | "startup_failed"
  | "turn_completed"
  | "turn_ended_with_error"
  | "turn_failed"
  | "turn_cancelled"
  | "turn_input_required"
  | "approval_auto_approved"
  | "approval_auto_denied"
  | "unsupported_tool_call"
  | "notification"
  | "other_message"
  | "malformed";

export interface RuntimeEvent {
  event: RuntimeEventKind;
  timestamp: string;
  claude_session_pid?: string | null;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  message?: string;
  reason?: string;
  thread_id?: string;
  turn_id?: string;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/dalang/tests/types.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Run typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/dalang/src/types.ts packages/dalang/tests/types.test.ts
git commit -m "feat(dalang): add domain types"
```

---

## Phase B — Foundations (Tasks 3–9)

### Task 3: Workspace key sanitization

**Files:**
- Create: `packages/dalang/src/workspace/sanitize.ts`
- Create: `packages/dalang/tests/workspace/sanitize.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/dalang/tests/workspace/sanitize.test.ts
import { test, expect } from "bun:test";
import { sanitizeWorkspaceKey } from "../../src/workspace/sanitize";

test("preserves allowed characters", () => {
  expect(sanitizeWorkspaceKey("JUARA-12.3_a")).toBe("JUARA-12.3_a");
});

test("replaces disallowed characters with _", () => {
  expect(sanitizeWorkspaceKey("foo/bar")).toBe("foo_bar");
  expect(sanitizeWorkspaceKey("a b/c?d")).toBe("a_b_c_d");
});

test("collapses unicode and spaces", () => {
  expect(sanitizeWorkspaceKey("café 🦊")).toBe("caf___");
});

test("rejects empty input", () => {
  expect(() => sanitizeWorkspaceKey("")).toThrow();
});
```

- [ ] **Step 2: Verify it fails**

Run: `bun test packages/dalang/tests/workspace/sanitize.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/dalang/src/workspace/sanitize.ts
const ALLOWED = /^[A-Za-z0-9._-]$/;

export function sanitizeWorkspaceKey(identifier: string): string {
  if (!identifier) {
    throw new Error("workspace key: identifier must be non-empty");
  }
  let out = "";
  for (const ch of identifier) {
    out += ALLOWED.test(ch) ? ch : "_";
  }
  return out;
}
```

- [ ] **Step 4: Verify pass**

Run: `bun test packages/dalang/tests/workspace/sanitize.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/dalang/src/workspace/sanitize.ts packages/dalang/tests/workspace/sanitize.test.ts
git commit -m "feat(dalang): workspace key sanitization"
```

---

### Task 4: Env and path resolver (`$VAR`, `~`)

**Files:**
- Create: `packages/dalang/src/config/env-resolver.ts`
- Create: `packages/dalang/tests/config/env-resolver.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/dalang/tests/config/env-resolver.test.ts
import { test, expect, beforeEach, afterEach } from "bun:test";
import { resolveEnvValue, expandPath } from "../../src/config/env-resolver";

const originalEnv = { ...process.env };
beforeEach(() => { process.env = { ...originalEnv }; });
afterEach(() => { process.env = { ...originalEnv }; });

test("resolveEnvValue: literal string is returned as-is", () => {
  expect(resolveEnvValue("hello")).toBe("hello");
});

test("resolveEnvValue: $VAR is replaced with env value", () => {
  process.env.TOK_JUARA_API_KEY = "secret-1";
  expect(resolveEnvValue("$TOK_JUARA_API_KEY")).toBe("secret-1");
});

test("resolveEnvValue: missing env var returns null (treated as missing)", () => {
  delete process.env.UNDEFINED_KEY;
  expect(resolveEnvValue("$UNDEFINED_KEY")).toBeNull();
});

test("resolveEnvValue: empty env var returns null", () => {
  process.env.EMPTY_KEY = "";
  expect(resolveEnvValue("$EMPTY_KEY")).toBeNull();
});

test("resolveEnvValue: null/undefined input returns null", () => {
  expect(resolveEnvValue(null)).toBeNull();
  expect(resolveEnvValue(undefined)).toBeNull();
});

test("expandPath: ~ expands to HOME", () => {
  process.env.HOME = "/home/user";
  expect(expandPath("~/foo")).toBe("/home/user/foo");
});

test("expandPath: $VAR within path is expanded", () => {
  process.env.WORKSPACE_BASE = "/var/dalang";
  expect(expandPath("$WORKSPACE_BASE/x")).toBe("/var/dalang/x");
});

test("expandPath: relative path is returned unchanged (caller normalizes)", () => {
  expect(expandPath("./foo")).toBe("./foo");
});
```

- [ ] **Step 2: Verify fail**

Run: `bun test packages/dalang/tests/config/env-resolver.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/dalang/src/config/env-resolver.ts
const VAR_RE = /^\$([A-Za-z_][A-Za-z0-9_]*)$/;
const VAR_INLINE_RE = /\$([A-Za-z_][A-Za-z0-9_]*)/g;

export function resolveEnvValue(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const m = value.match(VAR_RE);
  if (!m) return value;
  const got = process.env[m[1]!];
  if (got === undefined || got === "") return null;
  return got;
}

export function expandPath(input: string): string {
  let out = input;
  if (out.startsWith("~/") || out === "~") {
    const home = process.env.HOME ?? "";
    out = out === "~" ? home : home + out.slice(1);
  }
  out = out.replace(VAR_INLINE_RE, (_match, name: string) => process.env[name] ?? "");
  return out;
}
```

- [ ] **Step 4: Verify pass**

Run: `bun test packages/dalang/tests/config/env-resolver.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/dalang/src/config/env-resolver.ts packages/dalang/tests/config/env-resolver.test.ts
git commit -m "feat(dalang): env var and path resolver"
```

---

### Task 5: Workflow front matter zod schema

**Files:**
- Create: `packages/dalang/src/config/schema.ts`
- Create: `packages/dalang/tests/config/schema.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/dalang/tests/config/schema.test.ts
import { test, expect } from "bun:test";
import { WorkflowFrontMatterSchema, applyDefaults } from "../../src/config/schema";

test("accepts a complete valid front matter", () => {
  const raw = {
    tracker: { kind: "tok-juara", endpoint: "http://localhost:3001", project: null,
      active_states: ["Todo", "In Progress"], terminal_states: ["Done"] },
    polling: { interval_ms: 5000 },
    workspace: { root: "/tmp/dalang" },
    hooks: { timeout_ms: 60000 },
    agent: { max_concurrent_agents: 2, max_turns: 5, max_retry_backoff_ms: 60000,
      max_concurrent_agents_by_state: {} },
    claude: { executable_path: "claude", model: "claude-opus-4-7",
      permission_mode: "auto", turn_timeout_ms: 60000, read_timeout_ms: 5000, stall_timeout_ms: 30000 },
    server: { port: 0 },
  };
  const parsed = WorkflowFrontMatterSchema.parse(raw);
  expect(parsed.tracker.kind).toBe("tok-juara");
});

test("rejects acceptEdits permission_mode in v1", () => {
  const bad = applyDefaults({});
  bad.claude.permission_mode = "acceptEdits";
  expect(() => WorkflowFrontMatterSchema.parse(bad)).toThrow();
});

test("rejects unknown tracker kind", () => {
  const bad = applyDefaults({ tracker: { kind: "linear" } });
  expect(() => WorkflowFrontMatterSchema.parse(bad)).toThrow();
});

test("applyDefaults fills empty input with all defaults", () => {
  const result = applyDefaults({});
  expect(result.polling.interval_ms).toBe(30000);
  expect(result.agent.max_concurrent_agents).toBe(4);
  expect(result.agent.max_turns).toBe(20);
  expect(result.claude.permission_mode).toBe("auto");
  expect(result.claude.model).toBe("claude-opus-4-7");
  expect(result.tracker.active_states).toEqual(["Todo", "In Progress"]);
  expect(result.server.port).toBe(0);
});

test("applyDefaults preserves user-supplied values", () => {
  const result = applyDefaults({ polling: { interval_ms: 1000 } });
  expect(result.polling.interval_ms).toBe(1000);
});

test("rejects negative agent.max_turns", () => {
  const bad = applyDefaults({});
  bad.agent.max_turns = 0;
  expect(() => WorkflowFrontMatterSchema.parse(bad)).toThrow();
});
```

- [ ] **Step 2: Verify fail**

Run: `bun test packages/dalang/tests/config/schema.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/dalang/src/config/schema.ts
import { z } from "zod";

export const TrackerSchema = z.object({
  kind: z.literal("tok-juara"),
  endpoint: z.string().url(),
  api_key: z.string().nullable().optional(),
  board: z.string().nullable().optional(),
  active_states: z.array(z.string()).min(1),
  terminal_states: z.array(z.string()).min(1),
});

export const RepoSchema = z.object({
  url: z.string().min(1),
  default_branch: z.string().min(1),
  branch_prefix: z.string().min(0),
}).optional().nullable();

export const PollingSchema = z.object({
  interval_ms: z.number().int().positive(),
});

export const WorkspaceSchema = z.object({
  root: z.string().min(1),
});

export const HooksSchema = z.object({
  after_create: z.string().nullable().optional(),
  before_run: z.string().nullable().optional(),
  after_run: z.string().nullable().optional(),
  before_remove: z.string().nullable().optional(),
  timeout_ms: z.number().int().positive(),
});

export const AgentSchema = z.object({
  max_concurrent_agents: z.number().int().positive(),
  max_turns: z.number().int().positive(),
  max_retry_backoff_ms: z.number().int().positive(),
  max_concurrent_agents_by_state: z.record(z.string(), z.number().int().positive()),
});

export const ClaudePermissionMode = z.enum(["auto", "default", "plan", "bypassPermissions"]);

export const ClaudeSchema = z.object({
  executable_path: z.string().min(1),
  model: z.string().min(1),
  permission_mode: ClaudePermissionMode,
  turn_timeout_ms: z.number().int().positive(),
  read_timeout_ms: z.number().int().positive(),
  stall_timeout_ms: z.number().int(),
});

export const ServerSchema = z.object({
  port: z.number().int().min(0),
});

export const WorkflowFrontMatterSchema = z.object({
  tracker: TrackerSchema,
  repo: RepoSchema,
  polling: PollingSchema,
  workspace: WorkspaceSchema,
  hooks: HooksSchema,
  agent: AgentSchema,
  claude: ClaudeSchema,
  server: ServerSchema,
});

export type WorkflowFrontMatter = z.infer<typeof WorkflowFrontMatterSchema>;

const DEFAULTS = {
  tracker: {
    kind: "tok-juara",
    endpoint: "http://localhost:3001",
    api_key: null,
    board: null,
    active_states: ["Todo", "In Progress"],
    terminal_states: ["Done", "Cancelled", "Duplicate"],
  },
  repo: null,
  polling: { interval_ms: 30000 },
  workspace: { root: "~/.dalang/workspaces" },
  hooks: {
    after_create: null,
    before_run: null,
    after_run: null,
    before_remove: null,
    timeout_ms: 60000,
  },
  agent: {
    max_concurrent_agents: 4,
    max_turns: 20,
    max_retry_backoff_ms: 300000,
    max_concurrent_agents_by_state: {},
  },
  claude: {
    executable_path: "claude",
    model: "claude-opus-4-7",
    permission_mode: "auto",
    turn_timeout_ms: 3600000,
    read_timeout_ms: 5000,
    stall_timeout_ms: 300000,
  },
  server: { port: 0 },
};

function deepMerge<T>(base: T, override: unknown): T {
  if (override === null || override === undefined) return base;
  if (typeof base !== "object" || base === null || Array.isArray(base)) {
    return override as T;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
    out[k] = deepMerge((base as Record<string, unknown>)[k], v);
  }
  return out as T;
}

export function applyDefaults(raw: unknown): WorkflowFrontMatter {
  const merged = deepMerge(DEFAULTS, raw ?? {}) as WorkflowFrontMatter;
  return merged;
}
```

- [ ] **Step 4: Verify pass**

Run: `bun test packages/dalang/tests/config/schema.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/dalang/src/config/schema.ts packages/dalang/tests/config/schema.test.ts
git commit -m "feat(dalang): workflow front matter schema with defaults"
```

---

### Task 6: Workflow loader (YAML + Liquid body split)

**Files:**
- Create: `packages/dalang/src/config/workflow-loader.ts`
- Create: `packages/dalang/tests/config/workflow-loader.test.ts`
- Create fixtures: `packages/dalang/tests/fixtures/workflow-valid.md`, `workflow-no-frontmatter.md`, `workflow-empty-prompt.md`, `workflow-malformed.md`

- [ ] **Step 1: Create fixture files**

`packages/dalang/tests/fixtures/workflow-valid.md`:
```
---
tracker:
  endpoint: http://localhost:3001
  active_states: [Todo]
  terminal_states: [Done]
workspace:
  root: /tmp/dalang
---
Work on {{ issue.identifier }}.
```

`packages/dalang/tests/fixtures/workflow-no-frontmatter.md`:
```
Just a body, no front matter.
```

`packages/dalang/tests/fixtures/workflow-empty-prompt.md`:
```
---
tracker:
  endpoint: http://localhost:3001
  active_states: [Todo]
  terminal_states: [Done]
---

```

`packages/dalang/tests/fixtures/workflow-malformed.md`:
```
---
this: is: not: yaml: [
---
body
```

- [ ] **Step 2: Write failing test**

```ts
// packages/dalang/tests/config/workflow-loader.test.ts
import { test, expect } from "bun:test";
import { loadWorkflow, WorkflowError } from "../../src/config/workflow-loader";
import { resolve } from "node:path";

const fix = (n: string) => resolve(import.meta.dir, "../fixtures", n);

test("loads valid workflow with front matter and prompt body", async () => {
  const wf = await loadWorkflow(fix("workflow-valid.md"));
  expect(wf.config.tracker.kind).toBe("tok-juara");
  expect(wf.promptTemplate).toContain("Work on");
  expect(wf.mtimeMs).toBeGreaterThan(0);
});

test("rejects file with no front matter (front matter required for typed config)", async () => {
  await expect(loadWorkflow(fix("workflow-no-frontmatter.md"))).rejects.toThrow(WorkflowError);
});

test("rejects file with empty prompt body", async () => {
  await expect(loadWorkflow(fix("workflow-empty-prompt.md"))).rejects.toMatchObject({
    code: "workflow_empty_prompt",
  });
});

test("rejects malformed YAML front matter", async () => {
  await expect(loadWorkflow(fix("workflow-malformed.md"))).rejects.toMatchObject({
    code: "workflow_parse_error",
  });
});

test("rejects missing file", async () => {
  await expect(loadWorkflow(fix("nonexistent.md"))).rejects.toMatchObject({
    code: "missing_workflow_file",
  });
});
```

- [ ] **Step 3: Verify fail**

Run: `bun test packages/dalang/tests/config/workflow-loader.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

```ts
// packages/dalang/src/config/workflow-loader.ts
import { readFile, stat } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { applyDefaults, WorkflowFrontMatterSchema, type WorkflowFrontMatter } from "./schema";

export type WorkflowErrorCode =
  | "missing_workflow_file"
  | "workflow_parse_error"
  | "workflow_front_matter_not_a_map"
  | "workflow_empty_prompt"
  | "workflow_validation_error";

export class WorkflowError extends Error {
  code: WorkflowErrorCode;
  constructor(code: WorkflowErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface LoadedWorkflow {
  config: WorkflowFrontMatter;
  promptTemplate: string;
  mtimeMs: number;
}

const FM_DELIM = /^---\s*$/m;

export async function loadWorkflow(path: string): Promise<LoadedWorkflow> {
  let raw: string;
  let mtimeMs: number;
  try {
    raw = await readFile(path, "utf8");
    const st = await stat(path);
    mtimeMs = st.mtimeMs;
  } catch (err) {
    throw new WorkflowError("missing_workflow_file", `cannot read workflow at ${path}: ${(err as Error).message}`);
  }

  let frontMatterText = "";
  let body = raw;

  const lines = raw.split("\n");
  if (lines[0]?.trim() === "---") {
    let endIdx = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i]!.trim() === "---") {
        endIdx = i;
        break;
      }
    }
    if (endIdx === -1) {
      throw new WorkflowError("workflow_parse_error", "front matter delimiter `---` not closed");
    }
    frontMatterText = lines.slice(1, endIdx).join("\n");
    body = lines.slice(endIdx + 1).join("\n");
  } else {
    throw new WorkflowError("workflow_front_matter_not_a_map", "WORKFLOW.md must start with YAML front matter `---`");
  }

  let parsed: unknown;
  try {
    parsed = frontMatterText.trim().length === 0 ? {} : parseYaml(frontMatterText);
  } catch (err) {
    throw new WorkflowError("workflow_parse_error", `YAML parse failed: ${(err as Error).message}`);
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new WorkflowError("workflow_front_matter_not_a_map", "front matter must decode to a map");
  }

  const merged = applyDefaults(parsed);
  const validation = WorkflowFrontMatterSchema.safeParse(merged);
  if (!validation.success) {
    throw new WorkflowError("workflow_validation_error", `front matter invalid: ${validation.error.message}`);
  }

  const trimmedBody = body.trim();
  if (trimmedBody.length === 0) {
    throw new WorkflowError("workflow_empty_prompt", "prompt body is empty after trimming");
  }

  return { config: validation.data, promptTemplate: trimmedBody, mtimeMs };
}
```

- [ ] **Step 5: Verify pass**

Run: `bun test packages/dalang/tests/config/workflow-loader.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/dalang/src/config/workflow-loader.ts packages/dalang/tests/config/workflow-loader.test.ts packages/dalang/tests/fixtures/
git commit -m "feat(dalang): workflow loader with YAML front matter and prompt body"
```

---

### Task 7: Workflow hot reload + mtime defensive reload

**Files:**
- Create: `packages/dalang/src/config/reload.ts`
- Create: `packages/dalang/tests/config/reload.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/dalang/tests/config/reload.test.ts
import { test, expect } from "bun:test";
import { writeFile, mkdtemp, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkflowReloader } from "../../src/config/reload";

const VALID = `---
tracker:
  endpoint: http://localhost:3001
  active_states: [Todo]
  terminal_states: [Done]
workspace:
  root: /tmp/dalang
---
Hello {{ issue.identifier }}.`;

const VALID_2 = VALID.replace("Hello", "Howdy");

const INVALID = `---
this: is: bad: [
---
body`;

async function makeFile(content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dalang-reload-"));
  const path = join(dir, "WORKFLOW.md");
  await writeFile(path, content, "utf8");
  return path;
}

test("loads initial workflow on start", async () => {
  const path = await makeFile(VALID);
  const reloader = new WorkflowReloader(path);
  await reloader.start();
  const wf = reloader.current();
  expect(wf.promptTemplate).toContain("Hello");
  await reloader.stop();
});

test("invalid reload keeps last-good config", async () => {
  const path = await makeFile(VALID);
  const reloader = new WorkflowReloader(path);
  await reloader.start();
  await writeFile(path, INVALID, "utf8");
  // bump mtime to ensure detection
  const future = Date.now() / 1000 + 5;
  await utimes(path, future, future);
  await reloader.checkMtimeReload();
  expect(reloader.current().promptTemplate).toContain("Hello"); // unchanged
  await reloader.stop();
});

test("valid reload swaps config", async () => {
  const path = await makeFile(VALID);
  const reloader = new WorkflowReloader(path);
  await reloader.start();
  await writeFile(path, VALID_2, "utf8");
  const future = Date.now() / 1000 + 5;
  await utimes(path, future, future);
  await reloader.checkMtimeReload();
  expect(reloader.current().promptTemplate).toContain("Howdy");
  await reloader.stop();
});
```

- [ ] **Step 2: Verify fail**

Run: `bun test packages/dalang/tests/config/reload.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/dalang/src/config/reload.ts
import chokidar, { type FSWatcher } from "chokidar";
import { stat } from "node:fs/promises";
import { loadWorkflow, type LoadedWorkflow, WorkflowError } from "./workflow-loader";

export type ReloadListener = (next: LoadedWorkflow) => void;
export type ReloadErrorListener = (err: WorkflowError) => void;

export class WorkflowReloader {
  private workflow: LoadedWorkflow | null = null;
  private watcher: FSWatcher | null = null;
  private listeners: ReloadListener[] = [];
  private errorListeners: ReloadErrorListener[] = [];

  constructor(private readonly path: string) {}

  current(): LoadedWorkflow {
    if (!this.workflow) throw new Error("WorkflowReloader.start() not called");
    return this.workflow;
  }

  onReload(fn: ReloadListener): void { this.listeners.push(fn); }
  onError(fn: ReloadErrorListener): void { this.errorListeners.push(fn); }

  async start(): Promise<void> {
    this.workflow = await loadWorkflow(this.path);
    this.watcher = chokidar.watch(this.path, { ignoreInitial: true });
    this.watcher.on("change", () => { void this.tryReload(); });
  }

  async checkMtimeReload(): Promise<void> {
    const st = await stat(this.path).catch(() => null);
    if (!st) return;
    if (this.workflow && st.mtimeMs > this.workflow.mtimeMs) {
      await this.tryReload();
    }
  }

  private async tryReload(): Promise<void> {
    try {
      const next = await loadWorkflow(this.path);
      this.workflow = next;
      for (const fn of this.listeners) fn(next);
    } catch (err) {
      const we = err instanceof WorkflowError ? err : new WorkflowError("workflow_validation_error", (err as Error).message);
      for (const fn of this.errorListeners) fn(we);
    }
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }
}
```

- [ ] **Step 4: Verify pass**

Run: `bun test packages/dalang/tests/config/reload.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/dalang/src/config/reload.ts packages/dalang/tests/config/reload.test.ts
git commit -m "feat(dalang): workflow hot reload with mtime defensive check"
```

---

### Task 8: Preflight validation + claude auth probe

**Files:**
- Create: `packages/dalang/src/config/validate.ts`
- Create: `packages/dalang/tests/config/validate.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/dalang/tests/config/validate.test.ts
import { test, expect } from "bun:test";
import { applyDefaults } from "../../src/config/schema";
import { validateForDispatch, ValidationError } from "../../src/config/validate";

const baseConfig = () => applyDefaults({
  tracker: { endpoint: "http://localhost:3001", active_states: ["Todo"], terminal_states: ["Done"] },
  workspace: { root: "/tmp/dalang" },
});

test("accepts a complete valid config", () => {
  const cfg = baseConfig();
  cfg.tracker.api_key = null;
  expect(() => validateForDispatch(cfg)).not.toThrow();
});

test("rejects when $VAR api_key is unresolved", () => {
  const cfg = baseConfig();
  cfg.tracker.api_key = "$NEVER_DEFINED_KEY_XYZ";
  delete process.env.NEVER_DEFINED_KEY_XYZ;
  expect(() => validateForDispatch(cfg)).toThrow(ValidationError);
});

test("accepts when $VAR api_key resolves", () => {
  const cfg = baseConfig();
  cfg.tracker.api_key = "$EXISTS_KEY_XYZ";
  process.env.EXISTS_KEY_XYZ = "abc";
  expect(() => validateForDispatch(cfg)).not.toThrow();
  delete process.env.EXISTS_KEY_XYZ;
});

test("rejects empty claude.executable_path", () => {
  const cfg = baseConfig();
  cfg.claude.executable_path = "";
  expect(() => validateForDispatch(cfg)).toThrow(/executable_path/);
});
```

- [ ] **Step 2: Verify fail**

Run: `bun test packages/dalang/tests/config/validate.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/dalang/src/config/validate.ts
import type { WorkflowFrontMatter } from "./schema";
import { resolveEnvValue } from "./env-resolver";

export type ValidationCode =
  | "unsupported_tracker_kind"
  | "missing_tracker_api_key"
  | "missing_claude_executable_path"
  | "missing_repo_config"
  | "claude_auth_inactive";

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
  if (!cfg.claude.executable_path || cfg.claude.executable_path.trim().length === 0) {
    throw new ValidationError("missing_claude_executable_path", "claude.executable_path is required");
  }
}

/** Probes `claude` CLI subscription status. Resolves `null` on success, error message on failure. */
export async function probeClaudeAuth(executablePath: string): Promise<string | null> {
  const proc = Bun.spawn([executablePath, "--version"], { stdout: "pipe", stderr: "pipe" });
  const exitCode = await proc.exited;
  if (exitCode === 0) return null;
  return `claude probe exited with code ${exitCode}`;
}
```

- [ ] **Step 4: Verify pass**

Run: `bun test packages/dalang/tests/config/validate.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/dalang/src/config/validate.ts packages/dalang/tests/config/validate.test.ts
git commit -m "feat(dalang): preflight validation and claude auth probe"
```

---

### Task 9: Prompt builder (Liquid strict + metadata injection)

**Files:**
- Create: `packages/dalang/src/agent/prompt-builder.ts`
- Create: `packages/dalang/tests/agent/prompt-builder.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/dalang/tests/agent/prompt-builder.test.ts
import { test, expect } from "bun:test";
import { buildFirstTurnPrompt, buildContinuationPrompt } from "../../src/agent/prompt-builder";
import type { NormalizedIssue } from "../../src/types";

const issue: NormalizedIssue = {
  id: "i_1", identifier: "JUARA-1", title: "Fix bug", description: "details",
  priority: 1, state: "Todo", branch_name: null, url: null,
  labels: ["bug", "p1"], blocked_by: [],
  created_at: null, updated_at: null,
};

test("first turn prepends issue metadata header", async () => {
  const out = await buildFirstTurnPrompt("Body for {{ issue.identifier }}", issue, null);
  expect(out).toContain("# Working on JUARA-1: Fix bug");
  expect(out).toContain("Body for JUARA-1");
});

test("first turn renders attempt variable", async () => {
  const out = await buildFirstTurnPrompt("Attempt: {{ attempt }}", issue, 3);
  expect(out).toContain("Attempt: 3");
});

test("first turn fails on unknown variable", async () => {
  await expect(buildFirstTurnPrompt("{{ unknown_var }}", issue, null)).rejects.toThrow();
});

test("first turn fails on unknown filter", async () => {
  await expect(buildFirstTurnPrompt("{{ issue.title | bogus_filter }}", issue, null)).rejects.toThrow();
});

test("first turn iterates labels", async () => {
  const tpl = "{% for l in issue.labels %}[{{ l }}]{% endfor %}";
  const out = await buildFirstTurnPrompt(tpl, issue, null);
  expect(out).toContain("[bug][p1]");
});

test("continuation prompt mentions identifier and turn number, omits original prompt", async () => {
  const out = buildContinuationPrompt(issue, 2, 20);
  expect(out).toContain("JUARA-1");
  expect(out).toContain("turn 2");
  expect(out).not.toContain("Body for");
});
```

- [ ] **Step 2: Verify fail**

Run: `bun test packages/dalang/tests/agent/prompt-builder.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/dalang/src/agent/prompt-builder.ts
import { Liquid } from "liquidjs";
import type { NormalizedIssue } from "../types";

const liquid = new Liquid({ strictVariables: true, strictFilters: true });

const HEADER = (i: NormalizedIssue) => `# Working on ${i.identifier}: ${i.title}\n\n`;

export async function buildFirstTurnPrompt(
  template: string,
  issue: NormalizedIssue,
  attempt: number | null,
): Promise<string> {
  const rendered = await liquid.parseAndRender(template, { issue, attempt });
  return HEADER(issue) + rendered;
}

export function buildContinuationPrompt(
  issue: NormalizedIssue,
  turnNumber: number,
  maxTurns: number,
): string {
  return [
    `Continuing work on ${issue.identifier} (turn ${turnNumber} of up to ${maxTurns}).`,
    `Re-check the current state of the workspace and pick up where the last turn left off.`,
    `If the work is complete, finalize and stop.`,
  ].join("\n");
}
```

- [ ] **Step 4: Verify pass**

Run: `bun test packages/dalang/tests/agent/prompt-builder.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```ts
git add packages/dalang/src/agent/prompt-builder.ts packages/dalang/tests/agent/prompt-builder.test.ts
git commit -m "feat(dalang): liquid prompt builder with metadata header"
```

---

## Phase C — Tracker (Tasks 10–12)

### Task 10: Tracker adapter interface

**Files:**
- Create: `packages/dalang/src/tracker/adapter.ts`

- [ ] **Step 1: Define interface (no test; pure type)**

```ts
// packages/dalang/src/tracker/adapter.ts
import type { NormalizedIssue } from "../types";

export interface TrackerAdapter {
  fetchCandidateIssues(activeStates: string[]): Promise<NormalizedIssue[]>;
  fetchIssuesByStates(states: string[]): Promise<NormalizedIssue[]>;
  fetchIssueStatesByIds(ids: string[]): Promise<NormalizedIssue[]>;
  fetchIssue(id: string): Promise<NormalizedIssue | null>;
}

export type TrackerErrorCode =
  | "tracker_request_error"
  | "tracker_status_error"
  | "tracker_malformed_payload"
  | "tracker_missing_pagination_cursor";

export class TrackerError extends Error {
  code: TrackerErrorCode;
  constructor(code: TrackerErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/dalang/src/tracker/adapter.ts
git commit -m "feat(dalang): tracker adapter interface"
```

---

### Task 11: Defensive normalization

**Files:**
- Create: `packages/dalang/src/tracker/normalize.ts`
- Create: `packages/dalang/tests/tracker/normalize.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/dalang/tests/tracker/normalize.test.ts
import { test, expect } from "bun:test";
import { normalizeIssue } from "../../src/tracker/normalize";

test("passes through a clean issue", () => {
  const out = normalizeIssue({
    id: "i1", identifier: "JUARA-1", title: "t", description: "d",
    priority: 2, state: "Todo", branch_name: null, url: null,
    labels: ["BUG", "p1"], blocked_by: [],
    created_at: "2026-04-29T00:00:00Z", updated_at: null,
  });
  expect(out).not.toBeNull();
  expect(out!.labels).toEqual(["bug", "p1"]);
});

test("priority non-integer becomes null", () => {
  const out = normalizeIssue({
    id: "i1", identifier: "X-1", title: "t", state: "Todo",
    priority: 2.5, labels: [], blocked_by: [],
  });
  expect(out!.priority).toBeNull();
});

test("priority non-numeric becomes null", () => {
  const out = normalizeIssue({
    id: "i1", identifier: "X-1", title: "t", state: "Todo",
    priority: "high", labels: [], blocked_by: [],
  });
  expect(out!.priority).toBeNull();
});

test("non-string labels are dropped, strings lowercased", () => {
  const out = normalizeIssue({
    id: "i1", identifier: "X-1", title: "t", state: "Todo",
    labels: ["FOO", 42, null, "Bar"], blocked_by: [],
  });
  expect(out!.labels).toEqual(["foo", "bar"]);
});

test("blocker without id and identifier is dropped", () => {
  const out = normalizeIssue({
    id: "i1", identifier: "X-1", title: "t", state: "Todo",
    labels: [],
    blocked_by: [
      { id: null, identifier: null, state: "Done" },
      { id: "i2", identifier: null, state: "Todo" },
    ],
  });
  expect(out!.blocked_by).toHaveLength(1);
  expect(out!.blocked_by[0]?.id).toBe("i2");
});

test("missing required field returns null", () => {
  const out = normalizeIssue({ identifier: "X-1", title: "t", state: "Todo" });
  expect(out).toBeNull();
});

test("unparseable timestamps become null", () => {
  const out = normalizeIssue({
    id: "i1", identifier: "X-1", title: "t", state: "Todo",
    labels: [], blocked_by: [],
    created_at: "not-a-date",
  });
  expect(out!.created_at).toBeNull();
});
```

- [ ] **Step 2: Verify fail**

Run: `bun test packages/dalang/tests/tracker/normalize.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/dalang/src/tracker/normalize.ts
import type { BlockerRef, NormalizedIssue } from "../types";

function isString(v: unknown): v is string { return typeof v === "string"; }

function coerceLabels(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.filter(isString).map((s) => s.toLowerCase());
}

function coercePriority(input: unknown): number | null {
  if (typeof input !== "number") return null;
  if (!Number.isInteger(input)) return null;
  return input;
}

function coerceTimestamp(input: unknown): string | null {
  if (!isString(input)) return null;
  const t = Date.parse(input);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString();
}

function coerceBlockers(input: unknown): BlockerRef[] {
  if (!Array.isArray(input)) return [];
  const out: BlockerRef[] = [];
  for (const raw of input) {
    if (raw === null || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const id = isString(r.id) ? r.id : null;
    const identifier = isString(r.identifier) ? r.identifier : null;
    const state = isString(r.state) ? r.state : null;
    if (id === null && identifier === null) continue;
    out.push({ id, identifier, state });
  }
  return out;
}

/** Returns null if the issue is malformed (caller logs `tracker_malformed_payload`). */
export function normalizeIssue(raw: unknown): NormalizedIssue | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = isString(r.id) ? r.id : null;
  const identifier = isString(r.identifier) ? r.identifier : null;
  const title = isString(r.title) ? r.title : null;
  const state = isString(r.state) ? r.state : null;
  if (!id || !identifier || !title || !state) return null;
  return {
    id,
    identifier,
    title,
    description: isString(r.description) ? r.description : null,
    priority: coercePriority(r.priority),
    state,
    branch_name: isString(r.branch_name) ? r.branch_name : null,
    url: isString(r.url) ? r.url : null,
    labels: coerceLabels(r.labels),
    blocked_by: coerceBlockers(r.blocked_by),
    created_at: coerceTimestamp(r.created_at),
    updated_at: coerceTimestamp(r.updated_at),
  };
}
```

- [ ] **Step 4: Verify pass**

Run: `bun test packages/dalang/tests/tracker/normalize.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/dalang/src/tracker/normalize.ts packages/dalang/tests/tracker/normalize.test.ts
git commit -m "feat(dalang): defensive issue normalization"
```

---

### Task 12: REST adapter (wayang client)

**Files:**
- Create: `packages/dalang/src/tracker/rest-adapter.ts`
- Create: `packages/dalang/tests/tracker/rest-adapter.test.ts`

- [ ] **Step 1: Write failing test (uses Bun.serve as a fake wayang)**

```ts
// packages/dalang/tests/tracker/rest-adapter.test.ts
import { test, expect, beforeEach, afterEach } from "bun:test";
import { RestTrackerAdapter } from "../../src/tracker/rest-adapter";

let server: ReturnType<typeof Bun.serve> | null = null;
let lastRequest: { method: string; url: string; auth: string | null } | null = null;
let nextResponse: { status: number; body: unknown } = { status: 200, body: { issues: [], next_cursor: null } };

beforeEach(() => {
  server = Bun.serve({
    port: 0,
    fetch: (req) => {
      lastRequest = { method: req.method, url: new URL(req.url).pathname + new URL(req.url).search,
        auth: req.headers.get("authorization") };
      return new Response(JSON.stringify(nextResponse.body), {
        status: nextResponse.status,
        headers: { "content-type": "application/json" },
      });
    },
  });
});

afterEach(() => { server?.stop(); server = null; lastRequest = null; });

const baseURL = () => `http://localhost:${server!.port}`;

test("fetchCandidateIssues encodes states and paginates", async () => {
  nextResponse = { status: 200, body: {
    issues: [
      { id: "i1", identifier: "X-1", title: "t1", state: "Todo", labels: [], blocked_by: [] },
    ],
    next_cursor: null,
  }};
  const adapter = new RestTrackerAdapter({ endpoint: baseURL(), apiKey: null });
  const issues = await adapter.fetchCandidateIssues(["Todo", "In Progress"]);
  expect(issues).toHaveLength(1);
  expect(lastRequest!.url).toContain("state=Todo");
  expect(lastRequest!.url).toContain("state=In+Progress");
});

test("sends Authorization header when api_key is set", async () => {
  nextResponse = { status: 200, body: { issues: [], next_cursor: null } };
  const adapter = new RestTrackerAdapter({ endpoint: baseURL(), apiKey: "secret-1" });
  await adapter.fetchCandidateIssues(["Todo"]);
  expect(lastRequest!.auth).toBe("Bearer secret-1");
});

test("fetchIssuesByStates short-circuits on empty array (no HTTP call)", async () => {
  const adapter = new RestTrackerAdapter({ endpoint: baseURL(), apiKey: null });
  lastRequest = null;
  const out = await adapter.fetchIssuesByStates([]);
  expect(out).toEqual([]);
  expect(lastRequest).toBeNull();
});

test("fetchIssueStatesByIds builds correct URL", async () => {
  nextResponse = { status: 200, body: { issues: [] } };
  const adapter = new RestTrackerAdapter({ endpoint: baseURL(), apiKey: null });
  await adapter.fetchIssueStatesByIds(["i1", "i2"]);
  expect(lastRequest!.url).toContain("/api/v1/issues/by-ids?id=i1&id=i2");
});

test("non-200 throws TrackerError tracker_status_error", async () => {
  nextResponse = { status: 500, body: { error: "boom" } };
  const adapter = new RestTrackerAdapter({ endpoint: baseURL(), apiKey: null });
  await expect(adapter.fetchCandidateIssues(["Todo"])).rejects.toMatchObject({
    code: "tracker_status_error",
  });
});

test("malformed payload throws tracker_malformed_payload", async () => {
  nextResponse = { status: 200, body: { not_issues: [] } };
  const adapter = new RestTrackerAdapter({ endpoint: baseURL(), apiKey: null });
  await expect(adapter.fetchCandidateIssues(["Todo"])).rejects.toMatchObject({
    code: "tracker_malformed_payload",
  });
});

test("paginates across multiple pages preserving order", async () => {
  let call = 0;
  server!.stop();
  server = Bun.serve({
    port: 0,
    fetch: () => {
      call += 1;
      if (call === 1) return new Response(JSON.stringify({
        issues: [{ id: "i1", identifier: "X-1", title: "t", state: "Todo", labels: [], blocked_by: [] }],
        next_cursor: "cur2",
      }));
      return new Response(JSON.stringify({
        issues: [{ id: "i2", identifier: "X-2", title: "t", state: "Todo", labels: [], blocked_by: [] }],
        next_cursor: null,
      }));
    },
  });
  const adapter = new RestTrackerAdapter({ endpoint: `http://localhost:${server.port}`, apiKey: null });
  const out = await adapter.fetchCandidateIssues(["Todo"]);
  expect(out.map((i) => i.id)).toEqual(["i1", "i2"]);
});
```

- [ ] **Step 2: Verify fail**

Run: `bun test packages/dalang/tests/tracker/rest-adapter.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/dalang/src/tracker/rest-adapter.ts
import type { NormalizedIssue } from "../types";
import type { TrackerAdapter } from "./adapter";
import { TrackerError } from "./adapter";
import { normalizeIssue } from "./normalize";

export interface RestAdapterConfig {
  endpoint: string;
  apiKey: string | null;
  timeoutMs?: number;
}

interface IssuesPage {
  issues: unknown[];
  next_cursor: string | null;
}

export class RestTrackerAdapter implements TrackerAdapter {
  private readonly endpoint: string;
  private readonly apiKey: string | null;
  private readonly timeoutMs: number;

  constructor(cfg: RestAdapterConfig) {
    this.endpoint = cfg.endpoint.replace(/\/$/, "");
    this.apiKey = cfg.apiKey;
    this.timeoutMs = cfg.timeoutMs ?? 30000;
  }

  private headers(): HeadersInit {
    const h: Record<string, string> = { "accept": "application/json" };
    if (this.apiKey) h["authorization"] = `Bearer ${this.apiKey}`;
    return h;
  }

  private async getJson(path: string): Promise<unknown> {
    const url = `${this.endpoint}${path}`;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, { headers: this.headers(), signal: controller.signal });
    } catch (err) {
      throw new TrackerError("tracker_request_error", `${url}: ${(err as Error).message}`);
    } finally {
      clearTimeout(t);
    }
    if (!res.ok) {
      throw new TrackerError("tracker_status_error", `${url}: HTTP ${res.status}`);
    }
    try {
      return await res.json();
    } catch (err) {
      throw new TrackerError("tracker_malformed_payload", `${url}: ${(err as Error).message}`);
    }
  }

  private async fetchPaginated(stateParams: string[]): Promise<NormalizedIssue[]> {
    const out: NormalizedIssue[] = [];
    let cursor: string | null = null;
    do {
      const params = new URLSearchParams();
      for (const s of stateParams) params.append("state", s);
      if (cursor) params.append("cursor", cursor);
      const body = await this.getJson(`/api/v1/issues?${params.toString()}`);
      const page = this.assertPage(body);
      for (const raw of page.issues) {
        const norm = normalizeIssue(raw);
        if (norm) out.push(norm);
      }
      cursor = page.next_cursor;
    } while (cursor);
    return out;
  }

  private assertPage(body: unknown): IssuesPage {
    if (
      body === null ||
      typeof body !== "object" ||
      !Array.isArray((body as { issues?: unknown }).issues)
    ) {
      throw new TrackerError("tracker_malformed_payload", "expected { issues: [], next_cursor }");
    }
    const next = (body as { next_cursor?: unknown }).next_cursor;
    return {
      issues: (body as { issues: unknown[] }).issues,
      next_cursor: typeof next === "string" ? next : null,
    };
  }

  async fetchCandidateIssues(activeStates: string[]): Promise<NormalizedIssue[]> {
    return this.fetchPaginated(activeStates);
  }

  async fetchIssuesByStates(states: string[]): Promise<NormalizedIssue[]> {
    if (states.length === 0) return [];
    return this.fetchPaginated(states);
  }

  async fetchIssueStatesByIds(ids: string[]): Promise<NormalizedIssue[]> {
    if (ids.length === 0) return [];
    const params = new URLSearchParams();
    for (const id of ids) params.append("id", id);
    const body = await this.getJson(`/api/v1/issues/by-ids?${params.toString()}`);
    if (
      body === null ||
      typeof body !== "object" ||
      !Array.isArray((body as { issues?: unknown }).issues)
    ) {
      throw new TrackerError("tracker_malformed_payload", "by-ids: expected { issues: [] }");
    }
    const out: NormalizedIssue[] = [];
    for (const raw of (body as { issues: unknown[] }).issues) {
      const n = normalizeIssue(raw);
      if (n) out.push(n);
    }
    return out;
  }

  async fetchIssue(id: string): Promise<NormalizedIssue | null> {
    const body = await this.getJson(`/api/v1/issues/${encodeURIComponent(id)}`);
    return normalizeIssue(body);
  }
}
```

- [ ] **Step 4: Verify pass**

Run: `bun test packages/dalang/tests/tracker/rest-adapter.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/dalang/src/tracker/rest-adapter.ts packages/dalang/tests/tracker/rest-adapter.test.ts
git commit -m "feat(dalang): REST tracker adapter for wayang"
```

---

## Phase D — Workspace (Tasks 13–15)

### Task 13: Hook executor

**Files:**
- Create: `packages/dalang/src/workspace/hooks.ts`
- Create: `packages/dalang/tests/workspace/hooks.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/dalang/tests/workspace/hooks.test.ts
import { test, expect } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHook } from "../../src/workspace/hooks";

async function tmp(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "dalang-hooks-"));
}

test("runs script with workspace as cwd and exposes env", async () => {
  const cwd = await tmp();
  const result = await runHook({
    name: "after_create",
    script: 'echo "$ISSUE_IDENTIFIER" > out.txt && pwd > pwd.txt',
    cwd,
    env: { ISSUE_IDENTIFIER: "JUARA-1" },
    timeoutMs: 5000,
  });
  expect(result.ok).toBe(true);
  expect((await readFile(join(cwd, "out.txt"), "utf8")).trim()).toBe("JUARA-1");
  expect((await readFile(join(cwd, "pwd.txt"), "utf8")).trim()).toBe(cwd);
});

test("returns ok=false on non-zero exit", async () => {
  const cwd = await tmp();
  const result = await runHook({
    name: "before_run", script: "exit 17", cwd, env: {}, timeoutMs: 5000,
  });
  expect(result.ok).toBe(false);
  expect(result.exitCode).toBe(17);
});

test("returns timeout=true after timeoutMs", async () => {
  const cwd = await tmp();
  const result = await runHook({
    name: "after_create", script: "sleep 5", cwd, env: {}, timeoutMs: 200,
  });
  expect(result.ok).toBe(false);
  expect(result.timedOut).toBe(true);
});

test("returns null result for null/empty script", async () => {
  const cwd = await tmp();
  expect(await runHook({ name: "after_run", script: null, cwd, env: {}, timeoutMs: 1000 }))
    .toEqual({ ok: true, skipped: true });
  expect(await runHook({ name: "after_run", script: "", cwd, env: {}, timeoutMs: 1000 }))
    .toEqual({ ok: true, skipped: true });
});
```

- [ ] **Step 2: Verify fail**

Run: `bun test packages/dalang/tests/workspace/hooks.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/dalang/src/workspace/hooks.ts
export interface RunHookOptions {
  name: string;
  script: string | null | undefined;
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
}

export interface HookResult {
  ok: boolean;
  skipped?: boolean;
  exitCode?: number;
  timedOut?: boolean;
  stdout?: string;
  stderr?: string;
}

export async function runHook(opts: RunHookOptions): Promise<HookResult> {
  if (!opts.script || opts.script.trim().length === 0) return { ok: true, skipped: true };

  const proc = Bun.spawn(["bash", "-lc", opts.script], {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; proc.kill(); }, opts.timeoutMs);

  const exitCode = await proc.exited;
  clearTimeout(timer);

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  if (timedOut) return { ok: false, timedOut: true, stdout, stderr };
  if (exitCode !== 0) return { ok: false, exitCode, stdout, stderr };
  return { ok: true, exitCode: 0, stdout, stderr };
}

export function truncateLogged(output: string, max: number = 2000): string {
  if (output.length <= max) return output;
  return output.slice(0, max) + `\n... [truncated ${output.length - max} bytes]`;
}
```

- [ ] **Step 4: Verify pass**

Run: `bun test packages/dalang/tests/workspace/hooks.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/dalang/src/workspace/hooks.ts packages/dalang/tests/workspace/hooks.test.ts
git commit -m "feat(dalang): bash hook executor with timeout and env"
```

---

### Task 14: Workspace manager (no-repo path)

**Files:**
- Create: `packages/dalang/src/workspace/workspace-manager.ts`
- Create: `packages/dalang/tests/workspace/workspace-manager.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/dalang/tests/workspace/workspace-manager.test.ts
import { test, expect } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceManager } from "../../src/workspace/workspace-manager";

async function tmpRoot(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "dalang-ws-"));
}

test("ensures sanitized directory exists with created_now=true on first call", async () => {
  const root = await tmpRoot();
  const wm = new WorkspaceManager({ root });
  const ws = await wm.ensureWorkspace("JUARA/1");
  expect(ws.workspace_key).toBe("JUARA_1");
  expect(ws.path).toBe(join(root, "JUARA_1"));
  expect(ws.created_now).toBe(true);
  expect(existsSync(ws.path)).toBe(true);
});

test("reuses existing dir with created_now=false", async () => {
  const root = await tmpRoot();
  await mkdir(join(root, "JUARA-1"), { recursive: true });
  const wm = new WorkspaceManager({ root });
  const ws = await wm.ensureWorkspace("JUARA-1");
  expect(ws.created_now).toBe(false);
});

test("rejects when path collides with an existing non-directory", async () => {
  const root = await tmpRoot();
  await writeFile(join(root, "JUARA-2"), "x");
  const wm = new WorkspaceManager({ root });
  await expect(wm.ensureWorkspace("JUARA-2")).rejects.toMatchObject({ code: "workspace_create_error" });
});

test("rejects path traversal attempt outside root", async () => {
  const root = await tmpRoot();
  const wm = new WorkspaceManager({ root });
  // Identifier "..something" sanitizes to "__something" (no traversal possible),
  // but explicit sanity check: path is always under root.
  const ws = await wm.ensureWorkspace("../escape");
  expect(ws.path.startsWith(root)).toBe(true);
});
```

- [ ] **Step 2: Verify fail**

Run: `bun test packages/dalang/tests/workspace/workspace-manager.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/dalang/src/workspace/workspace-manager.ts
import { mkdir, stat, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join, sep } from "node:path";
import { sanitizeWorkspaceKey } from "./sanitize";
import type { WorkspaceMeta } from "../types";

export type WorkspaceErrorCode =
  | "workspace_create_error"
  | "workspace_path_outside_root"
  | "workspace_collision";

export class WorkspaceError extends Error {
  code: WorkspaceErrorCode;
  constructor(code: WorkspaceErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface WorkspaceManagerOptions {
  root: string;
}

export class WorkspaceManager {
  private readonly root: string;

  constructor(opts: WorkspaceManagerOptions) {
    this.root = resolve(opts.root);
  }

  rootPath(): string { return this.root; }

  pathFor(identifier: string): string {
    const key = sanitizeWorkspaceKey(identifier);
    const path = resolve(this.root, key);
    if (path !== this.root && !path.startsWith(this.root + sep)) {
      throw new WorkspaceError("workspace_path_outside_root", `${path} is not under ${this.root}`);
    }
    return path;
  }

  async ensureWorkspace(identifier: string): Promise<WorkspaceMeta> {
    const key = sanitizeWorkspaceKey(identifier);
    const path = this.pathFor(identifier);
    let createdNow = false;

    if (existsSync(path)) {
      const st = await stat(path);
      if (!st.isDirectory()) {
        throw new WorkspaceError("workspace_create_error", `${path} exists and is not a directory`);
      }
    } else {
      await mkdir(this.root, { recursive: true });
      await mkdir(path, { recursive: false });
      createdNow = true;
    }

    return { path, workspace_key: key, created_now: createdNow };
  }

  async removeWorkspace(identifier: string): Promise<void> {
    const path = this.pathFor(identifier);
    if (!existsSync(path)) return;
    await rm(path, { recursive: true, force: true });
  }

  async assertCwdIsWorkspace(identifier: string, cwd: string): Promise<void> {
    const expected = this.pathFor(identifier);
    if (resolve(cwd) !== expected) {
      throw new WorkspaceError("workspace_path_outside_root",
        `expected cwd ${expected}, got ${cwd}`);
    }
  }
}
```

- [ ] **Step 4: Verify pass**

Run: `bun test packages/dalang/tests/workspace/workspace-manager.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/dalang/src/workspace/workspace-manager.ts packages/dalang/tests/workspace/workspace-manager.test.ts
git commit -m "feat(dalang): workspace manager (no-repo path)"
```

---

### Task 15: Git worktree extension

**Files:**
- Create: `packages/dalang/src/workspace/git-worktree.ts`
- Create: `packages/dalang/tests/workspace/git-worktree.test.ts`

These tests use a real local source repo created in tmp; no network.

- [ ] **Step 1: Write failing test**

```ts
// packages/dalang/tests/workspace/git-worktree.test.ts
import { test, expect } from "bun:test";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitWorktreeManager } from "../../src/workspace/git-worktree";

async function setupSourceRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dalang-src-"));
  const run = async (...args: string[]) => {
    const p = Bun.spawn(args, { cwd: dir });
    const code = await p.exited;
    if (code !== 0) throw new Error(`cmd failed: ${args.join(" ")}`);
  };
  await run("git", "init", "-b", "main", ".");
  await run("git", "config", "user.email", "a@b.c");
  await run("git", "config", "user.name", "Tester");
  await writeFile(join(dir, "README.md"), "hello");
  await run("git", "add", ".");
  await run("git", "commit", "-m", "init");
  return dir;
}

async function tmpRoot(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "dalang-wt-"));
}

test("first worktree creates branch from default and adds worktree", async () => {
  const src = await setupSourceRepo();
  const root = await tmpRoot();
  const m = new GitWorktreeManager({ workspaceRoot: root, repoUrl: src, defaultBranch: "main", branchPrefix: "juara/" });
  await m.ensureSharedClone();
  const wsPath = join(root, "JUARA-1");
  await mkdir(root, { recursive: true });
  await m.ensureWorktree(wsPath, "juara/JUARA-1");
  expect(existsSync(join(wsPath, "README.md"))).toBe(true);
});

test("reusing worktree path is a no-op (preserves branch)", async () => {
  const src = await setupSourceRepo();
  const root = await tmpRoot();
  const m = new GitWorktreeManager({ workspaceRoot: root, repoUrl: src, defaultBranch: "main", branchPrefix: "juara/" });
  await m.ensureSharedClone();
  const wsPath = join(root, "JUARA-2");
  await m.ensureWorktree(wsPath, "juara/JUARA-2");
  await writeFile(join(wsPath, "wip.txt"), "wip");
  await m.ensureWorktree(wsPath, "juara/JUARA-2"); // reuse
  expect(existsSync(join(wsPath, "wip.txt"))).toBe(true);
});

test("removeWorktree cleans dir but leaves branch", async () => {
  const src = await setupSourceRepo();
  const root = await tmpRoot();
  const m = new GitWorktreeManager({ workspaceRoot: root, repoUrl: src, defaultBranch: "main", branchPrefix: "juara/" });
  await m.ensureSharedClone();
  const wsPath = join(root, "JUARA-3");
  await m.ensureWorktree(wsPath, "juara/JUARA-3");
  await m.removeWorktree(wsPath);
  expect(existsSync(wsPath)).toBe(false);
});
```

- [ ] **Step 2: Verify fail**

Run: `bun test packages/dalang/tests/workspace/git-worktree.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/dalang/src/workspace/git-worktree.ts
import { existsSync } from "node:fs";
import { rm, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

export interface GitWorktreeOptions {
  workspaceRoot: string;
  repoUrl: string;
  defaultBranch: string;
  branchPrefix: string;
}

export class GitWorktreeError extends Error {}

async function git(cwd: string, args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string; exitCode: number }> {
  const p = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const exitCode = await p.exited;
  return {
    ok: exitCode === 0,
    stdout: await new Response(p.stdout).text(),
    stderr: await new Response(p.stderr).text(),
    exitCode,
  };
}

export class GitWorktreeManager {
  private readonly opts: GitWorktreeOptions;
  private readonly sharedClonePath: string;

  constructor(opts: GitWorktreeOptions) {
    this.opts = opts;
    this.sharedClonePath = join(resolve(opts.workspaceRoot), ".repo.git");
  }

  branchName(sanitizedKey: string): string {
    return `${this.opts.branchPrefix}${sanitizedKey}`;
  }

  sharedPath(): string { return this.sharedClonePath; }

  async ensureSharedClone(): Promise<void> {
    if (existsSync(this.sharedClonePath)) return;
    await mkdir(this.opts.workspaceRoot, { recursive: true });
    const r = await git(this.opts.workspaceRoot, ["clone", "--bare", this.opts.repoUrl, ".repo.git"]);
    if (!r.ok) throw new GitWorktreeError(`clone failed: ${r.stderr}`);
  }

  async ensureWorktree(workspacePath: string, branch: string): Promise<void> {
    await this.ensureSharedClone();
    if (existsSync(workspacePath)) return;
    const fetch = await git(this.sharedClonePath, ["fetch", "origin"]);
    if (!fetch.ok) throw new GitWorktreeError(`fetch failed: ${fetch.stderr}`);

    const branchExists = await git(this.sharedClonePath, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
    if (branchExists.ok) {
      const r = await git(this.sharedClonePath, ["worktree", "add", workspacePath, branch]);
      if (!r.ok) throw new GitWorktreeError(`worktree add (existing branch) failed: ${r.stderr}`);
    } else {
      const r = await git(this.sharedClonePath, ["worktree", "add", workspacePath, "-b", branch, `origin/${this.opts.defaultBranch}`]);
      if (!r.ok) throw new GitWorktreeError(`worktree add (new branch) failed: ${r.stderr}`);
    }
  }

  async removeWorktree(workspacePath: string): Promise<void> {
    if (!existsSync(this.sharedClonePath) || !existsSync(workspacePath)) {
      if (existsSync(workspacePath)) await rm(workspacePath, { recursive: true, force: true });
      return;
    }
    await git(this.sharedClonePath, ["worktree", "remove", "--force", workspacePath]);
    if (existsSync(workspacePath)) await rm(workspacePath, { recursive: true, force: true });
  }
}
```

- [ ] **Step 4: Verify pass**

Run: `bun test packages/dalang/tests/workspace/git-worktree.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/dalang/src/workspace/git-worktree.ts packages/dalang/tests/workspace/git-worktree.test.ts
git commit -m "feat(dalang): git worktree extension"
```

---

## Phase E — Orchestrator core (Tasks 16–19)

### Task 16: Initial state factory + helpers

**Files:**
- Create: `packages/dalang/src/orchestrator/state.ts`
- Create: `packages/dalang/tests/orchestrator/state.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/dalang/tests/orchestrator/state.test.ts
import { test, expect } from "bun:test";
import { createInitialState, addRunning, removeRunning, accumulateTokens } from "../../src/orchestrator/state";
import type { NormalizedIssue, RunningEntry } from "../../src/types";

const issue: NormalizedIssue = {
  id: "i1", identifier: "X-1", title: "t", description: null, priority: null,
  state: "Todo", branch_name: null, url: null, labels: [], blocked_by: [],
  created_at: null, updated_at: null,
};

test("creates initial state with defaults", () => {
  const s = createInitialState({ poll_interval_ms: 30000, max_concurrent_agents: 4 });
  expect(s.running.size).toBe(0);
  expect(s.claude_totals.total_tokens).toBe(0);
});

test("addRunning sets entry and adds to claimed", () => {
  const s = createInitialState({ poll_interval_ms: 30000, max_concurrent_agents: 4 });
  const entry: RunningEntry = {
    issue, identifier: "X-1", workspace_path: "/tmp/X-1",
    started_at: new Date().toISOString(),
    abort_controller: new AbortController(),
    retry_attempt: null, session: null,
  };
  addRunning(s, "i1", entry);
  expect(s.running.has("i1")).toBe(true);
  expect(s.claimed.has("i1")).toBe(true);
});

test("removeRunning unsets entry and clears claim", () => {
  const s = createInitialState({ poll_interval_ms: 30000, max_concurrent_agents: 4 });
  const entry: RunningEntry = {
    issue, identifier: "X-1", workspace_path: "/tmp/X-1",
    started_at: new Date().toISOString(),
    abort_controller: new AbortController(),
    retry_attempt: null, session: null,
  };
  addRunning(s, "i1", entry);
  removeRunning(s, "i1");
  expect(s.running.has("i1")).toBe(false);
  expect(s.claimed.has("i1")).toBe(false);
});

test("accumulateTokens adds to totals", () => {
  const s = createInitialState({ poll_interval_ms: 30000, max_concurrent_agents: 4 });
  accumulateTokens(s, { input_tokens: 100, output_tokens: 50, total_tokens: 150 });
  accumulateTokens(s, { input_tokens: 10, output_tokens: 5, total_tokens: 15 });
  expect(s.claude_totals.input_tokens).toBe(110);
  expect(s.claude_totals.output_tokens).toBe(55);
  expect(s.claude_totals.total_tokens).toBe(165);
});
```

- [ ] **Step 2: Verify fail**

Run: `bun test packages/dalang/tests/orchestrator/state.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/dalang/src/orchestrator/state.ts
import type { OrchestratorState, RunningEntry } from "../types";

export interface InitialStateOptions {
  poll_interval_ms: number;
  max_concurrent_agents: number;
}

export function createInitialState(opts: InitialStateOptions): OrchestratorState {
  return {
    poll_interval_ms: opts.poll_interval_ms,
    max_concurrent_agents: opts.max_concurrent_agents,
    running: new Map(),
    claimed: new Set(),
    retry_attempts: new Map(),
    completed: new Set(),
    claude_totals: { input_tokens: 0, output_tokens: 0, total_tokens: 0, seconds_running: 0 },
    rate_limits: null,
    workflow_mtime: null,
  };
}

export function addRunning(state: OrchestratorState, issueId: string, entry: RunningEntry): void {
  state.running.set(issueId, entry);
  state.claimed.add(issueId);
}

export function removeRunning(state: OrchestratorState, issueId: string): RunningEntry | undefined {
  const entry = state.running.get(issueId);
  state.running.delete(issueId);
  state.claimed.delete(issueId);
  return entry;
}

export function availableSlots(state: OrchestratorState): number {
  return Math.max(state.max_concurrent_agents - state.running.size, 0);
}

export function accumulateTokens(
  state: OrchestratorState,
  usage: { input_tokens?: number; output_tokens?: number; total_tokens?: number },
): void {
  state.claude_totals.input_tokens += usage.input_tokens ?? 0;
  state.claude_totals.output_tokens += usage.output_tokens ?? 0;
  state.claude_totals.total_tokens += usage.total_tokens ?? 0;
}

export function countByState(state: OrchestratorState): Map<string, number> {
  const out = new Map<string, number>();
  for (const entry of state.running.values()) {
    const key = entry.issue.state.toLowerCase();
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}
```

- [ ] **Step 4: Verify pass**

Run: `bun test packages/dalang/tests/orchestrator/state.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/dalang/src/orchestrator/state.ts packages/dalang/tests/orchestrator/state.test.ts
git commit -m "feat(dalang): orchestrator state operations"
```

---

### Task 17: Eligibility filtering and dispatch sorting

**Files:**
- Create: `packages/dalang/src/orchestrator/eligibility.ts`
- Create: `packages/dalang/tests/orchestrator/eligibility.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/dalang/tests/orchestrator/eligibility.test.ts
import { test, expect } from "bun:test";
import { sortForDispatch, isEligible } from "../../src/orchestrator/eligibility";
import { createInitialState } from "../../src/orchestrator/state";
import type { NormalizedIssue } from "../../src/types";

function mkIssue(p: Partial<NormalizedIssue>): NormalizedIssue {
  return {
    id: p.id ?? "id", identifier: p.identifier ?? "X-1", title: p.title ?? "t",
    description: null, priority: p.priority ?? null,
    state: p.state ?? "Todo",
    branch_name: null, url: null,
    labels: [], blocked_by: p.blocked_by ?? [],
    created_at: p.created_at ?? null,
    updated_at: null,
  };
}

test("sortForDispatch: priority asc, nulls last; created_at oldest first; identifier lex", () => {
  const issues = [
    mkIssue({ id: "a", identifier: "X-3", priority: null, created_at: "2026-01-01" }),
    mkIssue({ id: "b", identifier: "X-1", priority: 1, created_at: "2026-01-02" }),
    mkIssue({ id: "c", identifier: "X-2", priority: 1, created_at: "2026-01-01" }),
    mkIssue({ id: "d", identifier: "X-4", priority: 2, created_at: "2026-01-01" }),
  ];
  const sorted = sortForDispatch(issues);
  expect(sorted.map((i) => i.id)).toEqual(["c", "b", "d", "a"]);
});

test("isEligible: rejects issue not in active states", () => {
  const s = createInitialState({ poll_interval_ms: 30000, max_concurrent_agents: 4 });
  const issue = mkIssue({ state: "Done" });
  expect(isEligible(issue, s, { active: ["Todo"], terminal: ["Done"], byState: {} })).toBe(false);
});

test("isEligible: rejects already-running issue", () => {
  const s = createInitialState({ poll_interval_ms: 30000, max_concurrent_agents: 4 });
  s.claimed.add("id1");
  const issue = mkIssue({ id: "id1", state: "Todo" });
  expect(isEligible(issue, s, { active: ["Todo"], terminal: ["Done"], byState: {} })).toBe(false);
});

test("isEligible: Todo with non-terminal blocker not eligible", () => {
  const s = createInitialState({ poll_interval_ms: 30000, max_concurrent_agents: 4 });
  const issue = mkIssue({ state: "Todo", blocked_by: [{ id: "x", identifier: "X-9", state: "In Progress" }] });
  expect(isEligible(issue, s, { active: ["Todo"], terminal: ["Done"], byState: {} })).toBe(false);
});

test("isEligible: Todo with all-terminal blockers eligible", () => {
  const s = createInitialState({ poll_interval_ms: 30000, max_concurrent_agents: 4 });
  const issue = mkIssue({ state: "Todo", blocked_by: [{ id: "x", identifier: "X-9", state: "Done" }] });
  expect(isEligible(issue, s, { active: ["Todo"], terminal: ["Done"], byState: {} })).toBe(true);
});

test("isEligible: respects per-state concurrency limit", () => {
  const s = createInitialState({ poll_interval_ms: 30000, max_concurrent_agents: 10 });
  // simulate 2 running In Progress
  for (const id of ["a", "b"]) {
    s.running.set(id, {
      issue: mkIssue({ id, state: "In Progress" }), identifier: id, workspace_path: "/",
      started_at: "", abort_controller: new AbortController(), retry_attempt: null, session: null,
    });
    s.claimed.add(id);
  }
  const candidate = mkIssue({ id: "c", state: "In Progress" });
  expect(isEligible(candidate, s, {
    active: ["In Progress"], terminal: [], byState: { "in progress": 2 },
  })).toBe(false);
});
```

- [ ] **Step 2: Verify fail**

Run: `bun test packages/dalang/tests/orchestrator/eligibility.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/dalang/src/orchestrator/eligibility.ts
import type { NormalizedIssue, OrchestratorState } from "../types";
import { availableSlots, countByState } from "./state";

export interface EligibilityRules {
  active: string[];
  terminal: string[];
  byState: Record<string, number>;
}

export function sortForDispatch(issues: NormalizedIssue[]): NormalizedIssue[] {
  const arr = [...issues];
  arr.sort((a, b) => {
    const pa = a.priority;
    const pb = b.priority;
    if (pa === null && pb !== null) return 1;
    if (pa !== null && pb === null) return -1;
    if (pa !== null && pb !== null && pa !== pb) return pa - pb;
    const ca = a.created_at ?? "";
    const cb = b.created_at ?? "";
    if (ca !== cb) return ca < cb ? -1 : 1;
    return a.identifier < b.identifier ? -1 : a.identifier > b.identifier ? 1 : 0;
  });
  return arr;
}

function inSet(s: string[], v: string): boolean {
  const lv = v.toLowerCase();
  return s.some((x) => x.toLowerCase() === lv);
}

export function isEligible(
  issue: NormalizedIssue,
  state: OrchestratorState,
  rules: EligibilityRules,
): boolean {
  if (!issue.id || !issue.identifier || !issue.title || !issue.state) return false;
  if (!inSet(rules.active, issue.state)) return false;
  if (inSet(rules.terminal, issue.state)) return false;
  if (state.running.has(issue.id) || state.claimed.has(issue.id)) return false;
  if (availableSlots(state) <= 0) return false;
  if (issue.state.toLowerCase() === "todo") {
    for (const b of issue.blocked_by) {
      if (b.state === null || !inSet(rules.terminal, b.state)) return false;
    }
  }
  const stateKey = issue.state.toLowerCase();
  const cap = rules.byState[stateKey];
  if (cap !== undefined) {
    const counts = countByState(state);
    if ((counts.get(stateKey) ?? 0) >= cap) return false;
  }
  return true;
}
```

- [ ] **Step 4: Verify pass**

Run: `bun test packages/dalang/tests/orchestrator/eligibility.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/dalang/src/orchestrator/eligibility.ts packages/dalang/tests/orchestrator/eligibility.test.ts
git commit -m "feat(dalang): dispatch eligibility and sort"
```

---

### Task 18: Retry scheduling (backoff math + timer cancellation)

**Files:**
- Create: `packages/dalang/src/orchestrator/retry.ts`
- Create: `packages/dalang/tests/orchestrator/retry.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/dalang/tests/orchestrator/retry.test.ts
import { test, expect } from "bun:test";
import { computeBackoffMs, scheduleRetry, cancelRetry } from "../../src/orchestrator/retry";
import { createInitialState } from "../../src/orchestrator/state";

test("backoff formula doubles per attempt and caps at max", () => {
  expect(computeBackoffMs(1, 300000)).toBe(10000);
  expect(computeBackoffMs(2, 300000)).toBe(20000);
  expect(computeBackoffMs(5, 300000)).toBe(160000);
  expect(computeBackoffMs(8, 300000)).toBe(300000);
  expect(computeBackoffMs(20, 300000)).toBe(300000);
});

test("scheduleRetry stores entry and timer", () => {
  const s = createInitialState({ poll_interval_ms: 30000, max_concurrent_agents: 4 });
  scheduleRetry(s, {
    issue_id: "i1", identifier: "X-1", attempt: 1, delayMs: 100,
    error: "boom", onFire: () => {},
  });
  expect(s.retry_attempts.has("i1")).toBe(true);
});

test("scheduling a new retry cancels the existing timer for the same issue", async () => {
  const s = createInitialState({ poll_interval_ms: 30000, max_concurrent_agents: 4 });
  let firedFirst = false;
  let firedSecond = false;
  scheduleRetry(s, { issue_id: "i1", identifier: "X-1", attempt: 1, delayMs: 50,
    error: null, onFire: () => { firedFirst = true; } });
  scheduleRetry(s, { issue_id: "i1", identifier: "X-1", attempt: 2, delayMs: 50,
    error: null, onFire: () => { firedSecond = true; } });
  await new Promise((r) => setTimeout(r, 120));
  expect(firedFirst).toBe(false);
  expect(firedSecond).toBe(true);
});

test("cancelRetry clears entry and prevents firing", async () => {
  const s = createInitialState({ poll_interval_ms: 30000, max_concurrent_agents: 4 });
  let fired = false;
  scheduleRetry(s, { issue_id: "i1", identifier: "X-1", attempt: 1, delayMs: 50,
    error: null, onFire: () => { fired = true; } });
  cancelRetry(s, "i1");
  await new Promise((r) => setTimeout(r, 80));
  expect(fired).toBe(false);
  expect(s.retry_attempts.has("i1")).toBe(false);
});
```

- [ ] **Step 2: Verify fail**

Run: `bun test packages/dalang/tests/orchestrator/retry.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/dalang/src/orchestrator/retry.ts
import type { OrchestratorState } from "../types";

export function computeBackoffMs(attempt: number, capMs: number): number {
  const raw = 10000 * Math.pow(2, Math.max(attempt - 1, 0));
  return Math.min(raw, capMs);
}

export const CONTINUATION_RETRY_MS = 1000;

export interface ScheduleRetryOptions {
  issue_id: string;
  identifier: string;
  attempt: number;
  delayMs: number;
  error: string | null;
  onFire: () => void;
}

export function scheduleRetry(state: OrchestratorState, opts: ScheduleRetryOptions): void {
  cancelRetry(state, opts.issue_id);
  const handle = setTimeout(() => {
    state.retry_attempts.delete(opts.issue_id);
    opts.onFire();
  }, opts.delayMs);
  state.retry_attempts.set(opts.issue_id, {
    issue_id: opts.issue_id,
    identifier: opts.identifier,
    attempt: opts.attempt,
    due_at_ms: Date.now() + opts.delayMs,
    timer_handle: handle,
    error: opts.error,
  });
  state.claimed.add(opts.issue_id);
}

export function cancelRetry(state: OrchestratorState, issueId: string): void {
  const existing = state.retry_attempts.get(issueId);
  if (existing && existing.timer_handle) clearTimeout(existing.timer_handle);
  state.retry_attempts.delete(issueId);
}

export function releaseClaim(state: OrchestratorState, issueId: string): void {
  cancelRetry(state, issueId);
  state.claimed.delete(issueId);
}
```

- [ ] **Step 4: Verify pass**

Run: `bun test packages/dalang/tests/orchestrator/retry.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/dalang/src/orchestrator/retry.ts packages/dalang/tests/orchestrator/retry.test.ts
git commit -m "feat(dalang): retry scheduling with cancellation"
```

---

### Task 19: Reconciliation (stall + tracker refresh)

**Files:**
- Create: `packages/dalang/src/orchestrator/reconcile.ts`
- Create: `packages/dalang/tests/orchestrator/reconcile.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/dalang/tests/orchestrator/reconcile.test.ts
import { test, expect } from "bun:test";
import { detectStalls, classifyTrackerRefresh } from "../../src/orchestrator/reconcile";
import { createInitialState } from "../../src/orchestrator/state";
import type { NormalizedIssue, RunningEntry } from "../../src/types";

function makeRunning(issue: NormalizedIssue, lastEventAt: string | null, startedAt: string): RunningEntry {
  return {
    issue, identifier: issue.identifier, workspace_path: "/tmp",
    started_at: startedAt, abort_controller: new AbortController(),
    retry_attempt: null,
    session: lastEventAt ? {
      session_id: "t-1", thread_id: "t", turn_id: "1",
      claude_session_pid: null, last_event: "notification",
      last_event_at: lastEventAt, last_message: null,
      input_tokens: 0, output_tokens: 0, total_tokens: 0,
      last_reported_input_tokens: 0, last_reported_output_tokens: 0, last_reported_total_tokens: 0,
      turn_count: 1,
    } : null,
  };
}

const issue = (state: string): NormalizedIssue => ({
  id: "i1", identifier: "X-1", title: "t", description: null, priority: null,
  state, branch_name: null, url: null, labels: [], blocked_by: [],
  created_at: null, updated_at: null,
});

test("detectStalls uses last_event_at when present", () => {
  const s = createInitialState({ poll_interval_ms: 30000, max_concurrent_agents: 4 });
  const old = new Date(Date.now() - 60_000).toISOString();
  s.running.set("i1", makeRunning(issue("Todo"), old, new Date().toISOString()));
  const stalls = detectStalls(s, 10_000);
  expect(stalls).toEqual(["i1"]);
});

test("detectStalls falls back to started_at when no events", () => {
  const s = createInitialState({ poll_interval_ms: 30000, max_concurrent_agents: 4 });
  const oldStart = new Date(Date.now() - 60_000).toISOString();
  s.running.set("i1", makeRunning(issue("Todo"), null, oldStart));
  const stalls = detectStalls(s, 10_000);
  expect(stalls).toEqual(["i1"]);
});

test("detectStalls skipped when stall_timeout_ms <= 0", () => {
  const s = createInitialState({ poll_interval_ms: 30000, max_concurrent_agents: 4 });
  const oldStart = new Date(Date.now() - 60_000).toISOString();
  s.running.set("i1", makeRunning(issue("Todo"), null, oldStart));
  expect(detectStalls(s, 0)).toEqual([]);
  expect(detectStalls(s, -1)).toEqual([]);
});

test("classifyTrackerRefresh: terminal → terminate+cleanup", () => {
  const r = classifyTrackerRefresh(issue("Done"), { active: ["Todo"], terminal: ["Done"] });
  expect(r).toEqual({ kind: "terminate_with_cleanup" });
});

test("classifyTrackerRefresh: non-active non-terminal → terminate without cleanup", () => {
  const r = classifyTrackerRefresh(issue("Pending"), { active: ["Todo"], terminal: ["Done"] });
  expect(r).toEqual({ kind: "terminate_no_cleanup" });
});

test("classifyTrackerRefresh: active → update snapshot", () => {
  const r = classifyTrackerRefresh(issue("Todo"), { active: ["Todo"], terminal: ["Done"] });
  expect(r).toEqual({ kind: "update_snapshot" });
});
```

- [ ] **Step 2: Verify fail**

Run: `bun test packages/dalang/tests/orchestrator/reconcile.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/dalang/src/orchestrator/reconcile.ts
import type { NormalizedIssue, OrchestratorState } from "../types";

export function detectStalls(state: OrchestratorState, stallTimeoutMs: number): string[] {
  if (stallTimeoutMs <= 0) return [];
  const now = Date.now();
  const out: string[] = [];
  for (const [id, entry] of state.running.entries()) {
    const last = entry.session?.last_event_at ?? entry.started_at;
    const ts = Date.parse(last);
    if (Number.isNaN(ts)) continue;
    if (now - ts > stallTimeoutMs) out.push(id);
  }
  return out;
}

export type RefreshClassification =
  | { kind: "terminate_with_cleanup" }
  | { kind: "terminate_no_cleanup" }
  | { kind: "update_snapshot" };

export interface RefreshRules {
  active: string[];
  terminal: string[];
}

function inSet(set: string[], v: string): boolean {
  const lv = v.toLowerCase();
  return set.some((x) => x.toLowerCase() === lv);
}

export function classifyTrackerRefresh(issue: NormalizedIssue, rules: RefreshRules): RefreshClassification {
  if (inSet(rules.terminal, issue.state)) return { kind: "terminate_with_cleanup" };
  if (inSet(rules.active, issue.state)) return { kind: "update_snapshot" };
  return { kind: "terminate_no_cleanup" };
}
```

- [ ] **Step 4: Verify pass**

Run: `bun test packages/dalang/tests/orchestrator/reconcile.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/dalang/src/orchestrator/reconcile.ts packages/dalang/tests/orchestrator/reconcile.test.ts
git commit -m "feat(dalang): reconciliation primitives (stall + classify)"
```

---

## Phase F — Agent Runner (Tasks 20–22)

### Task 20: SDK message → runtime event mapper

**Files:**
- Create: `packages/dalang/src/agent/event-mapper.ts`
- Create: `packages/dalang/tests/agent/event-mapper.test.ts`

The Claude Agent SDK message types we map (per spec §10.4): `system` (init), `assistant`, `user` (tool_result), `result`. Other shapes fall through to `other_message` or `malformed`.

- [ ] **Step 1: Write failing test**

```ts
// packages/dalang/tests/agent/event-mapper.test.ts
import { test, expect } from "bun:test";
import { mapSdkMessage } from "../../src/agent/event-mapper";

test("system init message → session_started", () => {
  const ev = mapSdkMessage({ type: "system", subtype: "init", session_id: "sess-1" });
  expect(ev?.event).toBe("session_started");
  expect(ev?.thread_id).toBe("sess-1");
});

test("assistant text → notification (truncated)", () => {
  const longText = "x".repeat(5000);
  const ev = mapSdkMessage({
    type: "assistant",
    message: { content: [{ type: "text", text: longText }] },
  });
  expect(ev?.event).toBe("notification");
  expect((ev?.message ?? "").length).toBeLessThanOrEqual(2050);
});

test("assistant tool_use → notification", () => {
  const ev = mapSdkMessage({
    type: "assistant",
    message: { content: [{ type: "tool_use", name: "read_file", input: { path: "x" } }] },
  });
  expect(ev?.event).toBe("notification");
  expect(ev?.message).toContain("tool_use");
});

test("user tool_result → notification", () => {
  const ev = mapSdkMessage({
    type: "user",
    message: { content: [{ type: "tool_result", content: "ok" }] },
  });
  expect(ev?.event).toBe("notification");
});

test("result success → turn_completed with usage", () => {
  const ev = mapSdkMessage({
    type: "result", subtype: "success",
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
  });
  expect(ev?.event).toBe("turn_completed");
  expect(ev?.usage?.total_tokens).toBe(15);
});

test("result error → turn_ended_with_error", () => {
  const ev = mapSdkMessage({ type: "result", subtype: "error_during_execution" });
  expect(ev?.event).toBe("turn_ended_with_error");
});

test("malformed message → malformed", () => {
  const ev = mapSdkMessage({ not_a_known_shape: true });
  expect(ev?.event).toBe("malformed");
});

test("null/undefined input returns null", () => {
  expect(mapSdkMessage(null)).toBeNull();
  expect(mapSdkMessage(undefined)).toBeNull();
});
```

- [ ] **Step 2: Verify fail**

Run: `bun test packages/dalang/tests/agent/event-mapper.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/dalang/src/agent/event-mapper.ts
import type { RuntimeEvent } from "../types";

const TRUNC = 2000;

function truncate(s: string): string {
  if (s.length <= TRUNC) return s;
  return s.slice(0, TRUNC) + `... [truncated ${s.length - TRUNC} bytes]`;
}

function nowIso(): string { return new Date().toISOString(); }

export function mapSdkMessage(raw: unknown): RuntimeEvent | null {
  if (raw === null || raw === undefined || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const type = m.type;

  if (type === "system" && m.subtype === "init") {
    return {
      event: "session_started",
      timestamp: nowIso(),
      thread_id: typeof m.session_id === "string" ? m.session_id : undefined,
    };
  }

  if (type === "assistant") {
    const content = ((m.message as Record<string, unknown> | undefined)?.content ?? []) as unknown[];
    const parts: string[] = [];
    for (const c of content) {
      if (c === null || typeof c !== "object") continue;
      const cc = c as Record<string, unknown>;
      if (cc.type === "text" && typeof cc.text === "string") parts.push(cc.text);
      else if (cc.type === "tool_use") parts.push(`tool_use:${String(cc.name ?? "?")}`);
    }
    return {
      event: "notification",
      timestamp: nowIso(),
      message: truncate(parts.join(" ")),
    };
  }

  if (type === "user") {
    const content = ((m.message as Record<string, unknown> | undefined)?.content ?? []) as unknown[];
    const hasToolResult = content.some((c) =>
      c !== null && typeof c === "object" && (c as Record<string, unknown>).type === "tool_result"
    );
    if (hasToolResult) {
      return { event: "notification", timestamp: nowIso(), message: "tool_result" };
    }
    return { event: "other_message", timestamp: nowIso() };
  }

  if (type === "result") {
    const subtype = m.subtype;
    const usage = m.usage as RuntimeEvent["usage"] | undefined;
    if (subtype === "success") {
      return { event: "turn_completed", timestamp: nowIso(), usage };
    }
    return { event: "turn_ended_with_error", timestamp: nowIso(), reason: typeof subtype === "string" ? subtype : undefined };
  }

  if (typeof type === "string") {
    return { event: "other_message", timestamp: nowIso(), message: type };
  }
  return { event: "malformed", timestamp: nowIso() };
}
```

- [ ] **Step 4: Verify pass**

Run: `bun test packages/dalang/tests/agent/event-mapper.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/dalang/src/agent/event-mapper.ts packages/dalang/tests/agent/event-mapper.test.ts
git commit -m "feat(dalang): SDK message → runtime event mapper"
```

---

### Task 21: Agent runner (single-turn driver)

**Files:**
- Create: `packages/dalang/src/agent/agent-runner.ts`
- Create: `packages/dalang/tests/agent/agent-runner.test.ts`

The agent runner accepts a **runQuery** dependency so tests can inject a fake SDK iterator without launching the real `claude` binary.

- [ ] **Step 1: Write failing test**

```ts
// packages/dalang/tests/agent/agent-runner.test.ts
import { test, expect } from "bun:test";
import { runAttempt } from "../../src/agent/agent-runner";
import type { NormalizedIssue, RuntimeEvent } from "../../src/types";

const issue: NormalizedIssue = {
  id: "i1", identifier: "X-1", title: "t", description: "d", priority: null,
  state: "Todo", branch_name: null, url: null, labels: [], blocked_by: [],
  created_at: null, updated_at: null,
};

const baseDeps = (sdkMessages: unknown[]) => ({
  promptTemplate: "Body for {{ issue.identifier }}",
  workspacePath: "/tmp/X-1",
  config: { permissionMode: "auto", model: "claude-opus-4-7", executablePath: "claude",
    turnTimeoutMs: 5000, readTimeoutMs: 1000, stallTimeoutMs: 0, maxTurns: 1 },
  trackerRefresh: async () => issue,
  isActiveState: (s: string) => s === "Todo",
  runQuery: async function* () {
    for (const m of sdkMessages) yield m;
  },
});

test("runs one turn, emits session_started + turn_completed, accumulates tokens", async () => {
  const events: RuntimeEvent[] = [];
  const result = await runAttempt({
    ...baseDeps([
      { type: "system", subtype: "init", session_id: "sess-1" },
      { type: "result", subtype: "success", usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } },
    ]),
    issue, attempt: null, onEvent: (e) => events.push(e),
  });
  expect(result.success).toBe(true);
  expect(result.tokens).toEqual({ input_tokens: 10, output_tokens: 5, total_tokens: 15 });
  expect(events.map((e) => e.event)).toEqual(["session_started", "turn_completed"]);
});

test("aborts cleanly when controller is aborted", async () => {
  const events: RuntimeEvent[] = [];
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 10);
  const result = await runAttempt({
    ...baseDeps([
      { type: "system", subtype: "init", session_id: "sess-1" },
      // no result message; iterator pretends to be slow
    ]),
    issue, attempt: null, onEvent: (e) => events.push(e), abortSignal: controller.signal,
  });
  expect(result.success).toBe(false);
  expect(result.reason).toBe("turn_cancelled");
});

test("multi-turn loop continues when issue stays active and turn budget allows", async () => {
  const events: RuntimeEvent[] = [];
  let turn = 0;
  const result = await runAttempt({
    ...baseDeps([]),
    config: { ...baseDeps([]).config, maxTurns: 2 },
    issue, attempt: null, onEvent: (e) => events.push(e),
    runQuery: async function* () {
      turn += 1;
      yield { type: "system", subtype: "init", session_id: `s-${turn}` };
      yield { type: "result", subtype: "success", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
    },
  });
  expect(result.success).toBe(true);
  expect(turn).toBe(2);
  expect(result.tokens.total_tokens).toBe(4);
});
```

- [ ] **Step 2: Verify fail**

Run: `bun test packages/dalang/tests/agent/agent-runner.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/dalang/src/agent/agent-runner.ts
import type { NormalizedIssue, RuntimeEvent } from "../types";
import { buildFirstTurnPrompt, buildContinuationPrompt } from "./prompt-builder";
import { mapSdkMessage } from "./event-mapper";

export interface AgentConfig {
  permissionMode: "auto" | "default" | "plan" | "bypassPermissions";
  model: string;
  executablePath: string;
  turnTimeoutMs: number;
  readTimeoutMs: number;
  stallTimeoutMs: number;
  maxTurns: number;
}

export interface RunQueryOptions {
  prompt: string;
  cwd: string;
  permissionMode: AgentConfig["permissionMode"];
  model: string;
  executablePath: string;
  abortSignal?: AbortSignal;
  resumeSessionId?: string;
}

export type RunQuery = (opts: RunQueryOptions) => AsyncIterable<unknown>;

export interface RunAttemptDeps {
  issue: NormalizedIssue;
  attempt: number | null;
  promptTemplate: string;
  workspacePath: string;
  config: AgentConfig;
  trackerRefresh: (id: string) => Promise<NormalizedIssue | null>;
  isActiveState: (s: string) => boolean;
  runQuery: RunQuery;
  onEvent: (e: RuntimeEvent) => void;
  abortSignal?: AbortSignal;
}

export interface RunAttemptResult {
  success: boolean;
  reason?: string;
  thread_id: string | null;
  turn_count: number;
  tokens: { input_tokens: number; output_tokens: number; total_tokens: number };
}

export async function runAttempt(deps: RunAttemptDeps): Promise<RunAttemptResult> {
  let threadId: string | null = null;
  let turnCount = 0;
  const tokens = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  let issue = deps.issue;

  while (true) {
    turnCount += 1;
    const prompt = turnCount === 1
      ? await buildFirstTurnPrompt(deps.promptTemplate, issue, deps.attempt)
      : buildContinuationPrompt(issue, turnCount, deps.config.maxTurns);

    const turn = await driveOneTurn({
      prompt,
      workspacePath: deps.workspacePath,
      config: deps.config,
      runQuery: deps.runQuery,
      onEvent: deps.onEvent,
      abortSignal: deps.abortSignal,
      resumeSessionId: threadId ?? undefined,
    });

    if (turn.thread_id) threadId = turn.thread_id;
    tokens.input_tokens += turn.tokens.input_tokens;
    tokens.output_tokens += turn.tokens.output_tokens;
    tokens.total_tokens += turn.tokens.total_tokens;

    if (!turn.success) {
      return { success: false, reason: turn.reason, thread_id: threadId, turn_count: turnCount, tokens };
    }

    const refreshed = await deps.trackerRefresh(issue.id).catch(() => null);
    if (!refreshed) break;
    issue = refreshed;
    if (!deps.isActiveState(issue.state)) break;
    if (turnCount >= deps.config.maxTurns) break;
  }

  return { success: true, thread_id: threadId, turn_count: turnCount, tokens };
}

interface DriveOneTurnOptions {
  prompt: string;
  workspacePath: string;
  config: AgentConfig;
  runQuery: RunQuery;
  onEvent: (e: RuntimeEvent) => void;
  abortSignal?: AbortSignal;
  resumeSessionId?: string;
}

interface DriveOneTurnResult {
  success: boolean;
  reason?: string;
  thread_id: string | null;
  tokens: { input_tokens: number; output_tokens: number; total_tokens: number };
}

async function driveOneTurn(opts: DriveOneTurnOptions): Promise<DriveOneTurnResult> {
  let threadId: string | null = null;
  const tokens = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  const turnTimer = setTimeout(() => {}, opts.config.turnTimeoutMs);
  const turnAbort = new AbortController();
  const onAbort = () => turnAbort.abort();
  if (opts.abortSignal) opts.abortSignal.addEventListener("abort", onAbort, { once: true });

  const turnTimeout = setTimeout(() => turnAbort.abort(), opts.config.turnTimeoutMs);

  try {
    const iter = opts.runQuery({
      prompt: opts.prompt,
      cwd: opts.workspacePath,
      permissionMode: opts.config.permissionMode,
      model: opts.config.model,
      executablePath: opts.config.executablePath,
      abortSignal: turnAbort.signal,
      resumeSessionId: opts.resumeSessionId,
    });

    for await (const raw of iter) {
      if (turnAbort.signal.aborted) {
        return { success: false, reason: "turn_cancelled", thread_id: threadId, tokens };
      }
      const evt = mapSdkMessage(raw);
      if (!evt) continue;
      if (evt.event === "session_started" && evt.thread_id) threadId = evt.thread_id;
      if (evt.event === "turn_completed" && evt.usage) {
        tokens.input_tokens += evt.usage.input_tokens ?? 0;
        tokens.output_tokens += evt.usage.output_tokens ?? 0;
        tokens.total_tokens += evt.usage.total_tokens ?? 0;
      }
      opts.onEvent(evt);
      if (evt.event === "turn_completed") return { success: true, thread_id: threadId, tokens };
      if (evt.event === "turn_ended_with_error") return { success: false, reason: "turn_failed", thread_id: threadId, tokens };
      if (evt.event === "turn_input_required") return { success: false, reason: "turn_input_required", thread_id: threadId, tokens };
    }
    return { success: false, reason: "subprocess_exit", thread_id: threadId, tokens };
  } catch (err) {
    if (turnAbort.signal.aborted) return { success: false, reason: "turn_cancelled", thread_id: threadId, tokens };
    return { success: false, reason: "turn_failed", thread_id: threadId, tokens };
  } finally {
    clearTimeout(turnTimer);
    clearTimeout(turnTimeout);
    if (opts.abortSignal) opts.abortSignal.removeEventListener("abort", onAbort);
  }
}
```

- [ ] **Step 4: Verify pass**

Run: `bun test packages/dalang/tests/agent/agent-runner.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/dalang/src/agent/agent-runner.ts packages/dalang/tests/agent/agent-runner.test.ts
git commit -m "feat(dalang): agent runner with multi-turn loop and abort"
```

---

### Task 22: Real SDK adapter for `runQuery`

**Files:**
- Create: `packages/dalang/src/agent/sdk-runner.ts`
- Create: `packages/dalang/tests/agent/sdk-runner.test.ts`

This wraps the actual `@anthropic-ai/claude-agent-sdk` `query()` call into the `RunQuery` shape. Only a smoke test (no real Claude) — full integration is in Phase J.

- [ ] **Step 1: Write smoke test**

```ts
// packages/dalang/tests/agent/sdk-runner.test.ts
import { test, expect } from "bun:test";
import { sdkRunQuery } from "../../src/agent/sdk-runner";

test("sdkRunQuery returns an async iterable (smoke)", () => {
  const it = sdkRunQuery({
    prompt: "noop", cwd: "/tmp",
    permissionMode: "auto", model: "claude-opus-4-7",
    executablePath: "/nonexistent/path/to/claude",
  });
  expect(typeof (it as AsyncIterable<unknown>)[Symbol.asyncIterator]).toBe("function");
});
```

- [ ] **Step 2: Verify fail**

Run: `bun test packages/dalang/tests/agent/sdk-runner.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/dalang/src/agent/sdk-runner.ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { RunQuery, RunQueryOptions } from "./agent-runner";

export const sdkRunQuery: RunQuery = (opts: RunQueryOptions) => {
  return query({
    prompt: opts.prompt,
    options: {
      cwd: opts.cwd,
      model: opts.model,
      permissionMode: opts.permissionMode,
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

- [ ] **Step 4: Verify pass**

Run: `bun test packages/dalang/tests/agent/sdk-runner.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add packages/dalang/src/agent/sdk-runner.ts packages/dalang/tests/agent/sdk-runner.test.ts
git commit -m "feat(dalang): real Claude Agent SDK runQuery adapter"
```

---

## Phase G — Composition (Tasks 23–25)

### Task 23: Structured logger

**Files:**
- Create: `packages/dalang/src/logging/logger.ts`
- Create: `packages/dalang/tests/logging/logger.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/dalang/tests/logging/logger.test.ts
import { test, expect } from "bun:test";
import { createLogger } from "../../src/logging/logger";

test("createLogger returns an object with the standard methods", () => {
  const log = createLogger({ name: "dalang", level: "info" });
  expect(typeof log.info).toBe("function");
  expect(typeof log.warn).toBe("function");
  expect(typeof log.error).toBe("function");
  expect(typeof log.debug).toBe("function");
});

test("child(ctx) attaches issue context fields", () => {
  const log = createLogger({ name: "dalang", level: "info" });
  const child = log.child({ issue_id: "i1", issue_identifier: "X-1" });
  expect(typeof child.info).toBe("function");
});
```

- [ ] **Step 2: Verify fail**

Run: `bun test packages/dalang/tests/logging/logger.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/dalang/src/logging/logger.ts
import pino from "pino";

export interface LoggerOptions {
  name: string;
  level: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
}

export type Logger = pino.Logger;

export function createLogger(opts: LoggerOptions): Logger {
  return pino({
    name: opts.name,
    level: opts.level,
    base: undefined, // do not include pid/hostname by default
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
```

- [ ] **Step 4: Verify pass**

Run: `bun test packages/dalang/tests/logging/logger.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/dalang/src/logging/logger.ts packages/dalang/tests/logging/logger.test.ts
git commit -m "feat(dalang): pino logger setup"
```

---

### Task 24: Orchestrator main loop (composition)

**Files:**
- Create: `packages/dalang/src/orchestrator/orchestrator.ts`
- Create: `packages/dalang/tests/orchestrator/orchestrator.test.ts`

The orchestrator is composed of all primitives. The main loop test injects fake adapters and verifies tick behavior end-to-end.

- [ ] **Step 1: Write failing test**

```ts
// packages/dalang/tests/orchestrator/orchestrator.test.ts
import { test, expect } from "bun:test";
import { Orchestrator } from "../../src/orchestrator/orchestrator";
import type { TrackerAdapter } from "../../src/tracker/adapter";
import type { NormalizedIssue } from "../../src/types";
import { applyDefaults } from "../../src/config/schema";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const issue = (id: string, state = "Todo"): NormalizedIssue => ({
  id, identifier: `X-${id}`, title: "t", description: null, priority: 1,
  state, branch_name: null, url: null, labels: [], blocked_by: [],
  created_at: "2026-01-01", updated_at: null,
});

class FakeTracker implements TrackerAdapter {
  candidates: NormalizedIssue[] = [];
  byIds: Record<string, NormalizedIssue> = {};
  async fetchCandidateIssues(): Promise<NormalizedIssue[]> { return this.candidates; }
  async fetchIssuesByStates(): Promise<NormalizedIssue[]> { return []; }
  async fetchIssueStatesByIds(ids: string[]): Promise<NormalizedIssue[]> {
    return ids.map((id) => this.byIds[id]).filter((x): x is NormalizedIssue => Boolean(x));
  }
  async fetchIssue(id: string): Promise<NormalizedIssue | null> { return this.byIds[id] ?? null; }
}

async function tmpRoot(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "dalang-orch-"));
}

test("tick dispatches eligible issue and runs an attempt to completion", async () => {
  const root = await tmpRoot();
  const tracker = new FakeTracker();
  tracker.candidates = [issue("i1")];
  tracker.byIds["i1"] = issue("i1");

  const cfg = applyDefaults({
    tracker: { endpoint: "http://localhost:1234", active_states: ["Todo"], terminal_states: ["Done"] },
    workspace: { root },
    agent: { max_concurrent_agents: 1, max_turns: 1 },
    polling: { interval_ms: 1000 },
  });

  const orch = new Orchestrator({
    tracker,
    config: cfg,
    promptTemplate: "Body for {{ issue.identifier }}",
    runQuery: async function* () {
      yield { type: "system", subtype: "init", session_id: "sess-1" };
      yield { type: "result", subtype: "success", usage: { input_tokens: 5, output_tokens: 5, total_tokens: 10 } };
    },
  });

  await orch.tick();
  // Allow the dispatched async worker to complete
  await orch.drainPendingForTest();

  expect(orch.state.claude_totals.total_tokens).toBe(10);
  expect(orch.state.completed.has("i1")).toBe(true);
});

test("tick respects max_concurrent_agents and queues the rest", async () => {
  const root = await tmpRoot();
  const tracker = new FakeTracker();
  tracker.candidates = [issue("i1"), issue("i2")];
  tracker.byIds["i1"] = issue("i1");
  tracker.byIds["i2"] = issue("i2");

  const cfg = applyDefaults({
    tracker: { endpoint: "http://localhost:1", active_states: ["Todo"], terminal_states: ["Done"] },
    workspace: { root },
    agent: { max_concurrent_agents: 1, max_turns: 1 },
    polling: { interval_ms: 1000 },
  });

  let dispatched = 0;
  const orch = new Orchestrator({
    tracker, config: cfg, promptTemplate: "x",
    runQuery: async function* () {
      dispatched += 1;
      yield { type: "system", subtype: "init", session_id: `s-${dispatched}` };
      yield { type: "result", subtype: "success", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
    },
  });
  await orch.tick();
  expect(orch.state.running.size + orch.state.retry_attempts.size).toBeGreaterThanOrEqual(1);
  expect(orch.state.running.size).toBeLessThanOrEqual(1);
});
```

- [ ] **Step 2: Verify fail**

Run: `bun test packages/dalang/tests/orchestrator/orchestrator.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/dalang/src/orchestrator/orchestrator.ts
import { resolve } from "node:path";
import type { TrackerAdapter } from "../tracker/adapter";
import type { NormalizedIssue, OrchestratorState, RunningEntry } from "../types";
import type { WorkflowFrontMatter } from "../config/schema";
import { createInitialState, addRunning, removeRunning, accumulateTokens } from "./state";
import { sortForDispatch, isEligible } from "./eligibility";
import { scheduleRetry, computeBackoffMs, releaseClaim, CONTINUATION_RETRY_MS } from "./retry";
import { detectStalls, classifyTrackerRefresh } from "./reconcile";
import { WorkspaceManager } from "../workspace/workspace-manager";
import { GitWorktreeManager } from "../workspace/git-worktree";
import { runHook } from "../workspace/hooks";
import { runAttempt, type RunQuery } from "../agent/agent-runner";
import { expandPath } from "../config/env-resolver";
import { resolveEnvValue } from "../config/env-resolver";
import { createLogger, type Logger } from "../logging/logger";

export interface OrchestratorOptions {
  tracker: TrackerAdapter;
  config: WorkflowFrontMatter;
  promptTemplate: string;
  runQuery: RunQuery;
  logger?: Logger;
}

export class Orchestrator {
  state: OrchestratorState;
  private readonly tracker: TrackerAdapter;
  private cfg: WorkflowFrontMatter;
  private promptTemplate: string;
  private readonly runQuery: RunQuery;
  private readonly workspaces: WorkspaceManager;
  private readonly worktrees: GitWorktreeManager | null;
  private readonly log: Logger;
  private inflight: Promise<void>[] = [];

  constructor(opts: OrchestratorOptions) {
    this.tracker = opts.tracker;
    this.cfg = opts.config;
    this.promptTemplate = opts.promptTemplate;
    this.runQuery = opts.runQuery;
    this.log = opts.logger ?? createLogger({ name: "dalang", level: "info" });
    const wsRoot = resolve(expandPath(opts.config.workspace.root));
    this.workspaces = new WorkspaceManager({ root: wsRoot });
    this.worktrees = opts.config.repo
      ? new GitWorktreeManager({
          workspaceRoot: wsRoot,
          repoUrl: opts.config.repo.url,
          defaultBranch: opts.config.repo.default_branch,
          branchPrefix: opts.config.repo.branch_prefix,
        })
      : null;
    this.state = createInitialState({
      poll_interval_ms: opts.config.polling.interval_ms,
      max_concurrent_agents: opts.config.agent.max_concurrent_agents,
    });
  }

  updateConfig(next: WorkflowFrontMatter, promptTemplate: string): void {
    this.cfg = next;
    this.promptTemplate = promptTemplate;
    this.state.poll_interval_ms = next.polling.interval_ms;
    this.state.max_concurrent_agents = next.agent.max_concurrent_agents;
  }

  async tick(): Promise<void> {
    await this.reconcile();
    let candidates: NormalizedIssue[] = [];
    try {
      candidates = await this.tracker.fetchCandidateIssues(this.cfg.tracker.active_states);
    } catch (err) {
      this.log.warn({ err: (err as Error).message }, "candidate fetch failed; skipping dispatch");
      return;
    }
    const sorted = sortForDispatch(candidates);
    for (const issue of sorted) {
      if (
        !isEligible(issue, this.state, {
          active: this.cfg.tracker.active_states,
          terminal: this.cfg.tracker.terminal_states,
          byState: this.cfg.agent.max_concurrent_agents_by_state,
        })
      ) continue;
      this.dispatch(issue, null);
    }
  }

  private async reconcile(): Promise<void> {
    const stalls = detectStalls(this.state, this.cfg.claude.stall_timeout_ms);
    for (const id of stalls) {
      const entry = this.state.running.get(id);
      if (entry) {
        entry.abort_controller.abort();
        this.log.warn({ issue_id: id }, "stall detected; aborting worker");
      }
    }
    const ids = Array.from(this.state.running.keys());
    if (ids.length === 0) return;
    let refreshed: NormalizedIssue[] = [];
    try {
      refreshed = await this.tracker.fetchIssueStatesByIds(ids);
    } catch (err) {
      this.log.warn({ err: (err as Error).message }, "state refresh failed; keeping workers");
      return;
    }
    for (const next of refreshed) {
      const entry = this.state.running.get(next.id);
      if (!entry) continue;
      const cls = classifyTrackerRefresh(next, {
        active: this.cfg.tracker.active_states,
        terminal: this.cfg.tracker.terminal_states,
      });
      if (cls.kind === "update_snapshot") entry.issue = next;
      else if (cls.kind === "terminate_with_cleanup") {
        entry.abort_controller.abort();
        await this.cleanupWorkspace(entry).catch(() => {});
      } else {
        entry.abort_controller.abort();
      }
    }
  }

  private dispatch(issue: NormalizedIssue, attempt: number | null): void {
    const controller = new AbortController();
    const entry: RunningEntry = {
      issue, identifier: issue.identifier,
      workspace_path: this.workspaces.pathFor(issue.identifier),
      started_at: new Date().toISOString(),
      abort_controller: controller,
      retry_attempt: attempt, session: null,
    };
    addRunning(this.state, issue.id, entry);
    const work = this.runWorker(issue, attempt, controller).catch((err) => {
      this.log.error({ issue_id: issue.id, err: (err as Error).message }, "worker crashed");
    });
    this.inflight.push(work);
  }

  private async runWorker(
    issue: NormalizedIssue,
    attempt: number | null,
    controller: AbortController,
  ): Promise<void> {
    const cwd = this.workspaces.pathFor(issue.identifier);
    const ws = await this.workspaces.ensureWorkspace(issue.identifier);
    if (this.worktrees) {
      const branch = this.worktrees.branchName(ws.workspace_key);
      await this.worktrees.ensureWorktree(cwd, branch);
    }
    const env = {
      WORKSPACE_PATH: cwd,
      ISSUE_ID: issue.id,
      ISSUE_IDENTIFIER: issue.identifier,
      ISSUE_STATE: issue.state,
      ATTEMPT: attempt === null ? "" : String(attempt),
    };
    if (ws.created_now && this.cfg.hooks.after_create) {
      await runHook({ name: "after_create", script: this.cfg.hooks.after_create, cwd, env, timeoutMs: this.cfg.hooks.timeout_ms });
    }
    if (this.cfg.hooks.before_run) {
      await runHook({ name: "before_run", script: this.cfg.hooks.before_run, cwd, env, timeoutMs: this.cfg.hooks.timeout_ms });
    }

    const result = await runAttempt({
      issue, attempt,
      promptTemplate: this.promptTemplate,
      workspacePath: cwd,
      config: {
        permissionMode: this.cfg.claude.permission_mode,
        model: this.cfg.claude.model,
        executablePath: this.cfg.claude.executable_path,
        turnTimeoutMs: this.cfg.claude.turn_timeout_ms,
        readTimeoutMs: this.cfg.claude.read_timeout_ms,
        stallTimeoutMs: this.cfg.claude.stall_timeout_ms,
        maxTurns: this.cfg.agent.max_turns,
      },
      trackerRefresh: async (id) => {
        const r = await this.tracker.fetchIssueStatesByIds([id]).catch(() => []);
        return r[0] ?? null;
      },
      isActiveState: (s) => this.cfg.tracker.active_states.some((x) => x.toLowerCase() === s.toLowerCase()),
      runQuery: this.runQuery,
      onEvent: (e) => {
        const entry = this.state.running.get(issue.id);
        if (!entry) return;
        entry.session = entry.session ?? {
          session_id: `${e.thread_id ?? "?"}-1`,
          thread_id: e.thread_id ?? "?", turn_id: "1",
          claude_session_pid: null, last_event: e.event,
          last_event_at: e.timestamp, last_message: e.message ?? null,
          input_tokens: 0, output_tokens: 0, total_tokens: 0,
          last_reported_input_tokens: 0, last_reported_output_tokens: 0, last_reported_total_tokens: 0,
          turn_count: 1,
        };
        entry.session.last_event = e.event;
        entry.session.last_event_at = e.timestamp;
        entry.session.last_message = e.message ?? null;
      },
      abortSignal: controller.signal,
    });

    accumulateTokens(this.state, result.tokens);
    if (this.cfg.hooks.after_run) {
      await runHook({ name: "after_run", script: this.cfg.hooks.after_run, cwd, env, timeoutMs: this.cfg.hooks.timeout_ms })
        .catch(() => {});
    }
    removeRunning(this.state, issue.id);

    if (result.success) {
      this.state.completed.add(issue.id);
      scheduleRetry(this.state, {
        issue_id: issue.id, identifier: issue.identifier,
        attempt: 1, delayMs: CONTINUATION_RETRY_MS, error: null,
        onFire: () => this.handleRetryFire(issue.id),
      });
    } else {
      const nextAttempt = (attempt ?? 0) + 1;
      const delay = computeBackoffMs(nextAttempt, this.cfg.agent.max_retry_backoff_ms);
      scheduleRetry(this.state, {
        issue_id: issue.id, identifier: issue.identifier,
        attempt: nextAttempt, delayMs: delay, error: result.reason ?? "worker_failed",
        onFire: () => this.handleRetryFire(issue.id),
      });
    }
  }

  private async handleRetryFire(issueId: string): Promise<void> {
    let candidates: NormalizedIssue[] = [];
    try {
      candidates = await this.tracker.fetchCandidateIssues(this.cfg.tracker.active_states);
    } catch {
      const e = this.state.retry_attempts.get(issueId);
      const next = (e?.attempt ?? 1) + 1;
      scheduleRetry(this.state, {
        issue_id: issueId, identifier: e?.identifier ?? issueId,
        attempt: next, delayMs: computeBackoffMs(next, this.cfg.agent.max_retry_backoff_ms),
        error: "retry poll failed",
        onFire: () => this.handleRetryFire(issueId),
      });
      return;
    }
    const issue = candidates.find((c) => c.id === issueId);
    if (!issue) {
      releaseClaim(this.state, issueId);
      return;
    }
    if (!isEligible(issue, this.state, {
      active: this.cfg.tracker.active_states,
      terminal: this.cfg.tracker.terminal_states,
      byState: this.cfg.agent.max_concurrent_agents_by_state,
    })) {
      const e = this.state.retry_attempts.get(issueId);
      const next = (e?.attempt ?? 1) + 1;
      scheduleRetry(this.state, {
        issue_id: issueId, identifier: issue.identifier,
        attempt: next, delayMs: computeBackoffMs(next, this.cfg.agent.max_retry_backoff_ms),
        error: "no available orchestrator slots",
        onFire: () => this.handleRetryFire(issueId),
      });
      return;
    }
    this.dispatch(issue, this.state.retry_attempts.get(issueId)?.attempt ?? null);
  }

  private async cleanupWorkspace(entry: RunningEntry): Promise<void> {
    const cwd = entry.workspace_path;
    const env = {
      WORKSPACE_PATH: cwd, ISSUE_ID: entry.issue.id,
      ISSUE_IDENTIFIER: entry.issue.identifier, ISSUE_STATE: entry.issue.state,
      ATTEMPT: "",
    };
    if (this.cfg.hooks.before_remove) {
      await runHook({ name: "before_remove", script: this.cfg.hooks.before_remove, cwd, env, timeoutMs: this.cfg.hooks.timeout_ms })
        .catch(() => {});
    }
    if (this.worktrees) await this.worktrees.removeWorktree(cwd);
    else await this.workspaces.removeWorkspace(entry.issue.identifier);
  }

  /** Used by tests to await all background workers spawned during a tick. */
  async drainPendingForTest(): Promise<void> {
    while (this.inflight.length > 0) {
      const all = this.inflight.slice();
      this.inflight = [];
      await Promise.allSettled(all);
    }
  }
}

// Helper export so callers can resolve env-backed api_key
export function resolveTrackerApiKey(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.startsWith("$")) return resolveEnvValue(value);
  return value;
}
```

- [ ] **Step 4: Verify pass**

Run: `bun test packages/dalang/tests/orchestrator/orchestrator.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/dalang/src/orchestrator/orchestrator.ts packages/dalang/tests/orchestrator/orchestrator.test.ts
git commit -m "feat(dalang): orchestrator main loop composition"
```

---

## Phase H — HTTP server (Tasks 25–26)

### Task 25: Snapshot builder + JSON routes

**Files:**
- Create: `packages/dalang/src/http/snapshot.ts`
- Create: `packages/dalang/src/http/routes.ts`
- Create: `packages/dalang/tests/http/routes.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/dalang/tests/http/routes.test.ts
import { test, expect } from "bun:test";
import { handleRequest } from "../../src/http/routes";
import { createInitialState } from "../../src/orchestrator/state";

const baseDeps = () => {
  const state = createInitialState({ poll_interval_ms: 30000, max_concurrent_agents: 4 });
  return { state, refresh: async () => {} };
};

test("GET /api/v1/state returns running, retrying, claude_totals", async () => {
  const deps = baseDeps();
  const res = await handleRequest(new Request("http://x/api/v1/state"), deps);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toHaveProperty("running");
  expect(body).toHaveProperty("retrying");
  expect(body).toHaveProperty("codex_totals"); // backward-compat alias
  expect(body).toHaveProperty("claude_totals");
});

test("GET /api/v1/:identifier returns 404 with envelope when unknown", async () => {
  const deps = baseDeps();
  const res = await handleRequest(new Request("http://x/api/v1/UNKNOWN-1"), deps);
  expect(res.status).toBe(404);
  const body = await res.json();
  expect(body.error.code).toBe("issue_not_found");
});

test("POST /api/v1/refresh returns 202", async () => {
  const deps = baseDeps();
  const res = await handleRequest(new Request("http://x/api/v1/refresh", { method: "POST" }), deps);
  expect(res.status).toBe(202);
  const body = await res.json();
  expect(body.queued).toBe(true);
});

test("PUT /api/v1/state returns 405", async () => {
  const deps = baseDeps();
  const res = await handleRequest(new Request("http://x/api/v1/state", { method: "PUT" }), deps);
  expect(res.status).toBe(405);
});

test("unknown route returns 404 with envelope", async () => {
  const deps = baseDeps();
  const res = await handleRequest(new Request("http://x/api/v1/nonsense/path"), deps);
  expect(res.status).toBe(404);
  const body = await res.json();
  expect(body.error.code).toBe("not_found");
});
```

- [ ] **Step 2: Verify fail**

Run: `bun test packages/dalang/tests/http/routes.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement snapshot**

```ts
// packages/dalang/src/http/snapshot.ts
import type { OrchestratorState } from "../types";

export function buildStateSnapshot(state: OrchestratorState): unknown {
  const running = Array.from(state.running.values()).map((entry) => ({
    issue_id: entry.issue.id,
    issue_identifier: entry.issue.identifier,
    state: entry.issue.state,
    session_id: entry.session?.session_id ?? null,
    turn_count: entry.session?.turn_count ?? 0,
    last_event: entry.session?.last_event ?? null,
    last_message: entry.session?.last_message ?? "",
    started_at: entry.started_at,
    last_event_at: entry.session?.last_event_at ?? null,
    tokens: {
      input_tokens: entry.session?.input_tokens ?? 0,
      output_tokens: entry.session?.output_tokens ?? 0,
      total_tokens: entry.session?.total_tokens ?? 0,
    },
  }));
  const retrying = Array.from(state.retry_attempts.values()).map((r) => ({
    issue_id: r.issue_id,
    issue_identifier: r.identifier,
    attempt: r.attempt,
    due_at: new Date(r.due_at_ms).toISOString(),
    error: r.error,
  }));
  return {
    generated_at: new Date().toISOString(),
    counts: { running: running.length, retrying: retrying.length },
    running,
    retrying,
    claude_totals: state.claude_totals,
    codex_totals: state.claude_totals, // alias for Symphony API compatibility
    rate_limits: state.rate_limits,
  };
}

export function buildIssueSnapshot(state: OrchestratorState, identifier: string): unknown | null {
  for (const entry of state.running.values()) {
    if (entry.issue.identifier === identifier) {
      return {
        issue_identifier: entry.issue.identifier,
        issue_id: entry.issue.id,
        status: "running",
        workspace: { path: entry.workspace_path },
        attempts: { current_retry_attempt: entry.retry_attempt ?? 0 },
        running: {
          session_id: entry.session?.session_id ?? null,
          turn_count: entry.session?.turn_count ?? 0,
          state: entry.issue.state,
          started_at: entry.started_at,
          last_event: entry.session?.last_event ?? null,
          last_message: entry.session?.last_message ?? "",
          last_event_at: entry.session?.last_event_at ?? null,
          tokens: {
            input_tokens: entry.session?.input_tokens ?? 0,
            output_tokens: entry.session?.output_tokens ?? 0,
            total_tokens: entry.session?.total_tokens ?? 0,
          },
        },
        retry: null,
        last_error: null,
        recent_events: [],
        tracked: {},
      };
    }
  }
  for (const r of state.retry_attempts.values()) {
    if (r.identifier === identifier) {
      return {
        issue_identifier: r.identifier,
        issue_id: r.issue_id,
        status: "retrying",
        workspace: null,
        attempts: { current_retry_attempt: r.attempt },
        running: null,
        retry: { attempt: r.attempt, due_at: new Date(r.due_at_ms).toISOString(), error: r.error },
        last_error: r.error,
        recent_events: [],
        tracked: {},
      };
    }
  }
  return null;
}
```

- [ ] **Step 4: Implement routes**

```ts
// packages/dalang/src/http/routes.ts
import type { OrchestratorState } from "../types";
import { buildStateSnapshot, buildIssueSnapshot } from "./snapshot";

export interface RouteDeps {
  state: OrchestratorState;
  refresh: () => Promise<void>;
}

function envelope(code: string, message: string, status: number): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function json(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function handleRequest(req: Request, deps: RouteDeps): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method.toUpperCase();

  if (path === "/api/v1/state") {
    if (method !== "GET") return new Response(null, { status: 405 });
    return json(buildStateSnapshot(deps.state));
  }

  if (path === "/api/v1/refresh") {
    if (method !== "POST") return new Response(null, { status: 405 });
    void deps.refresh().catch(() => {});
    return json({
      queued: true,
      coalesced: false,
      requested_at: new Date().toISOString(),
      operations: ["poll", "reconcile"],
    }, 202);
  }

  // /api/v1/:identifier
  const m = path.match(/^\/api\/v1\/([^/]+)$/);
  if (m) {
    if (method !== "GET") return new Response(null, { status: 405 });
    const identifier = decodeURIComponent(m[1]!);
    if (identifier === "state" || identifier === "refresh") {
      return envelope("not_found", `unknown route ${path}`, 404);
    }
    const snap = buildIssueSnapshot(deps.state, identifier);
    if (!snap) return envelope("issue_not_found", `no in-memory entry for ${identifier}`, 404);
    return json(snap);
  }

  return envelope("not_found", `unknown route ${path}`, 404);
}
```

- [ ] **Step 5: Verify pass**

Run: `bun test packages/dalang/tests/http/routes.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/dalang/src/http/snapshot.ts packages/dalang/src/http/routes.ts packages/dalang/tests/http/routes.test.ts
git commit -m "feat(dalang): HTTP routes, snapshot builder, error envelope"
```

---

### Task 26: HTTP server + dashboard

**Files:**
- Create: `packages/dalang/src/http/dashboard.ts`
- Create: `packages/dalang/src/http/server.ts`
- Create: `packages/dalang/tests/http/server.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/dalang/tests/http/server.test.ts
import { test, expect } from "bun:test";
import { startServer } from "../../src/http/server";
import { createInitialState } from "../../src/orchestrator/state";

test("dashboard at / returns HTML 200 and includes counts", async () => {
  const state = createInitialState({ poll_interval_ms: 30000, max_concurrent_agents: 4 });
  const srv = startServer({
    state, refresh: async () => {},
    host: "127.0.0.1", port: 0,
  });
  const res = await fetch(`http://127.0.0.1:${srv.port}/`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")?.startsWith("text/html")).toBe(true);
  const text = await res.text();
  expect(text).toContain("dalang");
  srv.stop();
});

test("server binds 127.0.0.1 by default", async () => {
  const state = createInitialState({ poll_interval_ms: 30000, max_concurrent_agents: 4 });
  const srv = startServer({ state, refresh: async () => {}, port: 0 });
  expect(srv.hostname).toBe("127.0.0.1");
  srv.stop();
});
```

- [ ] **Step 2: Verify fail**

Run: `bun test packages/dalang/tests/http/server.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement dashboard**

```ts
// packages/dalang/src/http/dashboard.ts
import type { OrchestratorState } from "../types";

export function renderDashboardHtml(state: OrchestratorState): string {
  const running = Array.from(state.running.values());
  const retrying = Array.from(state.retry_attempts.values());

  const rows = (cells: string[][]) => cells
    .map((row) => `<tr>${row.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`)
    .join("");

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>dalang</title>
<style>
body { font: 14px system-ui, sans-serif; margin: 1rem; }
table { border-collapse: collapse; margin-bottom: 1rem; }
th, td { border: 1px solid #ccc; padding: 4px 8px; text-align: left; }
th { background: #f3f3f3; }
h1, h2 { margin: 0.5rem 0; }
</style></head><body>
<h1>dalang</h1>
<p>running=${running.length} retrying=${retrying.length} input_tokens=${state.claude_totals.input_tokens} output_tokens=${state.claude_totals.output_tokens} total_tokens=${state.claude_totals.total_tokens}</p>
<h2>Running</h2>
<table><thead><tr><th>Issue</th><th>State</th><th>Session</th><th>Turn</th><th>Last event</th></tr></thead>
<tbody>${rows(running.map((e) => [
  e.issue.identifier, e.issue.state,
  e.session?.session_id ?? "—", String(e.session?.turn_count ?? 0),
  e.session?.last_event ?? "—",
]))}</tbody></table>
<h2>Retrying</h2>
<table><thead><tr><th>Issue</th><th>Attempt</th><th>Due</th><th>Error</th></tr></thead>
<tbody>${rows(retrying.map((r) => [
  r.identifier, String(r.attempt),
  new Date(r.due_at_ms).toISOString(), r.error ?? "—",
]))}</tbody></table>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
```

- [ ] **Step 4: Implement server**

```ts
// packages/dalang/src/http/server.ts
import type { OrchestratorState } from "../types";
import { handleRequest } from "./routes";
import { renderDashboardHtml } from "./dashboard";

export interface ServerOptions {
  state: OrchestratorState;
  refresh: () => Promise<void>;
  host?: string;
  port: number;
}

export interface ServerHandle {
  port: number;
  hostname: string;
  stop: () => void;
}

export function startServer(opts: ServerOptions): ServerHandle {
  const host = opts.host ?? "127.0.0.1";
  const server = Bun.serve({
    hostname: host,
    port: opts.port,
    fetch: async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/") {
        return new Response(renderDashboardHtml(opts.state), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      return handleRequest(req, { state: opts.state, refresh: opts.refresh });
    },
  });
  return {
    port: server.port,
    hostname: host,
    stop: () => { server.stop(); },
  };
}
```

- [ ] **Step 5: Verify pass**

Run: `bun test packages/dalang/tests/http/server.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/dalang/src/http/dashboard.ts packages/dalang/src/http/server.ts packages/dalang/tests/http/server.test.ts
git commit -m "feat(dalang): HTTP server with HTML dashboard"
```

---

## Phase I — CLI + entrypoint (Tasks 27–28)

### Task 27: CLI argument parsing

**Files:**
- Create: `packages/dalang/src/cli/args.ts`
- Create: `packages/dalang/tests/cli/args.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/dalang/tests/cli/args.test.ts
import { test, expect } from "bun:test";
import { parseArgs } from "../../src/cli/args";

test("default workflow path is ./WORKFLOW.md", () => {
  expect(parseArgs([])).toEqual({ workflowPath: "./WORKFLOW.md", port: null });
});

test("positional arg sets workflowPath", () => {
  expect(parseArgs(["custom/WF.md"])).toEqual({ workflowPath: "custom/WF.md", port: null });
});

test("--port overrides", () => {
  expect(parseArgs(["--port", "8080"])).toEqual({ workflowPath: "./WORKFLOW.md", port: 8080 });
});

test("positional + --port together", () => {
  expect(parseArgs(["./x.md", "--port", "0"])).toEqual({ workflowPath: "./x.md", port: 0 });
});

test("rejects unknown flag", () => {
  expect(() => parseArgs(["--unknown"])).toThrow();
});

test("rejects --port without value", () => {
  expect(() => parseArgs(["--port"])).toThrow();
});
```

- [ ] **Step 2: Verify fail**

Run: `bun test packages/dalang/tests/cli/args.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/dalang/src/cli/args.ts
export interface ParsedArgs {
  workflowPath: string;
  port: number | null;
}

export function parseArgs(argv: string[]): ParsedArgs {
  let workflowPath: string | null = null;
  let port: number | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--port") {
      const v = argv[++i];
      if (v === undefined) throw new Error("--port requires a value");
      const n = Number.parseInt(v, 10);
      if (!Number.isInteger(n) || n < 0) throw new Error(`invalid --port value: ${v}`);
      port = n;
      continue;
    }
    if (a.startsWith("--")) throw new Error(`unknown flag: ${a}`);
    if (workflowPath !== null) throw new Error(`unexpected positional argument: ${a}`);
    workflowPath = a;
  }
  return { workflowPath: workflowPath ?? "./WORKFLOW.md", port };
}
```

- [ ] **Step 4: Verify pass**

Run: `bun test packages/dalang/tests/cli/args.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/dalang/src/cli/args.ts packages/dalang/tests/cli/args.test.ts
git commit -m "feat(dalang): CLI argument parser"
```

---

### Task 28: Process bootstrap (`src/index.ts`)

**Files:**
- Modify: `packages/dalang/src/index.ts` (replace placeholder)
- Create: `packages/dalang/tests/cli/bootstrap.test.ts` (smoke)

- [ ] **Step 1: Write smoke test**

```ts
// packages/dalang/tests/cli/bootstrap.test.ts
import { test, expect } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Bootstrap } from "../../src/cli/bootstrap";

const VALID = `---
tracker:
  endpoint: http://localhost:9999
  active_states: [Todo]
  terminal_states: [Done]
workspace:
  root: $WS_ROOT
agent:
  max_concurrent_agents: 1
---
Body for {{ issue.identifier }}.`;

test("loads workflow, validates, starts and stops cleanly", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dalang-boot-"));
  process.env.WS_ROOT = join(dir, "ws");
  const path = join(dir, "WORKFLOW.md");
  await writeFile(path, VALID, "utf8");
  const boot = new Bootstrap({ workflowPath: path, port: 0, skipAuthProbe: true,
    runQueryFactory: () => async function* () {
      yield { type: "system", subtype: "init", session_id: "s" };
      yield { type: "result", subtype: "success", usage: {} };
    },
  });
  await boot.start();
  expect(boot.serverPort()).toBeGreaterThan(0);
  await boot.stop();
});
```

- [ ] **Step 2: Verify fail**

Run: `bun test packages/dalang/tests/cli/bootstrap.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement bootstrap module**

Create `packages/dalang/src/cli/bootstrap.ts`:

```ts
// packages/dalang/src/cli/bootstrap.ts
import { resolve } from "node:path";
import { WorkflowReloader } from "../config/reload";
import { validateForDispatch, probeClaudeAuth, ValidationError } from "../config/validate";
import { resolveTrackerApiKey, Orchestrator } from "../orchestrator/orchestrator";
import { RestTrackerAdapter } from "../tracker/rest-adapter";
import { sdkRunQuery } from "../agent/sdk-runner";
import { startServer, type ServerHandle } from "../http/server";
import { createLogger, type Logger } from "../logging/logger";
import type { RunQuery } from "../agent/agent-runner";

export interface BootstrapOptions {
  workflowPath: string;
  port: number | null;
  skipAuthProbe?: boolean;
  runQueryFactory?: () => RunQuery;
  logger?: Logger;
}

export class Bootstrap {
  private reloader: WorkflowReloader;
  private orch: Orchestrator | null = null;
  private server: ServerHandle | null = null;
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly opts: BootstrapOptions;
  private readonly log: Logger;

  constructor(opts: BootstrapOptions) {
    this.opts = opts;
    this.log = opts.logger ?? createLogger({ name: "dalang", level: "info" });
    this.reloader = new WorkflowReloader(opts.workflowPath);
  }

  serverPort(): number { return this.server?.port ?? 0; }

  async start(): Promise<void> {
    await this.reloader.start();
    const wf = this.reloader.current();
    validateForDispatch(wf.config);
    if (!this.opts.skipAuthProbe) {
      const err = await probeClaudeAuth(wf.config.claude.executable_path);
      if (err) throw new ValidationError("claude_auth_inactive", err);
    }
    const tracker = new RestTrackerAdapter({
      endpoint: wf.config.tracker.endpoint,
      apiKey: resolveTrackerApiKey(wf.config.tracker.api_key ?? null),
    });
    const runQuery = this.opts.runQueryFactory ? this.opts.runQueryFactory() : sdkRunQuery;
    this.orch = new Orchestrator({
      tracker, config: wf.config, promptTemplate: wf.promptTemplate,
      runQuery, logger: this.log,
    });
    this.reloader.onReload((next) => {
      try { validateForDispatch(next.config); }
      catch (err) {
        this.log.warn({ err: (err as Error).message }, "workflow reload failed validation");
        return;
      }
      this.orch?.updateConfig(next.config, next.promptTemplate);
    });
    this.reloader.onError((err) => this.log.warn({ err: err.message }, "workflow reload error"));
    const port = this.opts.port ?? wf.config.server.port;
    this.server = startServer({
      state: this.orch.state,
      refresh: async () => { await this.orch?.tick(); },
      port,
    });
    this.scheduleTick(0);
  }

  private scheduleTick(delayMs: number): void {
    this.tickTimer = setTimeout(async () => {
      try {
        await this.reloader.checkMtimeReload();
        await this.orch?.tick();
      } catch (err) {
        this.log.error({ err: (err as Error).message }, "tick failed");
      }
      this.scheduleTick(this.orch?.state.poll_interval_ms ?? 30000);
    }, delayMs);
  }

  async stop(): Promise<void> {
    if (this.tickTimer) clearTimeout(this.tickTimer);
    this.server?.stop();
    await this.reloader.stop();
    await this.orch?.drainPendingForTest();
  }
}
```

- [ ] **Step 4: Replace `packages/dalang/src/index.ts`**

```ts
// packages/dalang/src/index.ts
import { parseArgs } from "./cli/args";
import { Bootstrap } from "./cli/bootstrap";
import { createLogger } from "./logging/logger";

const log = createLogger({ name: "dalang", level: "info" });
const args = parseArgs(Bun.argv.slice(2));
const boot = new Bootstrap({ workflowPath: args.workflowPath, port: args.port });

const shutdown = async () => {
  log.info("shutting down");
  await boot.stop();
  process.exit(0);
};

process.on("SIGINT", () => { void shutdown(); });
process.on("SIGTERM", () => { void shutdown(); });

try {
  await boot.start();
  log.info({ port: boot.serverPort(), workflow: args.workflowPath }, "dalang started");
} catch (err) {
  log.error({ err: (err as Error).message }, "startup failed");
  process.exit(1);
}
```

- [ ] **Step 5: Verify pass**

Run: `bun test packages/dalang/tests/cli/bootstrap.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 6: Commit**

```bash
git add packages/dalang/src/cli/bootstrap.ts packages/dalang/src/index.ts packages/dalang/tests/cli/bootstrap.test.ts
git commit -m "feat(dalang): process bootstrap and CLI entrypoint"
```

---

## Phase J — Verification (Task 29)

### Task 29: Final harness verification + integration smoke

- [ ] **Step 1: Full typecheck**

Run: `bun run typecheck`
Expected: no errors across the entire workspace.

- [ ] **Step 2: Lint**

Run: `bun run lint`
Expected: no errors.

- [ ] **Step 3: Format check**

Run: `bun run format:check`
Expected: no diff.

- [ ] **Step 4: Run all tests**

Run: `bun test`
Expected: every test in `packages/dalang/tests/**` passes.

- [ ] **Step 5: Manual integration smoke (optional, requires `claude` auth and a running wayang)**

Create `WORKFLOW.md` at the repo root:

```yaml
---
tracker:
  endpoint: http://localhost:3001
  active_states: [Todo, "In Progress"]
  terminal_states: [Done, Cancelled]
workspace:
  root: ~/.dalang/workspaces
agent:
  max_concurrent_agents: 1
  max_turns: 3
---
You are picking up issue {{ issue.identifier }}: {{ issue.title }}.
Read the description, plan briefly, then proceed.
```

Run (in a separate terminal with wayang running):
```bash
bun run packages/dalang/src/index.ts ./WORKFLOW.md --port 7474
```

Verify in browser at `http://127.0.0.1:7474/`:
- Dashboard loads.
- `/api/v1/state` returns running/retrying counts.

Stop with Ctrl+C; expect clean shutdown ("dalang stopping" log line).

- [ ] **Step 6: Commit verification artifacts**

```bash
# If WORKFLOW.md was created at root for the smoke test, decide whether to commit.
git status
# Only commit non-secret config; do not commit ~/.dalang
```

---

## Self-Review Checklist (post-write)

Run after the plan is committed:

1. **Spec coverage:** verify every DoD item from spec §17 has a corresponding task above.
2. **No placeholders:** search for `TODO`, `TBD`, `implement later`, `add appropriate` in this plan; none should remain.
3. **Type consistency:** spot-check that types used across tasks match (e.g. `RunningEntry`, `NormalizedIssue`, `RuntimeEvent`, `WorkflowFrontMatter`).

---

## Summary of tasks

| #  | Task                                                  |
| -- | ----------------------------------------------------- |
| 1  | Initialize bun workspace, lint, format, typecheck     |
| 2  | Define core domain types                              |
| 3  | Workspace key sanitization                            |
| 4  | Env and path resolver                                 |
| 5  | Workflow front matter schema                          |
| 6  | Workflow loader                                       |
| 7  | Hot reload + mtime defensive reload                   |
| 8  | Preflight validation + claude auth probe              |
| 9  | Prompt builder (Liquid + metadata header)             |
| 10 | Tracker adapter interface                             |
| 11 | Defensive issue normalization                         |
| 12 | REST adapter (wayang client)                          |
| 13 | Hook executor                                         |
| 14 | Workspace manager (no-repo path)                      |
| 15 | Git worktree extension                                |
| 16 | Orchestrator state operations                         |
| 17 | Eligibility filtering and dispatch sorting            |
| 18 | Retry scheduling                                      |
| 19 | Reconciliation primitives                             |
| 20 | SDK message → runtime event mapper                    |
| 21 | Agent runner (multi-turn driver)                      |
| 22 | Real SDK adapter for `runQuery`                       |
| 23 | Structured logger                                     |
| 24 | Orchestrator main loop composition                    |
| 25 | HTTP routes + snapshot builder                        |
| 26 | HTTP server + dashboard                               |
| 27 | CLI argument parsing                                  |
| 28 | Process bootstrap + entrypoint                        |
| 29 | Final harness verification + integration smoke        |








