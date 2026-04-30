# Control Plane + GitHub Projects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Dalang's Wayang-specific tracker boundary with a capability-based control-plane boundary, then add a GitHub Projects v2 control-plane adapter with ownership filtering and PR-check reconciliation.

**Architecture:** Keep Dalang's scheduler and agent execution generic. Introduce `ControlPlaneAdapter` as the only external work-control interface, preserve Wayang behavior through a renamed adapter, then add a GitHub Projects adapter that owns GitHub GraphQL mapping, ownership filtering, comments, status updates, and PR-check workflow.

**Tech Stack:** Bun, TypeScript, Zod, Bun test, GitHub GraphQL over `fetch`, existing `gh` helper for Wayang PR-check compatibility.

---

## File Structure

Create:

- `packages/dalang/src/control-plane/adapter.ts` - control-plane interface, capabilities, ownership, and error types.
- `packages/dalang/src/control-plane/normalize.ts` - normalized work-item coercion, moved from tracker naming.
- `packages/dalang/src/control-plane/wayang-adapter.ts` - renamed REST adapter for Wayang.
- `packages/dalang/src/control-plane/factory.ts` - config-to-adapter creation.
- `packages/dalang/src/control-plane/github/client.ts` - small GitHub GraphQL/REST client wrapper.
- `packages/dalang/src/control-plane/github/types.ts` - GitHub response types and adapter config helpers.
- `packages/dalang/src/control-plane/github/adapter.ts` - GitHub Projects v2 `ControlPlaneAdapter`.
- `packages/dalang/src/control-plane/github/normalize.ts` - GitHub project item to `WorkItem` mapping and ownership predicates.
- `packages/dalang/src/control-plane/github/pr-checks.ts` - GitHub-native PR-check reconciliation.
- `packages/dalang/tests/control-plane/normalize.test.ts`
- `packages/dalang/tests/control-plane/wayang-adapter.test.ts`
- `packages/dalang/tests/control-plane/factory.test.ts`
- `packages/dalang/tests/control-plane/github/client.test.ts`
- `packages/dalang/tests/control-plane/github/normalize.test.ts`
- `packages/dalang/tests/control-plane/github/adapter.test.ts`
- `packages/dalang/tests/control-plane/github/pr-checks.test.ts`

Modify:

- `packages/dalang/src/types.ts` - rename exported issue/comment/history types to work-item/control-plane names, keeping aliases during migration.
- `packages/dalang/src/config/schema.ts` - add `control_plane` schema, GitHub Projects schema, ownership schema, and `tracker` compatibility alias.
- `packages/dalang/src/config/validate.ts` - validate ownership, GitHub token env, PR-check capability, and control-plane kind.
- `packages/dalang/src/config/workflow-loader.ts` - ensure alias normalization happens after front matter parse.
- `packages/dalang/src/cli/bootstrap.ts` - build the control-plane adapter through the factory.
- `packages/dalang/src/orchestrator/orchestrator.ts` - use control-plane names and capability-based PR checks.
- `packages/dalang/src/orchestrator/pr-checks-runner.ts` - keep as Wayang-compatible helper, no longer called directly by orchestrator.
- `packages/dalang/src/agent/agent-runner.ts` - rename tracker prompt context to control-plane prompt context.
- `packages/dalang/src/agent/prompt-builder.ts` - expose `control_plane` in Liquid context, keep `tracker` alias for one migration release.
- `packages/dalang/tests/config/schema.test.ts`
- `packages/dalang/tests/config/validate.test.ts`
- `packages/dalang/tests/config/workflow-loader.test.ts`
- `packages/dalang/tests/cli/bootstrap.test.ts`
- `packages/dalang/tests/orchestrator/orchestrator.test.ts`
- `packages/dalang/tests/orchestrator/pr-checks-runner.test.ts`
- `packages/dalang/tests/agent/agent-runner.test.ts`
- `packages/dalang/tests/agent/prompt-builder.test.ts`
- `docs/superpowers/specs/2026-04-29-dalang-orchestrator-design.md`
- `docs/superpowers/specs/2026-04-30-pr-checks-wait-design.md`
- `README.md`

Delete after replacement:

- `packages/dalang/src/tracker/adapter.ts`
- `packages/dalang/src/tracker/normalize.ts`
- `packages/dalang/src/tracker/rest-adapter.ts`
- `packages/dalang/tests/tracker/normalize.test.ts`
- `packages/dalang/tests/tracker/rest-adapter.test.ts`

---

### Task 1: Introduce Control-Plane Types and Normalization

**Files:**
- Create: `packages/dalang/src/control-plane/adapter.ts`
- Create: `packages/dalang/src/control-plane/normalize.ts`
- Create: `packages/dalang/tests/control-plane/normalize.test.ts`
- Modify: `packages/dalang/src/types.ts`

- [ ] **Step 1: Write failing normalization tests**

Create `packages/dalang/tests/control-plane/normalize.test.ts`:

```ts
import { test, expect } from "bun:test";
import { normalizeWorkItem } from "../../src/control-plane/normalize";

test("normalizeWorkItem accepts a complete work item", () => {
  const got = normalizeWorkItem({
    id: "PVTI_1",
    identifier: "org/repo#12",
    title: "Fix checkout",
    description: "body",
    priority: 2,
    state: "In Dev",
    branch_name: "dalang/12-fix-checkout",
    url: "https://github.com/org/repo/issues/12",
    external_ref: "I_kwDO",
    internal_ref: "org/repo#12",
    labels: ["Dalang", "Bug"],
    blocked_by: [{ id: "i1", identifier: "JUARA-1", state: "Done" }],
    created_at: "2026-04-30T01:02:03.000Z",
    updated_at: "2026-04-30T02:03:04.000Z",
  });

  expect(got).toEqual({
    id: "PVTI_1",
    identifier: "org/repo#12",
    title: "Fix checkout",
    description: "body",
    priority: 2,
    state: "In Dev",
    branch_name: "dalang/12-fix-checkout",
    url: "https://github.com/org/repo/issues/12",
    external_ref: "I_kwDO",
    internal_ref: "org/repo#12",
    labels: ["dalang", "bug"],
    blocked_by: [{ id: "i1", identifier: "JUARA-1", state: "Done" }],
    created_at: "2026-04-30T01:02:03.000Z",
    updated_at: "2026-04-30T02:03:04.000Z",
  });
});

test("normalizeWorkItem rejects malformed required fields", () => {
  expect(normalizeWorkItem({ id: "x", title: "missing identifier", state: "Todo" })).toBeNull();
  expect(normalizeWorkItem(null)).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/dalang/tests/control-plane/normalize.test.ts`

Expected: FAIL with an import error for `../../src/control-plane/normalize`.

- [ ] **Step 3: Add control-plane adapter contract**

Create `packages/dalang/src/control-plane/adapter.ts`:

```ts
import type { ControlPlaneComment, ControlPlaneHistoryEntry, WorkItem } from "../types";

export type OwnershipRule =
  | { mode: "none"; allow_unowned_dispatch?: boolean | undefined }
  | { mode: "label"; value: string }
  | { mode: "assignee"; value: string }
  | { mode: "project_field"; field: string; value: string };

export interface DispatchQuery {
  activeStates: string[];
  ownership: OwnershipRule;
}

export interface ControlPlaneCapabilities {
  history?: true;
  prChecks?: true;
}

export interface PrChecksReconcileArgs {
  work: WorkItem[];
  config: {
    enabled: boolean;
    poll_interval_ms: number;
    failure_budget: number;
    rerun_flakes: boolean;
    gh_executable?: string | undefined;
    wait_state?: string | undefined;
    pass_state?: string | undefined;
    fail_state?: string | undefined;
    escalation_state?: string | undefined;
  };
  repoCwd: string;
  now: () => Date;
}

export interface ControlPlaneAdapter {
  capabilities: ControlPlaneCapabilities;
  fetchDispatchableWork(query: DispatchQuery): Promise<WorkItem[]>;
  fetchWorkByStates(states: string[]): Promise<WorkItem[]>;
  refreshWork(ids: string[]): Promise<WorkItem[]>;
  fetchWorkItem(id: string): Promise<WorkItem | null>;
  listComments(workItemId: string): Promise<ControlPlaneComment[]>;
  listHistory?(workItemId: string): Promise<ControlPlaneHistoryEntry[]>;
  addComment(workItemId: string, body: string, author?: "user" | "agent"): Promise<void>;
  updateState(workItemId: string, state: string): Promise<void>;
  reconcilePrChecks?(args: PrChecksReconcileArgs): Promise<void>;
}

export type ControlPlaneErrorCode =
  | "control_plane_request_error"
  | "control_plane_status_error"
  | "control_plane_malformed_payload"
  | "control_plane_missing_pagination_cursor"
  | "control_plane_write_error"
  | "control_plane_validation_error";

export class ControlPlaneError extends Error {
  code: ControlPlaneErrorCode;
  constructor(code: ControlPlaneErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
```

- [ ] **Step 4: Add work-item type aliases during migration**

Modify `packages/dalang/src/types.ts` so the top issue/comment/history types become:

```ts
export interface BlockerRef {
  id: string | null;
  identifier: string | null;
  state: string | null;
}

export interface WorkItem {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  priority: number | null;
  state: string;
  branch_name: string | null;
  url: string | null;
  external_ref: string | null;
  internal_ref: string | null;
  labels: string[];
  blocked_by: BlockerRef[];
  created_at: string | null;
  updated_at: string | null;
}

export type NormalizedIssue = WorkItem;

export interface ControlPlaneComment {
  id: string;
  author: string | null;
  body: string;
  created_at: string;
}

export type TrackerComment = ControlPlaneComment;

export type ControlPlaneHistoryKind =
  | "created"
  | "state_changed"
  | "edited"
  | "comment_added"
  | "deleted";

export type TrackerHistoryKind = ControlPlaneHistoryKind;

export interface ControlPlaneHistoryEntry {
  id: string;
  issue_id: string;
  kind: ControlPlaneHistoryKind;
  from_value: string | null;
  to_value: string | null;
  actor: "user" | "agent";
  at: string;
}

export type TrackerHistoryEntry = ControlPlaneHistoryEntry;
```

Leave the rest of `types.ts` unchanged for this task.

- [ ] **Step 5: Add normalized work-item coercion**

Create `packages/dalang/src/control-plane/normalize.ts`:

```ts
import type { BlockerRef, WorkItem } from "../types";

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

export function normalizeWorkItem(raw: unknown): WorkItem | null {
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
    external_ref: isString(r.external_ref) ? r.external_ref : null,
    internal_ref: isString(r.internal_ref) ? r.internal_ref : null,
    labels: coerceLabels(r.labels),
    blocked_by: coerceBlockers(r.blocked_by),
    created_at: coerceTimestamp(r.created_at),
    updated_at: coerceTimestamp(r.updated_at),
  };
}

export const normalizeIssue = normalizeWorkItem;
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test packages/dalang/tests/control-plane/normalize.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/dalang/src/control-plane/adapter.ts packages/dalang/src/control-plane/normalize.ts packages/dalang/src/types.ts packages/dalang/tests/control-plane/normalize.test.ts
git commit -m "feat(dalang): introduce control plane types"
```

---

### Task 2: Add Control-Plane Config and Ownership Validation

**Files:**
- Modify: `packages/dalang/src/config/schema.ts`
- Modify: `packages/dalang/src/config/validate.ts`
- Modify: `packages/dalang/src/config/workflow-loader.ts`
- Modify: `packages/dalang/tests/config/schema.test.ts`
- Modify: `packages/dalang/tests/config/validate.test.ts`
- Modify: `packages/dalang/tests/config/workflow-loader.test.ts`

- [ ] **Step 1: Write failing schema tests**

Append to `packages/dalang/tests/config/schema.test.ts`:

```ts
test("applyDefaults exposes control_plane and tracker compatibility alias", () => {
  const cfg = applyDefaults({});
  expect(cfg.control_plane.kind).toBe("wayang");
  expect(cfg.control_plane.active_states).toContain("In Dev");
  expect(cfg.control_plane.ownership).toEqual({ mode: "none" });
  expect(cfg.tracker.kind).toBe("tok-juara");
});

test("accepts github-projects control plane with label ownership", () => {
  const cfg = applyDefaults({
    control_plane: {
      kind: "github-projects",
      owner_type: "organization",
      owner: "acme",
      project_number: 7,
      repository: "acme/app",
      token: "$GITHUB_TOKEN",
      status_field: "Status",
      active_states: ["Todo", "In Dev"],
      terminal_states: ["Done"],
      ownership: { mode: "label", value: "dalang" },
      branch_field: "Branch",
      pr_checks: {
        enabled: true,
        poll_interval_ms: 60000,
        failure_budget: 3,
        rerun_flakes: true,
        wait_state: "Waiting PR Checks",
        pass_state: "Ready for Human Review",
        fail_state: "In Dev",
        escalation_state: "Ready for Human Review",
      },
    },
  });
  const parsed = WorkflowFrontMatterSchema.parse(cfg);
  expect(parsed.control_plane.kind).toBe("github-projects");
});

test("maps legacy tracker input to wayang control_plane", () => {
  const cfg = applyDefaults({
    tracker: {
      kind: "tok-juara",
      endpoint: "http://localhost:3009",
      api_key: null,
      active_states: ["Todo"],
      terminal_states: ["Done"],
    },
  });
  expect(cfg.control_plane).toMatchObject({
    kind: "wayang",
    endpoint: "http://localhost:3009",
    active_states: ["Todo"],
    terminal_states: ["Done"],
  });
});
```

Append to `packages/dalang/tests/config/validate.test.ts`:

```ts
test("rejects github-projects control plane without ownership", () => {
  const cfg = applyDefaults({
    control_plane: {
      kind: "github-projects",
      owner_type: "organization",
      owner: "acme",
      project_number: 1,
      repository: "acme/app",
      token: "literal-token",
      status_field: "Status",
      active_states: ["Todo"],
      terminal_states: ["Done"],
      ownership: { mode: "none" },
    },
  });
  expect(() => validateForDispatch(cfg)).toThrow(/ownership/i);
});

test("allows explicit unowned github-projects dispatch", () => {
  const cfg = applyDefaults({
    control_plane: {
      kind: "github-projects",
      owner_type: "organization",
      owner: "acme",
      project_number: 1,
      repository: "acme/app",
      token: "literal-token",
      status_field: "Status",
      active_states: ["Todo"],
      terminal_states: ["Done"],
      ownership: { mode: "none", allow_unowned_dispatch: true },
    },
  });
  expect(() => validateForDispatch(cfg)).not.toThrow();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/dalang/tests/config/schema.test.ts packages/dalang/tests/config/validate.test.ts`

Expected: FAIL because `control_plane` schemas do not exist.

- [ ] **Step 3: Implement schema unions and default mapping**

Modify `packages/dalang/src/config/schema.ts`. Add these schemas near the existing tracker schema:

```ts
export const OwnershipSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("none"),
    allow_unowned_dispatch: z.boolean().optional(),
  }),
  z.object({
    mode: z.literal("label"),
    value: z.string().min(1),
  }),
  z.object({
    mode: z.literal("assignee"),
    value: z.string().min(1),
  }),
  z.object({
    mode: z.literal("project_field"),
    field: z.string().min(1),
    value: z.string().min(1),
  }),
]);

export const WayangControlPlaneSchema = z.object({
  kind: z.literal("wayang"),
  endpoint: z.string().url(),
  api_key: z.string().nullable().optional(),
  board: z.string().nullable().optional(),
  active_states: z.array(z.string()).min(1),
  terminal_states: z.array(z.string()).min(1),
  ownership: OwnershipSchema.default({ mode: "none" }),
});

export const GithubPrChecksSchema = z.object({
  enabled: z.boolean(),
  poll_interval_ms: z.number().int().positive(),
  failure_budget: z.number().int().positive(),
  rerun_flakes: z.boolean(),
  wait_state: z.string().min(1),
  pass_state: z.string().min(1),
  fail_state: z.string().min(1),
  escalation_state: z.string().min(1),
});

export const GithubProjectsControlPlaneSchema = z.object({
  kind: z.literal("github-projects"),
  owner_type: z.enum(["organization", "user"]),
  owner: z.string().min(1),
  project_number: z.number().int().positive(),
  repository: z.string().regex(/^[^/]+\/[^/]+$/, "repository must be owner/name"),
  token: z.string().min(1),
  status_field: z.string().min(1),
  branch_field: z.string().min(1).nullable().optional(),
  active_states: z.array(z.string()).min(1),
  terminal_states: z.array(z.string()).min(1),
  ownership: OwnershipSchema,
  pr_checks: GithubPrChecksSchema.optional(),
});

export const ControlPlaneSchema = z.discriminatedUnion("kind", [
  WayangControlPlaneSchema,
  GithubProjectsControlPlaneSchema,
]);
```

Keep `TrackerSchema` for compatibility but make `RawWorkflowFrontMatterSchema` accept both:

```ts
const RawWorkflowFrontMatterSchema = z.object({
  control_plane: ControlPlaneSchema.optional(),
  tracker: TrackerSchema.optional(),
  repo: RepoSchema,
  polling: PollingSchema,
  workspace: WorkspaceSchema,
  hooks: HooksSchema,
  agent: AgentSchema,
  agent_provider: AgentProvider.default("claude"),
  claude: ClaudeSchema.optional(),
  codex: CodexSchema.optional(),
  opencode: OpencodeSchema.optional(),
  server: ServerSchema,
  pr_checks: PrChecksSchema,
});
```

Add a normalized default:

```ts
const DEFAULTS = {
  control_plane: {
    kind: "wayang",
    endpoint: "http://localhost:3001",
    api_key: null,
    board: null,
    active_states: [
      "Todo",
      "Plan",
      "Review Plan",
      "Ready for Dev",
      "In Dev",
      "Ready for Review",
    ],
    terminal_states: ["Done", "Cancelled"],
    ownership: { mode: "none" },
  },
  tracker: {
    kind: "tok-juara",
    endpoint: "http://localhost:3001",
    api_key: null,
    board: null,
    active_states: [
      "Todo",
      "Plan",
      "Review Plan",
      "Ready for Dev",
      "In Dev",
      "Ready for Review",
    ],
    terminal_states: ["Done", "Cancelled"],
  },
  // keep existing remaining defaults below
};
```

In `applyDefaults`, normalize legacy `tracker` before parsing:

```ts
function trackerToControlPlane(raw: unknown): unknown {
  if (raw === null || typeof raw !== "object") return raw;
  const r = raw as Record<string, unknown>;
  if (r.control_plane) return raw;
  const tracker = r.tracker;
  if (tracker === null || typeof tracker !== "object") return raw;
  const t = tracker as Record<string, unknown>;
  if (t.kind !== "tok-juara") return raw;
  return {
    ...r,
    control_plane: {
      kind: "wayang",
      endpoint: t.endpoint,
      api_key: t.api_key ?? null,
      board: t.board ?? null,
      active_states: t.active_states,
      terminal_states: t.terminal_states,
      ownership: { mode: "none" },
    },
  };
}
```

Call it at the top of `applyDefaults`:

```ts
export function applyDefaults(raw: unknown): WorkflowFrontMatter {
  const normalizedRaw = trackerToControlPlane(raw);
  const provider = ((normalizedRaw as { agent_provider?: string } | null | undefined)?.agent_provider
    ?? DEFAULTS.agent_provider) as "claude" | "codex" | "opencode";
  // existing body uses normalizedRaw instead of raw
  const merged = deepMerge(base as typeof DEFAULTS, normalizedRaw ?? {}) as WorkflowFrontMatter;
  return merged;
}
```

- [ ] **Step 4: Implement validation rules**

Modify `packages/dalang/src/config/validate.ts`:

```ts
export type ValidationCode =
  | "unsupported_control_plane_kind"
  | "unsupported_tracker_kind"
  | "missing_control_plane_api_key"
  | "missing_tracker_api_key"
  | "missing_control_plane_ownership"
  | "missing_claude_executable_path"
  | "missing_codex_executable_path"
  | "missing_opencode_executable_path"
  | "missing_repo_config"
  | "claude_auth_inactive"
  | "codex_auth_inactive"
  | "opencode_auth_inactive"
  | "opencode_provider_not_authed";
```

At the start of `validateForDispatch`, replace tracker-kind-only validation with:

```ts
  const cp = cfg.control_plane;
  if (cp.kind === "wayang") {
    if (cp.api_key !== null && cp.api_key !== undefined) {
      const resolved = resolveEnvValue(cp.api_key);
      if (resolved === null && cp.api_key.startsWith("$")) {
        throw new ValidationError("missing_control_plane_api_key", `control_plane.api_key resolves to empty: ${cp.api_key}`);
      }
    }
  } else if (cp.kind === "github-projects") {
    const resolved = resolveEnvValue(cp.token);
    if (resolved === null && cp.token.startsWith("$")) {
      throw new ValidationError("missing_control_plane_api_key", `control_plane.token resolves to empty: ${cp.token}`);
    }
    if (cp.ownership.mode === "none" && cp.ownership.allow_unowned_dispatch !== true) {
      throw new ValidationError("missing_control_plane_ownership", "github-projects requires ownership or allow_unowned_dispatch=true");
    }
  } else {
    throw new ValidationError("unsupported_control_plane_kind", `unsupported control plane kind: ${(cp as { kind?: string }).kind}`);
  }
```

Keep the legacy `cfg.tracker` check only for compatibility diagnostics:

```ts
  if (cfg.tracker.kind !== "tok-juara") {
    throw new ValidationError("unsupported_tracker_kind", `unsupported tracker kind: ${cfg.tracker.kind}`);
  }
```

- [ ] **Step 5: Update workflow loader test fixture expectations**

In `packages/dalang/tests/config/workflow-loader.test.ts`, add an assertion next to existing tracker assertions:

```ts
expect(wf.config.control_plane.kind).toBe("wayang");
expect(wf.config.control_plane.active_states).toEqual(wf.config.tracker.active_states);
```

- [ ] **Step 6: Run tests**

Run: `bun test packages/dalang/tests/config/schema.test.ts packages/dalang/tests/config/validate.test.ts packages/dalang/tests/config/workflow-loader.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/dalang/src/config/schema.ts packages/dalang/src/config/validate.ts packages/dalang/src/config/workflow-loader.ts packages/dalang/tests/config/schema.test.ts packages/dalang/tests/config/validate.test.ts packages/dalang/tests/config/workflow-loader.test.ts
git commit -m "feat(dalang): add control plane config"
```

---

### Task 3: Rename Wayang REST Adapter and Wire Orchestrator to Control Plane

**Files:**
- Create: `packages/dalang/src/control-plane/wayang-adapter.ts`
- Create: `packages/dalang/tests/control-plane/wayang-adapter.test.ts`
- Modify: `packages/dalang/src/cli/bootstrap.ts`
- Modify: `packages/dalang/src/orchestrator/orchestrator.ts`
- Modify: `packages/dalang/src/orchestrator/reconcile.ts`
- Modify: `packages/dalang/src/orchestrator/eligibility.ts`
- Modify: `packages/dalang/tests/orchestrator/orchestrator.test.ts`
- Modify: `packages/dalang/tests/orchestrator/reconcile.test.ts`
- Delete: `packages/dalang/src/tracker/rest-adapter.ts`
- Delete: `packages/dalang/src/tracker/adapter.ts`
- Delete: `packages/dalang/src/tracker/normalize.ts`
- Delete: `packages/dalang/tests/tracker/rest-adapter.test.ts`
- Delete: `packages/dalang/tests/tracker/normalize.test.ts`

- [ ] **Step 1: Move REST adapter test under control-plane naming**

Copy the full contents of `packages/dalang/tests/tracker/rest-adapter.test.ts` to `packages/dalang/tests/control-plane/wayang-adapter.test.ts`, then make these replacements in the new file:

```ts
import { WayangControlPlaneAdapter } from "../../src/control-plane/wayang-adapter";
```

Replace every `new RestTrackerAdapter(` with:

```ts
new WayangControlPlaneAdapter(
```

Rename these method calls:

```ts
fetchCandidateIssues(["Todo"])
```

to:

```ts
fetchDispatchableWork({ activeStates: ["Todo"], ownership: { mode: "none" } })
```

Rename:

```ts
fetchIssuesByStates(["Todo"])
fetchIssueStatesByIds(["i1", "i2"])
fetchIssue("issue-1")
```

to:

```ts
fetchWorkByStates(["Todo"])
refreshWork(["i1", "i2"])
fetchWorkItem("issue-1")
```

- [ ] **Step 2: Run moved test to verify it fails**

Run: `bun test packages/dalang/tests/control-plane/wayang-adapter.test.ts`

Expected: FAIL with an import error for `wayang-adapter`.

- [ ] **Step 3: Implement Wayang control-plane adapter**

Create `packages/dalang/src/control-plane/wayang-adapter.ts` by moving the old REST adapter implementation and applying these changes:

```ts
import type { ControlPlaneComment, ControlPlaneHistoryEntry, WorkItem } from "../types";
import type { ControlPlaneAdapter, DispatchQuery } from "./adapter";
import { ControlPlaneError } from "./adapter";
import { normalizeWorkItem } from "./normalize";

export interface WayangControlPlaneConfig {
  endpoint: string;
  apiKey: string | null;
  timeoutMs?: number;
}

interface IssuesPage {
  issues: unknown[];
  next_cursor: string | null;
}

export class WayangControlPlaneAdapter implements ControlPlaneAdapter {
  readonly capabilities = { history: true, prChecks: true } as const;
  private readonly endpoint: string;
  private readonly apiKey: string | null;
  private readonly timeoutMs: number;

  constructor(cfg: WayangControlPlaneConfig) {
    this.endpoint = cfg.endpoint.replace(/\/$/, "");
    this.apiKey = cfg.apiKey;
    this.timeoutMs = cfg.timeoutMs ?? 30000;
  }

  private headers(): Record<string, string> {
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
      throw new ControlPlaneError("control_plane_request_error", `${url}: ${(err as Error).message}`);
    } finally {
      clearTimeout(t);
    }
    if (!res.ok) {
      throw new ControlPlaneError("control_plane_status_error", `${url}: HTTP ${res.status}`);
    }
    try {
      return await res.json();
    } catch (err) {
      throw new ControlPlaneError("control_plane_malformed_payload", `${url}: ${(err as Error).message}`);
    }
  }

  async fetchDispatchableWork(query: DispatchQuery): Promise<WorkItem[]> {
    return this.fetchPaginated(query.activeStates);
  }

  async fetchWorkByStates(states: string[]): Promise<WorkItem[]> {
    if (states.length === 0) return [];
    return this.fetchPaginated(states);
  }

  async refreshWork(ids: string[]): Promise<WorkItem[]> {
    if (ids.length === 0) return [];
    const params = new URLSearchParams();
    for (const id of ids) params.append("id", id);
    const body = await this.getJson(`/api/v1/issues/by-ids?${params.toString()}`);
    if (body === null || typeof body !== "object" || !Array.isArray((body as { issues?: unknown }).issues)) {
      throw new ControlPlaneError("control_plane_malformed_payload", "by-ids: expected { issues: [] }");
    }
    return (body as { issues: unknown[] }).issues.flatMap((raw) => {
      const n = normalizeWorkItem(raw);
      return n ? [n] : [];
    });
  }

  async fetchWorkItem(id: string): Promise<WorkItem | null> {
    const body = await this.getJson(`/api/v1/issues/${encodeURIComponent(id)}`);
    return normalizeWorkItem(body);
  }

  async listComments(workItemId: string): Promise<ControlPlaneComment[]> {
    const path = `/api/v1/issues/${encodeURIComponent(workItemId)}/comments`;
    const data = await this.getJson(path);
    if (typeof data !== "object" || data === null || !Array.isArray((data as { comments?: unknown }).comments)) {
      throw new ControlPlaneError("control_plane_malformed_payload", `${this.endpoint}${path}: comments not array`);
    }
    return (data as { comments: ControlPlaneComment[] }).comments;
  }

  async listHistory(workItemId: string): Promise<ControlPlaneHistoryEntry[]> {
    const path = `/api/v1/issues/${encodeURIComponent(workItemId)}/history`;
    const data = await this.getJson(path);
    if (typeof data !== "object" || data === null || !Array.isArray((data as { history?: unknown }).history)) {
      throw new ControlPlaneError("control_plane_malformed_payload", `${this.endpoint}${path}: history not array`);
    }
    return (data as { history: ControlPlaneHistoryEntry[] }).history;
  }

  async addComment(workItemId: string, body: string, author: "user" | "agent" = "agent"): Promise<void> {
    await this.writeJson(`/api/v1/issues/${encodeURIComponent(workItemId)}/comments`, "POST", { body, author });
  }

  async updateState(workItemId: string, state: string): Promise<void> {
    await this.writeJson(`/api/v1/issues/${encodeURIComponent(workItemId)}`, "PATCH", { state });
  }

  private async fetchPaginated(stateParams: string[]): Promise<WorkItem[]> {
    const out: WorkItem[] = [];
    let cursor: string | null = null;
    do {
      const params = new URLSearchParams();
      for (const s of stateParams) params.append("state", s);
      if (cursor) params.append("cursor", cursor);
      const body = await this.getJson(`/api/v1/issues?${params.toString()}`);
      const page = this.assertPage(body);
      for (const raw of page.issues) {
        const norm = normalizeWorkItem(raw);
        if (norm) out.push(norm);
      }
      cursor = page.next_cursor;
    } while (cursor);
    return out;
  }

  private assertPage(body: unknown): IssuesPage {
    if (body === null || typeof body !== "object" || !Array.isArray((body as { issues?: unknown }).issues)) {
      throw new ControlPlaneError("control_plane_malformed_payload", "expected { issues: [], next_cursor }");
    }
    const next = (body as { next_cursor?: unknown }).next_cursor;
    return { issues: (body as { issues: unknown[] }).issues, next_cursor: typeof next === "string" ? next : null };
  }

  private async writeJson(path: string, method: "POST" | "PATCH", payload: unknown): Promise<void> {
    const url = `${this.endpoint}${path}`;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: { ...this.headers(), "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      throw new ControlPlaneError("control_plane_write_error", `${url}: ${(err as Error).message}`);
    } finally {
      clearTimeout(t);
    }
    if (!res.ok) {
      throw new ControlPlaneError("control_plane_write_error", `${url}: HTTP ${res.status}`);
    }
  }
}
```

- [ ] **Step 4: Update orchestrator imports and method calls**

In `packages/dalang/src/orchestrator/orchestrator.ts`, replace:

```ts
import type { TrackerAdapter } from "../tracker/adapter";
```

with:

```ts
import type { ControlPlaneAdapter } from "../control-plane/adapter";
```

Change `tracker: TrackerAdapter` to `controlPlane: ControlPlaneAdapter` in `OrchestratorOptions`, constructor fields, and all private references. Rename calls:

```ts
this.tracker.fetchCandidateIssues(this.cfg.tracker.active_states)
this.tracker.fetchIssuesByStates(["Waiting PR Checks"])
this.tracker.fetchIssueStatesByIds(ids)
```

to:

```ts
this.controlPlane.fetchDispatchableWork({
  activeStates: this.cfg.control_plane.active_states,
  ownership: this.cfg.control_plane.ownership,
})
this.controlPlane.fetchWorkByStates(["Waiting PR Checks"])
this.controlPlane.refreshWork(ids)
```

Use `this.cfg.control_plane.active_states` and `this.cfg.control_plane.terminal_states` for eligibility and refresh classification.

- [ ] **Step 5: Update bootstrap to use Wayang adapter directly**

In `packages/dalang/src/cli/bootstrap.ts`, replace the adapter import:

```ts
import { WayangControlPlaneAdapter } from "../control-plane/wayang-adapter";
```

Replace the construction block with:

```ts
    const cp = wf.config.control_plane;
    if (cp.kind !== "wayang") {
      throw new ValidationError("unsupported_control_plane_kind", `bootstrap only supports wayang before the control-plane factory task: ${cp.kind}`);
    }
    const controlPlane = new WayangControlPlaneAdapter({
      endpoint: this.opts.trackerEndpoint ?? cp.endpoint,
      apiKey: this.opts.trackerApiKey !== undefined
        ? resolveTrackerApiKey(this.opts.trackerApiKey)
        : resolveTrackerApiKey(cp.api_key ?? null),
    });
```

Pass `controlPlane` into `new Orchestrator`.

- [ ] **Step 6: Update orchestrator tests fake adapter**

In `packages/dalang/tests/orchestrator/orchestrator.test.ts`, rename fake adapter methods:

```ts
async fetchDispatchableWork(): Promise<WorkItem[]> { return this.candidates; }
async fetchWorkByStates(_states: string[]): Promise<WorkItem[]> { return []; }
async refreshWork(ids: string[]): Promise<WorkItem[]> {
  return ids.flatMap((id) => this.byIds[id] ? [this.byIds[id]!] : []);
}
async fetchWorkItem(id: string): Promise<WorkItem | null> { return this.byIds[id] ?? null; }
```

Keep comment and state methods unchanged.

- [ ] **Step 7: Run focused tests**

Run:

```bash
bun test packages/dalang/tests/control-plane/wayang-adapter.test.ts packages/dalang/tests/orchestrator/orchestrator.test.ts packages/dalang/tests/orchestrator/reconcile.test.ts
```

Expected: PASS.

- [ ] **Step 8: Remove old tracker files and update imports**

Delete the old tracker source and test files listed for this task. Run:

```bash
rg -n "src/tracker|../tracker|../../src/tracker|RestTrackerAdapter|TrackerAdapter|fetchCandidateIssues|fetchIssueStatesByIds|fetchIssuesByStates" packages/dalang/src packages/dalang/tests
```

Expected: no matches, except deliberate compatibility type aliases in `types.ts` if present.

- [ ] **Step 9: Commit**

```bash
git add packages/dalang/src packages/dalang/tests
git commit -m "refactor(dalang): rename tracker adapter to control plane"
```

---

### Task 4: Move PR Checks Behind Control-Plane Capability

**Files:**
- Modify: `packages/dalang/src/control-plane/wayang-adapter.ts`
- Modify: `packages/dalang/src/orchestrator/orchestrator.ts`
- Modify: `packages/dalang/src/orchestrator/pr-checks-runner.ts`
- Modify: `packages/dalang/tests/orchestrator/orchestrator.test.ts`
- Modify: `packages/dalang/tests/orchestrator/pr-checks-runner.test.ts`

- [ ] **Step 1: Write failing orchestrator capability test**

Append to `packages/dalang/tests/orchestrator/orchestrator.test.ts`:

```ts
test("tick delegates PR checks to control plane capability", async () => {
  class PrCheckControlPlane extends FakeControlPlane {
    called = 0;
    override capabilities = { history: true, prChecks: true } as const;
    override async fetchWorkByStates(states: string[]): Promise<WorkItem[]> {
      expect(states).toEqual(["Waiting PR Checks"]);
      return [issue("waiting", "Waiting PR Checks")];
    }
    override async reconcilePrChecks(): Promise<void> {
      this.called += 1;
    }
  }
  const controlPlane = new PrCheckControlPlane();
  const orch = new Orchestrator({
    controlPlane,
    config: cfg({ pr_checks: { enabled: true } }),
    promptTemplate: "body",
    runQuery: async function* () {},
  });
  await orch.tick();
  expect(controlPlane.called).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/dalang/tests/orchestrator/orchestrator.test.ts -t "delegates PR checks"`

Expected: FAIL because the orchestrator still calls `runPrChecksReconciler` directly.

- [ ] **Step 3: Implement Wayang adapter PR-check delegation**

In `packages/dalang/src/control-plane/wayang-adapter.ts`, import the runner:

```ts
import type { OrchestratorState } from "../types";
import { runPrChecksReconciler } from "../orchestrator/pr-checks-runner";
import type { PrChecksReconcileArgs } from "./adapter";
```

Add an optional state setter and method:

```ts
  private prChecksState: OrchestratorState | null = null;

  attachPrChecksState(state: OrchestratorState): void {
    this.prChecksState = state;
  }

  async reconcilePrChecks(args: PrChecksReconcileArgs): Promise<void> {
    if (!this.prChecksState) {
      throw new ControlPlaneError("control_plane_validation_error", "Wayang PR-check reconciliation requires attached orchestrator state");
    }
    await runPrChecksReconciler({
      issues: args.work,
      state: this.prChecksState,
      tracker: this,
      cfg: {
        enabled: args.config.enabled,
        poll_interval_ms: args.config.poll_interval_ms,
        failure_budget: args.config.failure_budget,
        rerun_flakes: args.config.rerun_flakes,
        gh_executable: args.config.gh_executable ?? "gh",
      },
      cwd: args.repoCwd,
      now: args.now,
    });
  }
```

- [ ] **Step 4: Update orchestrator PR-check flow**

In `packages/dalang/src/orchestrator/orchestrator.ts`, replace the direct runner call with:

```ts
    if (this.cfg.pr_checks.enabled) {
      if (!this.controlPlane.capabilities.prChecks || !this.controlPlane.reconcilePrChecks) {
        this.log.warn({ kind: this.cfg.control_plane.kind }, "control plane does not support pr_checks; skipping");
      } else {
        let waiting: WorkItem[] = [];
        try {
          const waitState = this.cfg.control_plane.kind === "github-projects" && this.cfg.control_plane.pr_checks
            ? this.cfg.control_plane.pr_checks.wait_state
            : "Waiting PR Checks";
          waiting = await this.controlPlane.fetchWorkByStates([waitState]);
        } catch (err) {
          this.log.warn({ err: (err as Error).message }, "pr_checks fetch failed; skipping");
        }
        await this.controlPlane.reconcilePrChecks({
          work: waiting,
          config: this.cfg.pr_checks,
          repoCwd: process.cwd(),
          now: () => new Date(),
        }).catch((err) => {
          this.log.warn({ err: (err as Error).message }, "pr_checks reconcile failed");
        });
      }
    }
```

- [ ] **Step 5: Attach state in bootstrap for Wayang**

In `packages/dalang/src/cli/bootstrap.ts`, after `this.orch = new Orchestrator(...)`, add:

```ts
    controlPlane.attachPrChecksState(this.orch.state);
```

- [ ] **Step 6: Run PR-check tests**

Run:

```bash
bun test packages/dalang/tests/orchestrator/orchestrator.test.ts packages/dalang/tests/orchestrator/pr-checks-runner.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/dalang/src/control-plane/wayang-adapter.ts packages/dalang/src/orchestrator/orchestrator.ts packages/dalang/src/orchestrator/pr-checks-runner.ts packages/dalang/src/cli/bootstrap.ts packages/dalang/tests/orchestrator/orchestrator.test.ts packages/dalang/tests/orchestrator/pr-checks-runner.test.ts
git commit -m "feat(dalang): delegate pr checks through control plane"
```

---

### Task 5: Add Control-Plane Factory and Bootstrap GitHub Kind

**Files:**
- Create: `packages/dalang/src/control-plane/factory.ts`
- Create: `packages/dalang/tests/control-plane/factory.test.ts`
- Modify: `packages/dalang/src/cli/bootstrap.ts`

- [ ] **Step 1: Write failing factory tests**

Create `packages/dalang/tests/control-plane/factory.test.ts`:

```ts
import { test, expect } from "bun:test";
import { createControlPlaneAdapter } from "../../src/control-plane/factory";
import { applyDefaults } from "../../src/config/schema";
import { WayangControlPlaneAdapter } from "../../src/control-plane/wayang-adapter";
import { GithubProjectsControlPlaneAdapter } from "../../src/control-plane/github/adapter";

test("factory creates Wayang control plane", () => {
  const cfg = applyDefaults({});
  const adapter = createControlPlaneAdapter({ config: cfg, trackerEndpoint: null, trackerApiKey: undefined });
  expect(adapter).toBeInstanceOf(WayangControlPlaneAdapter);
});

test("factory creates GitHub Projects control plane", () => {
  const cfg = applyDefaults({
    control_plane: {
      kind: "github-projects",
      owner_type: "organization",
      owner: "acme",
      project_number: 4,
      repository: "acme/app",
      token: "token-1",
      status_field: "Status",
      active_states: ["Todo"],
      terminal_states: ["Done"],
      ownership: { mode: "label", value: "dalang" },
    },
  });
  const adapter = createControlPlaneAdapter({ config: cfg, trackerEndpoint: null, trackerApiKey: undefined });
  expect(adapter).toBeInstanceOf(GithubProjectsControlPlaneAdapter);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/dalang/tests/control-plane/factory.test.ts`

Expected: FAIL because factory and GitHub adapter do not exist.

- [ ] **Step 3: Add a minimal GitHub adapter shell**

Create `packages/dalang/src/control-plane/github/adapter.ts`:

```ts
import type { ControlPlaneAdapter, DispatchQuery, PrChecksReconcileArgs } from "../adapter";
import type { ControlPlaneComment, ControlPlaneHistoryEntry, WorkItem } from "../../types";

export interface GithubProjectsAdapterConfig {
  ownerType: "organization" | "user";
  owner: string;
  projectNumber: number;
  repository: string;
  token: string;
  statusField: string;
  branchField: string | null;
  ownership: DispatchQuery["ownership"];
}

export class GithubProjectsControlPlaneAdapter implements ControlPlaneAdapter {
  readonly capabilities = { history: true, prChecks: true } as const;
  constructor(readonly cfg: GithubProjectsAdapterConfig) {}
  async fetchDispatchableWork(_query: DispatchQuery): Promise<WorkItem[]> { return []; }
  async fetchWorkByStates(_states: string[]): Promise<WorkItem[]> { return []; }
  async refreshWork(_ids: string[]): Promise<WorkItem[]> { return []; }
  async fetchWorkItem(_id: string): Promise<WorkItem | null> { return null; }
  async listComments(_workItemId: string): Promise<ControlPlaneComment[]> { return []; }
  async listHistory(_workItemId: string): Promise<ControlPlaneHistoryEntry[]> { return []; }
  async addComment(_workItemId: string, _body: string, _author: "user" | "agent" = "agent"): Promise<void> {}
  async updateState(_workItemId: string, _state: string): Promise<void> {}
  async reconcilePrChecks(_args: PrChecksReconcileArgs): Promise<void> {}
}
```

- [ ] **Step 4: Implement factory**

Create `packages/dalang/src/control-plane/factory.ts`:

```ts
import type { WorkflowFrontMatter } from "../config/schema";
import { resolveEnvValue } from "../config/env-resolver";
import { resolveTrackerApiKey } from "../orchestrator/orchestrator";
import type { ControlPlaneAdapter } from "./adapter";
import { WayangControlPlaneAdapter } from "./wayang-adapter";
import { GithubProjectsControlPlaneAdapter } from "./github/adapter";

export interface CreateControlPlaneArgs {
  config: WorkflowFrontMatter;
  trackerEndpoint?: string | null;
  trackerApiKey?: string | null | undefined;
}

export function createControlPlaneAdapter(args: CreateControlPlaneArgs): ControlPlaneAdapter {
  const cp = args.config.control_plane;
  if (cp.kind === "wayang") {
    return new WayangControlPlaneAdapter({
      endpoint: args.trackerEndpoint ?? cp.endpoint,
      apiKey: args.trackerApiKey !== undefined
        ? resolveTrackerApiKey(args.trackerApiKey)
        : resolveTrackerApiKey(cp.api_key ?? null),
    });
  }
  const token = resolveEnvValue(cp.token) ?? cp.token;
  return new GithubProjectsControlPlaneAdapter({
    ownerType: cp.owner_type,
    owner: cp.owner,
    projectNumber: cp.project_number,
    repository: cp.repository,
    token,
    statusField: cp.status_field,
    branchField: cp.branch_field ?? null,
    ownership: cp.ownership,
  });
}
```

- [ ] **Step 5: Use factory in bootstrap**

In `packages/dalang/src/cli/bootstrap.ts`, import:

```ts
import { createControlPlaneAdapter } from "../control-plane/factory";
import { WayangControlPlaneAdapter } from "../control-plane/wayang-adapter";
```

Replace direct construction with:

```ts
    const controlPlane = createControlPlaneAdapter({
      config: wf.config,
      trackerEndpoint: this.opts.trackerEndpoint ?? null,
      trackerApiKey: this.opts.trackerApiKey,
    });
```

After orchestrator construction:

```ts
    if (controlPlane instanceof WayangControlPlaneAdapter) {
      controlPlane.attachPrChecksState(this.orch.state);
    }
```

- [ ] **Step 6: Run tests**

Run:

```bash
bun test packages/dalang/tests/control-plane/factory.test.ts packages/dalang/tests/cli/bootstrap.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/dalang/src/control-plane/factory.ts packages/dalang/src/control-plane/github/adapter.ts packages/dalang/src/cli/bootstrap.ts packages/dalang/tests/control-plane/factory.test.ts packages/dalang/tests/cli/bootstrap.test.ts
git commit -m "feat(dalang): add control plane factory"
```

---

### Task 6: Implement GitHub Client, Project Metadata Resolution, and Startup Probe

**Files:**
- Create: `packages/dalang/src/control-plane/github/client.ts`
- Create: `packages/dalang/src/control-plane/github/types.ts`
- Create: `packages/dalang/tests/control-plane/github/client.test.ts`
- Modify: `packages/dalang/src/control-plane/github/adapter.ts`
- Modify: `packages/dalang/src/config/validate.ts`

- [ ] **Step 1: Write failing GitHub client tests**

Create `packages/dalang/tests/control-plane/github/client.test.ts`:

```ts
import { afterEach, test, expect } from "bun:test";
import { GithubClient } from "../../../src/control-plane/github/client";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("graphql sends bearer token and returns data", async () => {
  const seen: RequestInit[] = [];
  globalThis.fetch = (async (_url, init) => {
    seen.push(init ?? {});
    return new Response(JSON.stringify({ data: { ok: true } }), { status: 200 });
  }) as typeof fetch;

  const client = new GithubClient({ token: "token-1" });
  const got = await client.graphql<{ ok: boolean }>("query { ok }", {});
  expect(got).toEqual({ ok: true });
  expect((seen[0]!.headers as Record<string, string>).authorization).toBe("Bearer token-1");
});

test("graphql throws on GitHub errors", async () => {
  globalThis.fetch = (async () => {
    return new Response(JSON.stringify({ errors: [{ message: "bad scope" }] }), { status: 200 });
  }) as typeof fetch;

  const client = new GithubClient({ token: "token-1" });
  await expect(client.graphql("query { viewer { login } }", {})).rejects.toThrow(/bad scope/);
});

test("rest posts issue comment", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = (async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ id: 123 }), { status: 201 });
  }) as typeof fetch;

  const client = new GithubClient({ token: "token-1" });
  await client.restJson("/repos/acme/app/issues/12/comments", "POST", { body: "done" });

  expect(calls[0]!.url).toBe("https://api.github.com/repos/acme/app/issues/12/comments");
  expect(calls[0]!.init.method).toBe("POST");
  expect(calls[0]!.init.body).toBe(JSON.stringify({ body: "done" }));
});
```

- [ ] **Step 2: Run client tests to verify they fail**

Run: `bun test packages/dalang/tests/control-plane/github/client.test.ts`

Expected: FAIL because `GithubClient` does not exist.

- [ ] **Step 3: Implement GitHub client**

Create `packages/dalang/src/control-plane/github/client.ts`:

```ts
import { ControlPlaneError } from "../adapter";

export interface GithubClientConfig {
  token: string;
  apiBaseUrl?: string;
  graphqlUrl?: string;
}

export class GithubClient {
  private readonly token: string;
  private readonly apiBaseUrl: string;
  private readonly graphqlUrl: string;

  constructor(cfg: GithubClientConfig) {
    this.token = cfg.token;
    this.apiBaseUrl = cfg.apiBaseUrl ?? "https://api.github.com";
    this.graphqlUrl = cfg.graphqlUrl ?? "https://api.github.com/graphql";
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${this.token}`,
      "x-github-api-version": "2022-11-28",
      ...extra,
    };
  }

  async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    let res: Response;
    try {
      res = await fetch(this.graphqlUrl, {
        method: "POST",
        headers: this.headers({ "content-type": "application/json" }),
        body: JSON.stringify({ query, variables }),
      });
    } catch (err) {
      throw new ControlPlaneError("control_plane_request_error", `github graphql: ${(err as Error).message}`);
    }
    const body = await this.readJson(res, "github graphql");
    if (!res.ok) {
      throw new ControlPlaneError("control_plane_status_error", `github graphql: HTTP ${res.status}`);
    }
    if (body && typeof body === "object" && Array.isArray((body as { errors?: unknown }).errors)) {
      const msg = (body as { errors: Array<{ message?: string }> }).errors.map((e) => e.message ?? "unknown").join("; ");
      throw new ControlPlaneError("control_plane_status_error", `github graphql: ${msg}`);
    }
    return (body as { data: T }).data;
  }

  async restJson<T = unknown>(path: string, method: "GET" | "POST" | "PATCH", payload?: unknown): Promise<T> {
    const url = `${this.apiBaseUrl}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: this.headers(payload === undefined ? {} : { "content-type": "application/json" }),
        body: payload === undefined ? undefined : JSON.stringify(payload),
      });
    } catch (err) {
      throw new ControlPlaneError("control_plane_request_error", `${url}: ${(err as Error).message}`);
    }
    const body = await this.readJson(res, url);
    if (!res.ok) {
      throw new ControlPlaneError("control_plane_status_error", `${url}: HTTP ${res.status}`);
    }
    return body as T;
  }

  private async readJson(res: Response, context: string): Promise<unknown> {
    try {
      const text = await res.text();
      return text.length === 0 ? null : JSON.parse(text);
    } catch (err) {
      throw new ControlPlaneError("control_plane_malformed_payload", `${context}: ${(err as Error).message}`);
    }
  }
}
```

- [ ] **Step 4: Add GitHub response metadata types**

Create `packages/dalang/src/control-plane/github/types.ts`:

```ts
import type { OwnershipRule } from "../adapter";

export interface GithubProjectMetadata {
  projectId: string;
  statusFieldId: string;
  statusOptions: Map<string, string>;
  branchFieldId: string | null;
  ownershipFieldId: string | null;
  ownershipOptions: Map<string, string>;
}

export interface GithubProjectConfig {
  ownerType: "organization" | "user";
  owner: string;
  projectNumber: number;
  repository: string;
  token: string;
  statusField: string;
  branchField: string | null;
  ownership: OwnershipRule;
}
```

- [ ] **Step 5: Add metadata resolution shell to adapter**

In `packages/dalang/src/control-plane/github/adapter.ts`, add constructor client injection and metadata cache:

```ts
import { GithubClient } from "./client";
import type { GithubProjectMetadata } from "./types";

export class GithubProjectsControlPlaneAdapter implements ControlPlaneAdapter {
  readonly capabilities = { history: true, prChecks: true } as const;
  private readonly client: GithubClient;
  private metadata: GithubProjectMetadata | null = null;

  constructor(readonly cfg: GithubProjectsAdapterConfig, client?: GithubClient) {
    this.client = client ?? new GithubClient({ token: cfg.token });
  }

  async validateConnection(): Promise<void> {
    await this.resolveMetadata();
  }

  private async resolveMetadata(): Promise<GithubProjectMetadata> {
    if (this.metadata) return this.metadata;
    this.metadata = {
      projectId: "unresolved",
      statusFieldId: "unresolved",
      statusOptions: new Map(),
      branchFieldId: null,
      ownershipFieldId: null,
      ownershipOptions: new Map(),
    };
    return this.metadata;
  }
}
```

The full GraphQL query is added in Task 7; this task establishes the client and probe surface.

- [ ] **Step 6: Run client tests**

Run: `bun test packages/dalang/tests/control-plane/github/client.test.ts packages/dalang/tests/control-plane/factory.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/dalang/src/control-plane/github/client.ts packages/dalang/src/control-plane/github/types.ts packages/dalang/src/control-plane/github/adapter.ts packages/dalang/tests/control-plane/github/client.test.ts
git commit -m "feat(dalang): add github control plane client"
```

---

### Task 7: Implement GitHub Project Item Normalization and Ownership

**Files:**
- Create: `packages/dalang/src/control-plane/github/normalize.ts`
- Create: `packages/dalang/tests/control-plane/github/normalize.test.ts`
- Modify: `packages/dalang/src/control-plane/github/adapter.ts`

- [ ] **Step 1: Write failing normalization and ownership tests**

Create `packages/dalang/tests/control-plane/github/normalize.test.ts`:

```ts
import { test, expect } from "bun:test";
import { githubProjectItemToWorkItem, githubItemMatchesOwnership, deriveBranchName } from "../../../src/control-plane/github/normalize";

const item = {
  id: "PVTI_1",
  updatedAt: "2026-04-30T02:00:00Z",
  fieldValues: {
    nodes: [
      { __typename: "ProjectV2ItemFieldSingleSelectValue", name: "In Dev", field: { name: "Status" } },
      { __typename: "ProjectV2ItemFieldTextValue", text: "feature/custom-branch", field: { name: "Branch" } },
      { __typename: "ProjectV2ItemFieldSingleSelectValue", name: "Dalang", field: { name: "Agent" } },
    ],
  },
  content: {
    __typename: "Issue",
    id: "ISSUE_1",
    number: 12,
    title: "Fix Checkout!",
    body: "Body",
    url: "https://github.com/acme/app/issues/12",
    createdAt: "2026-04-30T01:00:00Z",
    updatedAt: "2026-04-30T01:30:00Z",
    labels: { nodes: [{ name: "Dalang" }, { name: "Bug" }] },
    assignees: { nodes: [{ login: "dalang-bot" }] },
  },
};

test("githubProjectItemToWorkItem maps issue project item", () => {
  const got = githubProjectItemToWorkItem(item, {
    repository: "acme/app",
    statusField: "Status",
    branchField: "Branch",
  });
  expect(got).toMatchObject({
    id: "PVTI_1",
    identifier: "acme/app#12",
    title: "Fix Checkout!",
    description: "Body",
    state: "In Dev",
    branch_name: "feature/custom-branch",
    url: "https://github.com/acme/app/issues/12",
    external_ref: "ISSUE_1",
    labels: ["dalang", "bug"],
  });
});

test("githubProjectItemToWorkItem ignores draft issues and pull requests", () => {
  expect(githubProjectItemToWorkItem({ ...item, content: { __typename: "DraftIssue" } }, {
    repository: "acme/app",
    statusField: "Status",
    branchField: null,
  })).toBeNull();
  expect(githubProjectItemToWorkItem({ ...item, content: { __typename: "PullRequest" } }, {
    repository: "acme/app",
    statusField: "Status",
    branchField: null,
  })).toBeNull();
});

test("ownership supports label assignee and project field", () => {
  expect(githubItemMatchesOwnership(item, { mode: "label", value: "dalang" })).toBe(true);
  expect(githubItemMatchesOwnership(item, { mode: "assignee", value: "dalang-bot" })).toBe(true);
  expect(githubItemMatchesOwnership(item, { mode: "project_field", field: "Agent", value: "Dalang" })).toBe(true);
  expect(githubItemMatchesOwnership(item, { mode: "label", value: "other" })).toBe(false);
});

test("deriveBranchName is deterministic", () => {
  expect(deriveBranchName(12, "Fix Checkout!")).toBe("dalang/12-fix-checkout");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/dalang/tests/control-plane/github/normalize.test.ts`

Expected: FAIL because `github/normalize.ts` does not exist.

- [ ] **Step 3: Implement GitHub normalization helpers**

Create `packages/dalang/src/control-plane/github/normalize.ts`:

```ts
import type { OwnershipRule } from "../adapter";
import type { WorkItem } from "../../types";

function nodes(raw: unknown): unknown[] {
  if (raw === null || typeof raw !== "object") return [];
  const n = (raw as { nodes?: unknown }).nodes;
  return Array.isArray(n) ? n : [];
}

function lowerNames(raw: unknown): string[] {
  return nodes(raw).flatMap((x) => {
    if (x !== null && typeof x === "object" && typeof (x as { name?: unknown }).name === "string") {
      return [(x as { name: string }).name.toLowerCase()];
    }
    return [];
  });
}

function assigneeLogins(raw: unknown): string[] {
  return nodes(raw).flatMap((x) => {
    if (x !== null && typeof x === "object" && typeof (x as { login?: unknown }).login === "string") {
      return [(x as { login: string }).login.toLowerCase()];
    }
    return [];
  });
}

function fieldValues(item: unknown): Array<Record<string, unknown>> {
  if (item === null || typeof item !== "object") return [];
  const fv = (item as { fieldValues?: { nodes?: unknown } }).fieldValues;
  return nodes(fv).filter((x): x is Record<string, unknown> => x !== null && typeof x === "object");
}

function fieldName(v: Record<string, unknown>): string | null {
  const field = v.field;
  if (field !== null && typeof field === "object" && typeof (field as { name?: unknown }).name === "string") {
    return (field as { name: string }).name;
  }
  return null;
}

function singleSelectValue(item: unknown, field: string): string | null {
  for (const v of fieldValues(item)) {
    if (fieldName(v) === field && typeof v.name === "string") return v.name;
  }
  return null;
}

function textValue(item: unknown, field: string): string | null {
  for (const v of fieldValues(item)) {
    if (fieldName(v) === field && typeof v.text === "string") return v.text;
  }
  return null;
}

export function deriveBranchName(number: number, title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  return `dalang/${number}-${slug || "issue"}`;
}

export function githubProjectItemToWorkItem(
  item: unknown,
  cfg: { repository: string; statusField: string; branchField: string | null },
): WorkItem | null {
  if (item === null || typeof item !== "object") return null;
  const i = item as Record<string, unknown>;
  const content = i.content;
  if (content === null || typeof content !== "object") return null;
  const c = content as Record<string, unknown>;
  if (c.__typename !== "Issue") return null;
  if (typeof i.id !== "string" || typeof c.id !== "string" || typeof c.number !== "number" || typeof c.title !== "string") return null;
  const state = singleSelectValue(item, cfg.statusField);
  if (!state) return null;
  const branch = cfg.branchField ? textValue(item, cfg.branchField) : null;
  const issueUpdated = typeof c.updatedAt === "string" ? c.updatedAt : null;
  const itemUpdated = typeof i.updatedAt === "string" ? i.updatedAt : null;
  return {
    id: i.id,
    identifier: `${cfg.repository}#${c.number}`,
    title: c.title,
    description: typeof c.body === "string" ? c.body : null,
    priority: null,
    state,
    branch_name: branch || deriveBranchName(c.number, c.title),
    url: typeof c.url === "string" ? c.url : null,
    external_ref: c.id,
    internal_ref: `${cfg.repository}#${c.number}`,
    labels: lowerNames(c.labels),
    blocked_by: [],
    created_at: typeof c.createdAt === "string" ? new Date(c.createdAt).toISOString() : null,
    updated_at: [issueUpdated, itemUpdated].filter((x): x is string => typeof x === "string").sort().at(-1) ?? null,
  };
}

export function githubItemMatchesOwnership(item: unknown, ownership: OwnershipRule): boolean {
  if (ownership.mode === "none") return true;
  if (item === null || typeof item !== "object") return false;
  const content = (item as { content?: unknown }).content;
  if (content === null || typeof content !== "object") return false;
  const c = content as Record<string, unknown>;
  if (ownership.mode === "label") return lowerNames(c.labels).includes(ownership.value.toLowerCase());
  if (ownership.mode === "assignee") return assigneeLogins(c.assignees).includes(ownership.value.toLowerCase());
  return singleSelectValue(item, ownership.field)?.toLowerCase() === ownership.value.toLowerCase();
}
```

- [ ] **Step 4: Run normalization tests**

Run: `bun test packages/dalang/tests/control-plane/github/normalize.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/dalang/src/control-plane/github/normalize.ts packages/dalang/tests/control-plane/github/normalize.test.ts
git commit -m "feat(dalang): normalize github project items"
```

---

### Task 8: Implement GitHub Adapter Reads and Writes

**Files:**
- Modify: `packages/dalang/src/control-plane/github/adapter.ts`
- Modify: `packages/dalang/tests/control-plane/github/adapter.test.ts`

- [ ] **Step 1: Write failing adapter tests**

Create `packages/dalang/tests/control-plane/github/adapter.test.ts`:

```ts
import { test, expect } from "bun:test";
import { GithubProjectsControlPlaneAdapter } from "../../../src/control-plane/github/adapter";
import { GithubClient } from "../../../src/control-plane/github/client";

class FakeClient extends GithubClient {
  queries: Array<{ query: string; variables: Record<string, unknown> }> = [];
  restCalls: Array<{ path: string; method: string; payload: unknown }> = [];
  responses: unknown[] = [];
  constructor() { super({ token: "token" }); }
  override async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    this.queries.push({ query, variables });
    return this.responses.shift() as T;
  }
  override async restJson<T>(path: string, method: "GET" | "POST" | "PATCH", payload?: unknown): Promise<T> {
    this.restCalls.push({ path, method, payload });
    return { ok: true } as T;
  }
}

function adapter(client: FakeClient): GithubProjectsControlPlaneAdapter {
  return new GithubProjectsControlPlaneAdapter({
    ownerType: "organization",
    owner: "acme",
    projectNumber: 1,
    repository: "acme/app",
    token: "token",
    statusField: "Status",
    branchField: null,
    ownership: { mode: "label", value: "dalang" },
  }, client);
}

test("fetchDispatchableWork resolves metadata and filters by ownership", async () => {
  const client = new FakeClient();
  client.responses.push(
    {
      organization: {
        projectV2: {
          id: "PVT_1",
          fields: {
            nodes: [
              { __typename: "ProjectV2SingleSelectField", id: "FIELD_STATUS", name: "Status", options: [{ id: "OPT_TODO", name: "Todo" }] },
            ],
          },
        },
      },
    },
    {
      node: {
        items: {
          nodes: [
            {
              id: "PVTI_1",
              updatedAt: "2026-04-30T02:00:00Z",
              fieldValues: { nodes: [{ __typename: "ProjectV2ItemFieldSingleSelectValue", name: "Todo", field: { name: "Status" } }] },
              content: {
                __typename: "Issue",
                id: "ISSUE_1",
                number: 12,
                title: "Fix",
                body: "Body",
                url: "https://github.com/acme/app/issues/12",
                createdAt: "2026-04-30T01:00:00Z",
                updatedAt: "2026-04-30T01:30:00Z",
                labels: { nodes: [{ name: "dalang" }] },
                assignees: { nodes: [] },
              },
            },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    },
  );

  const got = await adapter(client).fetchDispatchableWork({
    activeStates: ["Todo"],
    ownership: { mode: "label", value: "dalang" },
  });
  expect(got).toHaveLength(1);
  expect(got[0]!.identifier).toBe("acme/app#12");
});

test("updateState writes project status option", async () => {
  const client = new FakeClient();
  client.responses.push({
    organization: {
      projectV2: {
        id: "PVT_1",
        fields: {
          nodes: [
            { __typename: "ProjectV2SingleSelectField", id: "FIELD_STATUS", name: "Status", options: [{ id: "OPT_DONE", name: "Done" }] },
          ],
        },
      },
    },
  }, { updateProjectV2ItemFieldValue: { projectV2Item: { id: "PVTI_1" } } });
  await adapter(client).updateState("PVTI_1", "Done");
  expect(client.queries.at(-1)!.variables).toMatchObject({
    projectId: "PVT_1",
    itemId: "PVTI_1",
    fieldId: "FIELD_STATUS",
    optionId: "OPT_DONE",
  });
});

test("addComment posts to the underlying issue", async () => {
  const client = new FakeClient();
  client.responses.push({
    node: {
      content: { __typename: "Issue", number: 12 },
    },
  });
  await adapter(client).addComment("PVTI_1", "hello", "agent");
  expect(client.restCalls[0]).toEqual({
    path: "/repos/acme/app/issues/12/comments",
    method: "POST",
    payload: { body: "hello" },
  });
});
```

- [ ] **Step 2: Run adapter tests to verify they fail**

Run: `bun test packages/dalang/tests/control-plane/github/adapter.test.ts`

Expected: FAIL because the adapter shell returns empty results.

- [ ] **Step 3: Implement metadata resolution, item queries, and state mutation**

In `packages/dalang/src/control-plane/github/adapter.ts`, replace the shell methods with real implementations:

```ts
const PROJECT_METADATA_QUERY = `
  query ProjectMetadata($owner: String!, $number: Int!) {
    organization(login: $owner) {
      projectV2(number: $number) {
        id
        fields(first: 50) {
          nodes {
            ... on ProjectV2Field { id name }
            ... on ProjectV2FieldCommon { id name }
            ... on ProjectV2SingleSelectField { id name options { id name } }
          }
        }
      }
    }
  }
`;

const USER_PROJECT_METADATA_QUERY = `
  query ProjectMetadata($owner: String!, $number: Int!) {
    user(login: $owner) {
      projectV2(number: $number) {
        id
        fields(first: 50) {
          nodes {
            ... on ProjectV2Field { id name }
            ... on ProjectV2FieldCommon { id name }
            ... on ProjectV2SingleSelectField { id name options { id name } }
          }
        }
      }
    }
  }
`;
```

Use a helper to choose `organization` or `user`, resolve status field ID and option IDs into `GithubProjectMetadata`, and throw `ControlPlaneError("control_plane_validation_error", "github project status option not found: <state>")` when a configured state is missing.

Add item query:

```ts
const PROJECT_ITEMS_QUERY = `
  query ProjectItems($projectId: ID!, $cursor: String) {
    node(id: $projectId) {
      ... on ProjectV2 {
        items(first: 50, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            updatedAt
            fieldValues(first: 50) {
              nodes {
                ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { name } } }
                ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } }
              }
            }
            content {
              ... on Issue {
                __typename
                id
                number
                title
                body
                url
                createdAt
                updatedAt
                labels(first: 30) { nodes { name } }
                assignees(first: 20) { nodes { login } }
              }
              ... on PullRequest { __typename }
              ... on DraftIssue { __typename }
            }
          }
        }
      }
    }
  }
`;
```

Implement:

```ts
  async fetchDispatchableWork(query: DispatchQuery): Promise<WorkItem[]> {
    const all = await this.fetchProjectItems();
    return all.filter((raw) => githubItemMatchesOwnership(raw, query.ownership)).flatMap((raw) => {
      const item = githubProjectItemToWorkItem(raw, {
        repository: this.cfg.repository,
        statusField: this.cfg.statusField,
        branchField: this.cfg.branchField,
      });
      return item && query.activeStates.some((s) => s.toLowerCase() === item.state.toLowerCase()) ? [item] : [];
    });
  }

  async fetchWorkByStates(states: string[]): Promise<WorkItem[]> {
    if (states.length === 0) return [];
    const lowered = states.map((s) => s.toLowerCase());
    const all = await this.fetchProjectItems();
    return all.flatMap((raw) => {
      const item = githubProjectItemToWorkItem(raw, {
        repository: this.cfg.repository,
        statusField: this.cfg.statusField,
        branchField: this.cfg.branchField,
      });
      return item && lowered.includes(item.state.toLowerCase()) ? [item] : [];
    });
  }

  async refreshWork(ids: string[]): Promise<WorkItem[]> {
    if (ids.length === 0) return [];
    const wanted = new Set(ids);
    const all = await this.fetchProjectItems();
    return all.flatMap((raw) => {
      const item = githubProjectItemToWorkItem(raw, {
        repository: this.cfg.repository,
        statusField: this.cfg.statusField,
        branchField: this.cfg.branchField,
      });
      return item && wanted.has(item.id) ? [item] : [];
    });
  }
```

Implement `updateState` with:

```ts
const UPDATE_STATUS_MUTATION = `
  mutation UpdateStatus($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $projectId,
      itemId: $itemId,
      fieldId: $fieldId,
      value: { singleSelectOptionId: $optionId }
    }) {
      projectV2Item { id }
    }
  }
`;
```

The mutation variables must be:

```ts
{
  projectId: meta.projectId,
  itemId: workItemId,
  fieldId: meta.statusFieldId,
  optionId,
}
```

- [ ] **Step 4: Implement comments and issue lookup**

Add a private `issueNumberForProjectItem(itemId: string): Promise<number>` that queries:

```ts
const PROJECT_ITEM_CONTENT_QUERY = `
  query ProjectItemContent($itemId: ID!) {
    node(id: $itemId) {
      ... on ProjectV2Item {
        content {
          ... on Issue { __typename number }
        }
      }
    }
  }
`;
```

Implement:

```ts
  async addComment(workItemId: string, body: string, _author: "user" | "agent" = "agent"): Promise<void> {
    const number = await this.issueNumberForProjectItem(workItemId);
    const [owner, repo] = this.cfg.repository.split("/") as [string, string];
    await this.client.restJson(`/repos/${owner}/${repo}/issues/${number}/comments`, "POST", { body });
  }
```

Implement `listComments` with REST `GET /repos/{owner}/{repo}/issues/{number}/comments` and map to:

```ts
{
  id: String(raw.id),
  author: raw.user?.login ?? null,
  body: raw.body ?? "",
  created_at: new Date(raw.created_at).toISOString(),
}
```

- [ ] **Step 5: Run adapter tests**

Run: `bun test packages/dalang/tests/control-plane/github/adapter.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/dalang/src/control-plane/github/adapter.ts packages/dalang/tests/control-plane/github/adapter.test.ts
git commit -m "feat(dalang): implement github project adapter"
```

---

### Task 9: Implement GitHub-Native PR Checks Capability

**Files:**
- Create: `packages/dalang/src/control-plane/github/pr-checks.ts`
- Create: `packages/dalang/tests/control-plane/github/pr-checks.test.ts`
- Modify: `packages/dalang/src/control-plane/github/adapter.ts`

- [ ] **Step 1: Write failing PR-check tests**

Create `packages/dalang/tests/control-plane/github/pr-checks.test.ts`:

```ts
import { test, expect } from "bun:test";
import { reconcileGithubPrChecks } from "../../../src/control-plane/github/pr-checks";
import type { WorkItem, ControlPlaneComment } from "../../../src/types";

function work(state = "Waiting PR Checks"): WorkItem {
  return {
    id: "PVTI_1",
    identifier: "acme/app#12",
    title: "Fix",
    description: null,
    priority: null,
    state,
    branch_name: "dalang/12-fix",
    url: "https://github.com/acme/app/issues/12",
    external_ref: "ISSUE_1",
    internal_ref: "acme/app#12",
    labels: [],
    blocked_by: [],
    created_at: null,
    updated_at: null,
  };
}

test("passed checks comment and move to pass state", async () => {
  const comments: ControlPlaneComment[] = [];
  const states: string[] = [];
  await reconcileGithubPrChecks({
    work: [work()],
    config: {
      enabled: true,
      poll_interval_ms: 60000,
      failure_budget: 3,
      rerun_flakes: true,
      wait_state: "Waiting PR Checks",
      pass_state: "Ready for Human Review",
      fail_state: "In Dev",
      escalation_state: "Ready for Human Review",
    },
    now: () => new Date("2026-04-30T00:00:00Z"),
    listComments: async () => comments,
    addComment: async (_id, body) => { comments.push({ id: String(comments.length + 1), author: "agent", body, created_at: new Date().toISOString() }); },
    updateState: async (_id, state) => { states.push(state); },
    resolvePullRequest: async () => ({ number: 9, url: "https://github.com/acme/app/pull/9", sha: "abc123" }),
    fetchChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", link: "https://ci/build" }],
    markReady: async () => {},
  });
  expect(comments[0]!.body).toContain("[pr_checks_passed] sha=abc123");
  expect(states).toEqual(["Ready for Human Review"]);
});

test("failed checks bounce until failure budget then escalate", async () => {
  const comments: ControlPlaneComment[] = [
    { id: "1", author: "agent", body: "[pr_checks_failed] sha=abc123 attempt=1/2", created_at: "2026-04-30T00:00:00Z" },
  ];
  const states: string[] = [];
  await reconcileGithubPrChecks({
    work: [work()],
    config: {
      enabled: true,
      poll_interval_ms: 60000,
      failure_budget: 2,
      rerun_flakes: true,
      wait_state: "Waiting PR Checks",
      pass_state: "Ready for Human Review",
      fail_state: "In Dev",
      escalation_state: "Ready for Human Review",
    },
    now: () => new Date("2026-04-30T00:00:00Z"),
    listComments: async () => comments,
    addComment: async (_id, body) => { comments.push({ id: String(comments.length + 1), author: "agent", body, created_at: new Date().toISOString() }); },
    updateState: async (_id, state) => { states.push(state); },
    resolvePullRequest: async () => ({ number: 9, url: "https://github.com/acme/app/pull/9", sha: "abc123" }),
    fetchChecks: async () => [{ name: "build", state: "FAILURE", bucket: "fail", link: "https://ci/build" }],
    markReady: async () => {},
  });
  expect(comments.at(-1)!.body).toContain("[pr_checks_escalated] sha=abc123 attempt=2/2");
  expect(states).toEqual(["Ready for Human Review"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/dalang/tests/control-plane/github/pr-checks.test.ts`

Expected: FAIL because `github/pr-checks.ts` does not exist.

- [ ] **Step 3: Implement GitHub PR-check reconciler helper**

Create `packages/dalang/src/control-plane/github/pr-checks.ts`:

```ts
import type { ControlPlaneComment, WorkItem } from "../../types";
import { decideAction, formatEscalatedComment, formatFailureComment, formatNoPrComment, formatPassedComment } from "../../orchestrator/pr-checks";

export interface GithubCheck {
  name: string;
  state: string;
  bucket: "pass" | "fail" | "pending" | "skipping" | "cancel";
  link: string | null;
}

export interface GithubPullRequestRef {
  number: number;
  url: string;
  sha: string;
}

export interface GithubPrChecksArgs {
  work: WorkItem[];
  config: {
    enabled: boolean;
    poll_interval_ms: number;
    failure_budget: number;
    rerun_flakes: boolean;
    wait_state: string;
    pass_state: string;
    fail_state: string;
    escalation_state: string;
  };
  now: () => Date;
  listComments: (id: string) => Promise<ControlPlaneComment[]>;
  addComment: (id: string, body: string) => Promise<void>;
  updateState: (id: string, state: string) => Promise<void>;
  resolvePullRequest: (work: WorkItem) => Promise<GithubPullRequestRef | null>;
  fetchChecks: (pr: GithubPullRequestRef) => Promise<GithubCheck[]>;
  markReady: (pr: GithubPullRequestRef) => Promise<void>;
}

function summaryFromGithubChecks(checks: GithubCheck[]) {
  return {
    pending: checks.filter((c) => c.bucket === "pending").map((c) => ({ name: c.name, state: c.state, bucket: c.bucket, link: c.link })),
    failures: checks.filter((c) => c.bucket === "fail" || c.bucket === "cancel").map((c) => ({ name: c.name, state: c.state, bucket: c.bucket, link: c.link })),
    passed: checks.filter((c) => c.bucket === "pass").map((c) => ({ name: c.name, state: c.state, bucket: c.bucket, link: c.link })),
  };
}

export async function reconcileGithubPrChecks(args: GithubPrChecksArgs): Promise<void> {
  if (!args.config.enabled) return;
  for (const item of args.work) {
    if (item.state !== args.config.wait_state) continue;
    const pr = await args.resolvePullRequest(item);
    if (!pr) {
      await args.addComment(item.id, formatNoPrComment(item.branch_name));
      await args.updateState(item.id, args.config.fail_state);
      continue;
    }
    const checks = await args.fetchChecks(pr);
    const comments = await args.listComments(item.id);
    const action = decideAction({
      budget: args.config.failure_budget,
      rerunFlakes: args.config.rerun_flakes,
      prResolved: { sha: pr.sha },
      comments,
      summary: summaryFromGithubChecks(checks),
    });
    if (action.kind === "noop" || action.kind === "rerun") continue;
    if (action.kind === "failed_bounce") {
      await args.addComment(item.id, formatFailureComment({
        sha: action.sha,
        attempt: action.attempt,
        budget: args.config.failure_budget,
        failures: action.failures,
      }));
      await args.updateState(item.id, args.config.fail_state);
    } else if (action.kind === "escalate") {
      await args.addComment(item.id, formatEscalatedComment({
        sha: action.sha,
        attempt: action.attempt,
        budget: args.config.failure_budget,
        failures: action.failures,
      }));
      await args.updateState(item.id, args.config.escalation_state);
    } else if (action.kind === "passed") {
      await args.markReady(pr);
      await args.addComment(item.id, formatPassedComment(action.sha));
      await args.updateState(item.id, args.config.pass_state);
    }
  }
}
```

- [ ] **Step 4: Wire adapter reconcilePrChecks to helper**

In `packages/dalang/src/control-plane/github/adapter.ts`, implement:

```ts
  async reconcilePrChecks(args: PrChecksReconcileArgs): Promise<void> {
    const cp = this.cfg.prChecks;
    if (!cp) return;
    await reconcileGithubPrChecks({
      work: args.work,
      config: {
        enabled: cp.enabled,
        poll_interval_ms: cp.poll_interval_ms,
        failure_budget: cp.failure_budget,
        rerun_flakes: cp.rerun_flakes,
        wait_state: cp.wait_state,
        pass_state: cp.pass_state,
        fail_state: cp.fail_state,
        escalation_state: cp.escalation_state,
      },
      now: args.now,
      listComments: (id) => this.listComments(id),
      addComment: (id, body) => this.addComment(id, body, "agent"),
      updateState: (id, state) => this.updateState(id, state),
      resolvePullRequest: (item) => this.resolvePullRequest(item),
      fetchChecks: (pr) => this.fetchChecks(pr),
      markReady: (pr) => this.markReady(pr),
    });
  }
```

Add adapter private methods using GitHub REST:

```ts
  private async resolvePullRequest(item: WorkItem): Promise<{ number: number; url: string; sha: string } | null> {
    const branch = item.branch_name;
    if (!branch) return null;
    const [owner, repo] = this.cfg.repository.split("/") as [string, string];
    const prs = await this.client.restJson<Array<{ number: number; html_url: string; head: { sha: string } }>>(
      `/repos/${owner}/${repo}/pulls?head=${encodeURIComponent(`${owner}:${branch}`)}&state=open`,
      "GET",
    );
    const pr = prs[0];
    return pr ? { number: pr.number, url: pr.html_url, sha: pr.head.sha } : null;
  }

  private async fetchChecks(pr: { number: number }): Promise<GithubCheck[]> {
    const [owner, repo] = this.cfg.repository.split("/") as [string, string];
    const prData = await this.client.restJson<{ head: { sha: string } }>(`/repos/${owner}/${repo}/pulls/${pr.number}`, "GET");
    const runs = await this.client.restJson<{ check_runs: Array<{ name: string; status: string; conclusion: string | null; html_url: string | null }> }>(
      `/repos/${owner}/${repo}/commits/${prData.head.sha}/check-runs`,
      "GET",
    );
    return runs.check_runs.map((r) => ({
      name: r.name,
      state: r.conclusion ?? r.status,
      bucket: r.status !== "completed" ? "pending" : r.conclusion === "success" || r.conclusion === "neutral" || r.conclusion === "skipped" ? "pass" : "fail",
      link: r.html_url,
    }));
  }

  private async markReady(pr: { number: number }): Promise<void> {
    const [owner, repo] = this.cfg.repository.split("/") as [string, string];
    await this.client.restJson(`/repos/${owner}/${repo}/pulls/${pr.number}/ready_for_review`, "PATCH", {});
  }
```

- [ ] **Step 5: Run PR-check tests**

Run: `bun test packages/dalang/tests/control-plane/github/pr-checks.test.ts packages/dalang/tests/control-plane/github/adapter.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/dalang/src/control-plane/github/pr-checks.ts packages/dalang/src/control-plane/github/adapter.ts packages/dalang/tests/control-plane/github/pr-checks.test.ts
git commit -m "feat(dalang): add github pr check reconciliation"
```

---

### Task 10: Rename Prompt Context and Preserve Migration Alias

**Files:**
- Modify: `packages/dalang/src/agent/prompt-builder.ts`
- Modify: `packages/dalang/src/agent/agent-runner.ts`
- Modify: `packages/dalang/src/orchestrator/orchestrator.ts`
- Modify: `packages/dalang/tests/agent/prompt-builder.test.ts`
- Modify: `packages/dalang/tests/agent/agent-runner.test.ts`

- [ ] **Step 1: Write failing prompt context test**

Append to `packages/dalang/tests/agent/prompt-builder.test.ts`:

```ts
test("prompt exposes control_plane and tracker migration alias", async () => {
  const prompt = await buildFirstTurnPrompt(
    "cp={{ control_plane.endpoint }} legacy={{ tracker.endpoint }}",
    issue(),
    null,
    { endpoint: "http://localhost:3001", api_key: "secret" },
  );
  expect(prompt).toContain("cp=http://localhost:3001 legacy=http://localhost:3001");
});
```

- [ ] **Step 2: Run prompt test to verify it fails**

Run: `bun test packages/dalang/tests/agent/prompt-builder.test.ts -t "control_plane"`

Expected: FAIL because `control_plane` is not in the Liquid context.

- [ ] **Step 3: Rename prompt context type**

In `packages/dalang/src/agent/prompt-builder.ts`, rename `TrackerPromptContext` to:

```ts
export interface ControlPlanePromptContext {
  endpoint: string | null;
  api_key: string | null;
  kind?: string | undefined;
}

export type TrackerPromptContext = ControlPlanePromptContext;
```

In `buildFirstTurnPrompt`, change the render context:

```ts
  const rendered = await liquid.parseAndRender(template, {
    issue,
    work_item: issue,
    attempt,
    control_plane: tracker,
    tracker,
    recent_comments,
    recent_history,
  });
```

The argument name can remain `tracker` for this task if changing it would churn more files; exported context names must be control-plane-first.

- [ ] **Step 4: Update agent runner imports**

In `packages/dalang/src/agent/agent-runner.ts`, replace:

```ts
import { buildFirstTurnPrompt, buildContinuationPrompt, type TrackerPromptContext, type RecentActivity } from "./prompt-builder";
```

with:

```ts
import { buildFirstTurnPrompt, buildContinuationPrompt, type ControlPlanePromptContext, type RecentActivity } from "./prompt-builder";
```

Change `tracker: TrackerPromptContext;` to:

```ts
controlPlane: ControlPlanePromptContext;
```

During the call:

```ts
prompt = await buildFirstTurnPrompt(deps.promptTemplate, issue, deps.attempt, deps.controlPlane, activity);
```

- [ ] **Step 5: Update orchestrator runAttempt call**

In `packages/dalang/src/orchestrator/orchestrator.ts`, replace the `tracker:` prompt context with:

```ts
      controlPlane: this.cfg.control_plane.kind === "wayang"
        ? {
            kind: "wayang",
            endpoint: this.cfg.control_plane.endpoint,
            api_key: resolveTrackerApiKey(this.cfg.control_plane.api_key ?? null),
          }
        : {
            kind: "github-projects",
            endpoint: null,
            api_key: null,
          },
```

- [ ] **Step 6: Run agent tests**

Run:

```bash
bun test packages/dalang/tests/agent/prompt-builder.test.ts packages/dalang/tests/agent/agent-runner.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/dalang/src/agent/prompt-builder.ts packages/dalang/src/agent/agent-runner.ts packages/dalang/src/orchestrator/orchestrator.ts packages/dalang/tests/agent/prompt-builder.test.ts packages/dalang/tests/agent/agent-runner.test.ts
git commit -m "feat(dalang): expose control plane prompt context"
```

---

### Task 11: Documentation, Compatibility Cleanup, and Full Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-04-29-dalang-orchestrator-design.md`
- Modify: `docs/superpowers/specs/2026-04-30-pr-checks-wait-design.md`
- Modify: `packages/dalang/README.md`
- Modify: `packages/dalang/src/index.ts`
- Modify: `packages/dalang/src/lib.ts`

- [ ] **Step 1: Update exported modules**

In `packages/dalang/src/index.ts` and `packages/dalang/src/lib.ts`, replace tracker exports with control-plane exports:

```ts
export * from "./control-plane/adapter";
export * from "./control-plane/normalize";
export * from "./control-plane/wayang-adapter";
export * from "./control-plane/factory";
export * from "./control-plane/github/adapter";
```

Keep no exports from `./tracker/*`.

- [ ] **Step 2: Update README workflow example**

In `packages/dalang/README.md`, change the workflow block from:

```yaml
tracker:
  kind: tok-juara
  endpoint: http://localhost:3001
```

to:

```yaml
control_plane:
  kind: wayang
  endpoint: http://localhost:3001
  api_key: null
  active_states: [Todo, "In Dev"]
  terminal_states: [Done, Cancelled]
  ownership:
    mode: none
```

Add this GitHub Projects example:

```yaml
control_plane:
  kind: github-projects
  owner_type: organization
  owner: acme
  project_number: 12
  repository: acme/app
  token: $GITHUB_TOKEN
  status_field: Status
  branch_field: Branch
  active_states: [Todo, "In Dev"]
  terminal_states: [Done, Cancelled]
  ownership:
    mode: label
    value: dalang
  pr_checks:
    enabled: true
    poll_interval_ms: 60000
    failure_budget: 3
    rerun_flakes: true
    wait_state: "Waiting PR Checks"
    pass_state: "Ready for Human Review"
    fail_state: "In Dev"
    escalation_state: "Ready for Human Review"
```

- [ ] **Step 3: Update design docs references**

In `docs/superpowers/specs/2026-04-29-dalang-orchestrator-design.md`, add a short note near the scope section:

```md
Update: `2026-04-30-control-plane-github-projects-design.md` supersedes the original tracker-only v1 boundary. Dalang now uses a control-plane adapter boundary; Wayang is one adapter and GitHub Projects v2 is the first external kanban adapter.
```

In `docs/superpowers/specs/2026-04-30-pr-checks-wait-design.md`, add:

```md
Update: PR-check reconciliation is now a control-plane capability. The Wayang adapter preserves the behavior described here; GitHub Projects implements the same behavior natively against GitHub issues, PRs, checks, and Project v2 status fields.
```

- [ ] **Step 4: Run repository-wide searches**

Run:

```bash
rg -n "TrackerAdapter|RestTrackerAdapter|fetchCandidateIssues|fetchIssueStatesByIds|fetchIssuesByStates|src/tracker|tests/tracker" packages docs README.md
```

Expected: no matches except historical discussion inside committed design docs when the match is explaining the rename.

Run:

```bash
rg -n "tracker:" packages/dalang README.md docs/superpowers/specs
```

Expected: matches only in migration notes or legacy compatibility examples.

- [ ] **Step 5: Run full verification**

Run:

```bash
bun test
bun run typecheck
bun run lint
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add README.md docs/superpowers/specs/2026-04-29-dalang-orchestrator-design.md docs/superpowers/specs/2026-04-30-pr-checks-wait-design.md packages/dalang/README.md packages/dalang/src/index.ts packages/dalang/src/lib.ts
git commit -m "docs(dalang): document control plane adapters"
```

---

## Final Review Checklist

- [ ] `control_plane.kind = wayang` remains behavior-compatible with the old Wayang tracker path.
- [ ] `tracker` input still maps to Wayang for one migration release.
- [ ] Dalang orchestrator does not import GitHub-specific modules.
- [ ] Dalang orchestrator does not import Wayang-specific modules outside bootstrap/factory wiring.
- [ ] External control planes require explicit ownership unless `allow_unowned_dispatch: true` is set.
- [ ] GitHub Projects adapter ignores draft issues and PR project items.
- [ ] GitHub Projects adapter updates Project v2 `Status`, not the GitHub issue open/closed state.
- [ ] PR checks are invoked through `ControlPlaneAdapter.reconcilePrChecks`.
- [ ] Prompt templates expose `control_plane` and still expose `tracker` as a migration alias.
- [ ] Full verification passes with `bun test`, `bun run typecheck`, and `bun run lint`.
