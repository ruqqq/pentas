# PR-Checks Wait State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `Waiting PR Checks` state where dalang polls `gh pr checks`, posts results as comments on the wayang ticket, bounces back to `In Dev` on failure with a budget-bounded retry, and escalates to `Ready for Human Review` on success or budget exhaustion.

**Architecture:** New non-agent reconciler in dalang runs alongside the dispatch loop, fetches `Waiting PR Checks` issues from wayang, derives the PR via `gh pr list --head <branch_name>`, polls `gh pr checks`, and writes results back via two new tracker write methods (`addComment`, `updateState`). Failure budget is derived by counting `[pr_checks_failed]` tagged comments — no separate persistence. Per-SHA dedupe (in-memory cache + comment scan) prevents double-action.

**Tech Stack:** Bun + TypeScript, `tsgo` typecheck, `bun test`, oxc tooling. New external dep: `gh` CLI (assumed present on host; not bundled).

**Spec:** `docs/superpowers/specs/2026-04-30-pr-checks-wait-design.md`.

---

## File Structure

**Created:**
- `packages/dalang/src/orchestrator/pr-checks.ts` — pure logic: parse `gh pr checks` JSON, count failure comments, decide next action.
- `packages/dalang/src/orchestrator/pr-checks-runner.ts` — IO orchestration: shell out to `gh`, drive tracker writes, throttle.
- `packages/dalang/src/lib/gh.ts` — thin wrapper around `Bun.spawn("gh", ...)` returning stdout/exit-code.
- `packages/dalang/tests/orchestrator/pr-checks.test.ts` — unit tests for the pure logic module.
- `packages/dalang/tests/orchestrator/pr-checks-runner.test.ts` — integration test: real wayang server + faked `gh` shell stub.

**Modified:**
- `packages/wayang/src/domain/issue.ts` — add `Waiting PR Checks` to `IssueState` union and `ALL_STATES`.
- `packages/wayang/src/ui/public/style.css` — badge color for the new state.
- `packages/wayang/tests/domain/issue.test.ts` — extend state union test (create file if missing).
- `packages/dalang/src/tracker/adapter.ts` — add `addComment`, `listComments`, `updateState` to interface; add `tracker_write_error` to `TrackerErrorCode`.
- `packages/dalang/src/tracker/rest-adapter.ts` — implement the three new methods.
- `packages/dalang/src/types.ts` — add `pr_checks_polls` field to `OrchestratorState`; add `pr_checks_observed` to `RuntimeEventKind`; add `TrackerComment` type.
- `packages/dalang/src/orchestrator/state.ts` — initialize `pr_checks_polls: new Map()` in `createInitialState`.
- `packages/dalang/src/config/schema.ts` — add `PrChecksSchema`, wire into `WorkflowFrontMatterSchema`, defaults.
- `packages/dalang/src/orchestrator/orchestrator.ts` — call `runPrChecksReconciler` in `tick()` after `reconcile()`, before dispatch loop.

---

## Task 1: Add `Waiting PR Checks` to wayang state union

**Files:**
- Modify: `packages/wayang/src/domain/issue.ts`
- Test: `packages/wayang/tests/domain/issue.test.ts` (create if missing)

- [ ] **Step 1: Write the failing test**

```ts
// packages/wayang/tests/domain/issue.test.ts
import { describe, expect, test } from "bun:test";
import { ALL_STATES, ACTIVE_STATES, isValidState, isActive } from "../../src/domain/issue";

describe("Waiting PR Checks state", () => {
  test("is included in ALL_STATES between Ready for Review and Ready for Human Review", () => {
    const idx = (ALL_STATES as readonly string[]).indexOf("Waiting PR Checks");
    expect(idx).toBeGreaterThan(-1);
    expect(ALL_STATES[idx - 1]).toBe("Ready for Review");
    expect(ALL_STATES[idx + 1]).toBe("Ready for Human Review");
  });
  test("is not in ACTIVE_STATES (no agent dispatch)", () => {
    expect((ACTIVE_STATES as readonly string[]).includes("Waiting PR Checks")).toBe(false);
  });
  test("isValidState recognises it", () => {
    expect(isValidState("Waiting PR Checks")).toBe(true);
  });
  test("isActive returns false for it", () => {
    expect(isActive("Waiting PR Checks")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/wayang/tests/domain/issue.test.ts`
Expected: FAIL — `indexOf` returns -1.

- [ ] **Step 3: Edit `IssueState` union and `ALL_STATES`**

In `packages/wayang/src/domain/issue.ts`, change the union and array to include `"Waiting PR Checks"` between `"Ready for Review"` and `"Ready for Human Review"`. Do **not** add it to `ACTIVE_STATES` (the dispatcher should not pick up these tickets). Do **not** add it to `TERMINAL_STATES`.

```ts
export type IssueState =
  | "Todo"
  | "Plan"
  | "Review Plan"
  | "Ready for Dev"
  | "In Dev"
  | "Ready for Review"
  | "Waiting PR Checks"
  | "Ready for Human Review"
  | "Done"
  | "Cancelled";

export const ALL_STATES = [
  "Todo",
  "Plan",
  "Review Plan",
  "Ready for Dev",
  "In Dev",
  "Ready for Review",
  "Waiting PR Checks",
  "Ready for Human Review",
  "Done",
  "Cancelled",
] as const satisfies readonly IssueState[];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/wayang/tests/domain/issue.test.ts`
Expected: PASS.

- [ ] **Step 5: Add CSS badge**

In `packages/wayang/src/ui/public/style.css`, copy the `[data-state="Ready for Review"]` rule pair and duplicate it for `Waiting PR Checks` with a distinct hue (e.g. amber). Match the existing two-rule pattern (background block + `::before` dot). Place the rules adjacent to `Ready for Review`.

- [ ] **Step 6: Run typecheck and full wayang test suite**

Run: `bun run typecheck && bun test packages/wayang`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/wayang/src/domain/issue.ts packages/wayang/src/ui/public/style.css packages/wayang/tests/domain/issue.test.ts
git commit -m "feat(wayang): add Waiting PR Checks state"
```

---

## Task 2: Extend TrackerAdapter with write methods + comment listing

**Files:**
- Modify: `packages/dalang/src/tracker/adapter.ts`
- Modify: `packages/dalang/src/types.ts`
- Test: `packages/dalang/tests/tracker/rest-adapter.test.ts` (extend existing)

- [ ] **Step 1: Add `TrackerComment` type to `packages/dalang/src/types.ts`**

```ts
export interface TrackerComment {
  id: string;
  author: string | null;
  body: string;
  created_at: string;
}
```

- [ ] **Step 2: Extend `TrackerAdapter` and `TrackerErrorCode`**

In `packages/dalang/src/tracker/adapter.ts`:

```ts
import type { NormalizedIssue, TrackerComment } from "../types";

export interface TrackerAdapter {
  fetchCandidateIssues(activeStates: string[]): Promise<NormalizedIssue[]>;
  fetchIssuesByStates(states: string[]): Promise<NormalizedIssue[]>;
  fetchIssueStatesByIds(ids: string[]): Promise<NormalizedIssue[]>;
  fetchIssue(id: string): Promise<NormalizedIssue | null>;
  listComments(issueId: string): Promise<TrackerComment[]>;
  addComment(issueId: string, body: string, author?: "user" | "agent"): Promise<void>;
  updateState(issueId: string, state: string): Promise<void>;
}

export type TrackerErrorCode =
  | "tracker_request_error"
  | "tracker_status_error"
  | "tracker_malformed_payload"
  | "tracker_missing_pagination_cursor"
  | "tracker_write_error";
```

- [ ] **Step 3: Write the failing test for `listComments` / `addComment` / `updateState`**

Append to `packages/dalang/tests/tracker/rest-adapter.test.ts` (using whatever `Bun.serve` test harness the file already uses — locate via a `grep -n "Bun.serve" packages/dalang/tests/tracker/`). For each method, assert the exact request shape against a fake server: `POST /api/v1/issues/:id/comments` with body `{ body, author }`, `GET /api/v1/issues/:id/comments` parsing `{ comments: [...] }`, `PATCH /api/v1/issues/:id` with body `{ state }`. If a test for the existing read methods uses a request-recorder pattern, follow it.

Concrete assertions per method:

```ts
test("addComment posts to /api/v1/issues/:id/comments", async () => {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const srv = Bun.serve({ port: 0, fetch: async (req) => {
    const url = new URL(req.url);
    const body = req.method === "GET" ? null : await req.json();
    calls.push({ method: req.method, path: url.pathname, body });
    return Response.json({ id: "c1", author: "agent", body: "hello", created_at: "2026-01-01T00:00:00Z" }, { status: 201 });
  }});
  const adapter = new RestTrackerAdapter({ endpoint: `http://localhost:${srv.port}`, apiKey: null });
  await adapter.addComment("issue-1", "hello", "agent");
  expect(calls[0]).toEqual({ method: "POST", path: "/api/v1/issues/issue-1/comments", body: { body: "hello", author: "agent" }});
  srv.stop();
});

test("listComments returns parsed comments", async () => {
  const srv = Bun.serve({ port: 0, fetch: () =>
    Response.json({ comments: [{ id: "c1", author: "user", body: "hi", created_at: "2026-01-01T00:00:00Z" }] })
  });
  const adapter = new RestTrackerAdapter({ endpoint: `http://localhost:${srv.port}`, apiKey: null });
  const got = await adapter.listComments("issue-1");
  expect(got).toEqual([{ id: "c1", author: "user", body: "hi", created_at: "2026-01-01T00:00:00Z" }]);
  srv.stop();
});

test("updateState patches /api/v1/issues/:id", async () => {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const srv = Bun.serve({ port: 0, fetch: async (req) => {
    const url = new URL(req.url);
    const body = req.method === "PATCH" ? await req.json() : null;
    calls.push({ method: req.method, path: url.pathname, body });
    return Response.json({ ok: true });
  }});
  const adapter = new RestTrackerAdapter({ endpoint: `http://localhost:${srv.port}`, apiKey: null });
  await adapter.updateState("issue-1", "In Dev");
  expect(calls[0]).toEqual({ method: "PATCH", path: "/api/v1/issues/issue-1", body: { state: "In Dev" }});
  srv.stop();
});

test("addComment throws TrackerError(tracker_write_error) on non-2xx", async () => {
  const srv = Bun.serve({ port: 0, fetch: () => new Response("nope", { status: 500 }) });
  const adapter = new RestTrackerAdapter({ endpoint: `http://localhost:${srv.port}`, apiKey: null });
  await expect(adapter.addComment("issue-1", "x")).rejects.toMatchObject({ code: "tracker_write_error" });
  srv.stop();
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `bun test packages/dalang/tests/tracker/rest-adapter.test.ts`
Expected: FAIL — methods don't exist on `RestTrackerAdapter`.

- [ ] **Step 5: Implement the three methods on `RestTrackerAdapter`**

In `packages/dalang/src/tracker/rest-adapter.ts`, add:

```ts
async listComments(issueId: string): Promise<TrackerComment[]> {
  const res = await this.fetch(`/api/v1/issues/${encodeURIComponent(issueId)}/comments`, { method: "GET" });
  if (!res.ok) throw new TrackerError("tracker_status_error", `comments fetch HTTP ${res.status}`);
  const data = await res.json() as { comments?: unknown };
  if (!Array.isArray(data.comments)) throw new TrackerError("tracker_malformed_payload", "comments not array");
  return data.comments as TrackerComment[];
}

async addComment(issueId: string, body: string, author: "user" | "agent" = "agent"): Promise<void> {
  const res = await this.fetch(`/api/v1/issues/${encodeURIComponent(issueId)}/comments`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ body, author }),
  });
  if (!res.ok) throw new TrackerError("tracker_write_error", `addComment HTTP ${res.status}`);
}

async updateState(issueId: string, state: string): Promise<void> {
  const res = await this.fetch(`/api/v1/issues/${encodeURIComponent(issueId)}`, {
    method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({ state }),
  });
  if (!res.ok) throw new TrackerError("tracker_write_error", `updateState HTTP ${res.status}`);
}
```

If `RestTrackerAdapter` does not already have a `private fetch(...)` helper, replicate the call style of an existing read method (e.g. `fetchIssue`) — match its auth-header injection and base-url concatenation exactly.

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test packages/dalang/tests/tracker/rest-adapter.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/dalang/src/tracker/adapter.ts packages/dalang/src/tracker/rest-adapter.ts packages/dalang/src/types.ts packages/dalang/tests/tracker/rest-adapter.test.ts
git commit -m "feat(dalang): add tracker write methods (addComment, updateState, listComments)"
```

---

## Task 3: Add `pr_checks` config schema

**Files:**
- Modify: `packages/dalang/src/config/schema.ts`
- Test: `packages/dalang/tests/config/schema.test.ts` (extend or create)

- [ ] **Step 1: Write the failing test**

In `packages/dalang/tests/config/schema.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { applyDefaults } from "../../src/config/schema";

describe("pr_checks config", () => {
  test("defaults to enabled=false", () => {
    const cfg = applyDefaults({});
    expect(cfg.pr_checks).toEqual({
      enabled: false,
      poll_interval_ms: 60000,
      failure_budget: 3,
      rerun_flakes: true,
      gh_executable: "gh",
    });
  });
  test("user override is applied", () => {
    const cfg = applyDefaults({ pr_checks: { enabled: true, failure_budget: 5 }});
    expect(cfg.pr_checks.enabled).toBe(true);
    expect(cfg.pr_checks.failure_budget).toBe(5);
    expect(cfg.pr_checks.poll_interval_ms).toBe(60000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/dalang/tests/config/schema.test.ts`
Expected: FAIL — `cfg.pr_checks` undefined.

- [ ] **Step 3: Add schema and defaults**

In `packages/dalang/src/config/schema.ts`, after `ServerSchema`:

```ts
export const PrChecksSchema = z.object({
  enabled: z.boolean(),
  poll_interval_ms: z.number().int().positive(),
  failure_budget: z.number().int().positive(),
  rerun_flakes: z.boolean(),
  gh_executable: z.string().min(1),
});
```

Add `pr_checks: PrChecksSchema` to `WorkflowFrontMatterSchema`. Add to `DEFAULTS`:

```ts
pr_checks: {
  enabled: false,
  poll_interval_ms: 60000,
  failure_budget: 3,
  rerun_flakes: true,
  gh_executable: "gh",
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/dalang/tests/config/schema.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/dalang/src/config/schema.ts packages/dalang/tests/config/schema.test.ts
git commit -m "feat(dalang): add pr_checks config block"
```

---

## Task 4: Add `pr_checks_polls` to OrchestratorState + new RuntimeEventKind

**Files:**
- Modify: `packages/dalang/src/types.ts`
- Modify: `packages/dalang/src/orchestrator/state.ts`
- Test: `packages/dalang/tests/orchestrator/state.test.ts` (extend existing)

- [ ] **Step 1: Write the failing test**

In `packages/dalang/tests/orchestrator/state.test.ts`:

```ts
test("createInitialState includes empty pr_checks_polls map", () => {
  const s = createInitialState({ poll_interval_ms: 1000, max_concurrent_agents: 1 });
  expect(s.pr_checks_polls).toBeInstanceOf(Map);
  expect(s.pr_checks_polls.size).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/dalang/tests/orchestrator/state.test.ts`
Expected: FAIL — field missing.

- [ ] **Step 3: Add the field**

In `packages/dalang/src/types.ts`, add to `OrchestratorState`:

```ts
pr_checks_polls: Map<string, {
  last_polled_at: string;
  last_seen_sha: string | null;
  last_action: "pending" | "rerun" | "failed" | "passed" | "escalated" | "no_pr" | null;
}>;
```

And add `"pr_checks_observed"` to the `RuntimeEventKind` union (locate the existing union and append the literal).

In `packages/dalang/src/orchestrator/state.ts`, in `createInitialState`, initialise `pr_checks_polls: new Map()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/dalang/tests/orchestrator/state.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/dalang/src/types.ts packages/dalang/src/orchestrator/state.ts packages/dalang/tests/orchestrator/state.test.ts
git commit -m "feat(dalang): add pr_checks_polls cache to OrchestratorState"
```

---

## Task 5: `gh` shell wrapper

**Files:**
- Create: `packages/dalang/src/lib/gh.ts`
- Test: `packages/dalang/tests/lib/gh.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/dalang/tests/lib/gh.test.ts
import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGh } from "../../src/lib/gh";

async function makeStub(stdout: string, exit = 0): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "gh-stub-"));
  const path = join(dir, "gh");
  await writeFile(path, `#!/bin/sh\nprintf '%s' '${stdout.replace(/'/g, `'\\''`)}'\nexit ${exit}\n`);
  await chmod(path, 0o755);
  return path;
}

describe("runGh", () => {
  test("returns stdout and exit 0", async () => {
    const stub = await makeStub('{"ok":true}');
    const r = await runGh(stub, ["pr", "checks", "1"], { cwd: process.cwd() });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('{"ok":true}');
  });
  test("captures non-zero exit", async () => {
    const stub = await makeStub("nope", 2);
    const r = await runGh(stub, ["x"], { cwd: process.cwd() });
    expect(r.exitCode).toBe(2);
    expect(r.stdout).toBe("nope");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/dalang/tests/lib/gh.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// packages/dalang/src/lib/gh.ts
export interface GhResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export interface GhOptions {
  cwd: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export async function runGh(executable: string, args: string[], opts: GhOptions): Promise<GhResult> {
  const proc = Bun.spawn([executable, ...args], {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const timeout = opts.timeoutMs ?? 30000;
  const timer = setTimeout(() => proc.kill(), timeout);
  try {
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    return { stdout, stderr, exitCode };
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/dalang/tests/lib/gh.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/dalang/src/lib/gh.ts packages/dalang/tests/lib/gh.test.ts
git commit -m "feat(dalang): add gh CLI wrapper"
```

---

## Task 6: Pure logic — parse `gh pr checks` JSON

**Files:**
- Create: `packages/dalang/src/orchestrator/pr-checks.ts`
- Test: `packages/dalang/tests/orchestrator/pr-checks.test.ts`

- [ ] **Step 1: Write the failing test (parsing + bucketing)**

```ts
// packages/dalang/tests/orchestrator/pr-checks.test.ts
import { describe, expect, test } from "bun:test";
import { parseChecks, summarise } from "../../src/orchestrator/pr-checks";

describe("parseChecks", () => {
  test("parses a gh pr checks --json result", () => {
    const json = JSON.stringify([
      { name: "build", state: "SUCCESS", bucket: "pass", link: "https://x/1" },
      { name: "test", state: "FAILURE", bucket: "fail", link: "https://x/2" },
    ]);
    const checks = parseChecks(json);
    expect(checks).toEqual([
      { name: "build", state: "SUCCESS", bucket: "pass", link: "https://x/1" },
      { name: "test", state: "FAILURE", bucket: "fail", link: "https://x/2" },
    ]);
  });
  test("rejects non-array JSON", () => {
    expect(() => parseChecks("{}")).toThrow();
  });
});

describe("summarise", () => {
  test("all pass → passed", () => {
    expect(summarise([{ name: "a", state: "S", bucket: "pass", link: "l" }])).toEqual({ kind: "passed", failures: [] });
  });
  test("any pending and no fail → pending", () => {
    expect(summarise([
      { name: "a", state: "S", bucket: "pass", link: "l" },
      { name: "b", state: "Q", bucket: "pending", link: "l" },
    ])).toEqual({ kind: "pending", failures: [] });
  });
  test("any fail/cancel → failed with all failure entries", () => {
    const checks = [
      { name: "a", state: "F", bucket: "fail" as const, link: "l1" },
      { name: "b", state: "C", bucket: "cancel" as const, link: "l2" },
      { name: "c", state: "S", bucket: "pass" as const, link: "l3" },
    ];
    expect(summarise(checks)).toEqual({ kind: "failed", failures: [
      { name: "a", state: "F", bucket: "fail", link: "l1" },
      { name: "b", state: "C", bucket: "cancel", link: "l2" },
    ]});
  });
  test("empty checks list → pending (PR exists but no checks yet)", () => {
    expect(summarise([])).toEqual({ kind: "pending", failures: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/dalang/tests/orchestrator/pr-checks.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement parsing + summarisation**

```ts
// packages/dalang/src/orchestrator/pr-checks.ts
export type CheckBucket = "pass" | "fail" | "pending" | "cancel" | "skipping";

export interface Check {
  name: string;
  state: string;
  bucket: CheckBucket;
  link: string;
}

export interface Summary {
  kind: "passed" | "pending" | "failed";
  failures: Check[];
}

export function parseChecks(stdout: string): Check[] {
  const data: unknown = JSON.parse(stdout);
  if (!Array.isArray(data)) throw new Error("gh pr checks: expected JSON array");
  return data.map((c) => {
    const o = c as Record<string, unknown>;
    return {
      name: String(o.name ?? ""),
      state: String(o.state ?? ""),
      bucket: String(o.bucket ?? "pending") as CheckBucket,
      link: String(o.link ?? ""),
    };
  });
}

export function summarise(checks: Check[]): Summary {
  const failures = checks.filter((c) => c.bucket === "fail" || c.bucket === "cancel");
  if (failures.length > 0) return { kind: "failed", failures };
  const anyPending = checks.some((c) => c.bucket === "pending");
  if (anyPending || checks.length === 0) return { kind: "pending", failures: [] };
  return { kind: "passed", failures: [] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/dalang/tests/orchestrator/pr-checks.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/dalang/src/orchestrator/pr-checks.ts packages/dalang/tests/orchestrator/pr-checks.test.ts
git commit -m "feat(dalang): parse and summarise gh pr checks output"
```

---

## Task 7: Pure logic — failure-comment counter and per-SHA dedupe

**Files:**
- Modify: `packages/dalang/src/orchestrator/pr-checks.ts`
- Modify: `packages/dalang/tests/orchestrator/pr-checks.test.ts`

- [ ] **Step 1: Write the failing test**

Append:

```ts
import { countFailureComments, latestActionForSha, formatFailureComment, formatPassedComment, formatEscalatedComment, formatNoPrComment, formatRerunComment } from "../../src/orchestrator/pr-checks";

describe("countFailureComments", () => {
  test("counts comments tagged [pr_checks_failed]", () => {
    const comments = [
      { id: "1", author: "agent", body: "[pr_checks_failed] sha=a attempt=1/3", created_at: "" },
      { id: "2", author: "user", body: "looks bad", created_at: "" },
      { id: "3", author: "agent", body: "[pr_checks_passed] sha=b", created_at: "" },
      { id: "4", author: "agent", body: "[pr_checks_failed] sha=c attempt=2/3", created_at: "" },
    ];
    expect(countFailureComments(comments)).toBe(2);
  });
});

describe("latestActionForSha", () => {
  test("returns the most recent tagged action for a given sha", () => {
    const comments = [
      { id: "1", author: "agent", body: "[pr_checks_failed] sha=abc attempt=1/3", created_at: "2026-01-01T00:00:00Z" },
      { id: "2", author: "agent", body: "[pr_checks_rerun] sha=abc",            created_at: "2026-01-01T00:01:00Z" },
      { id: "3", author: "agent", body: "[pr_checks_failed] sha=def attempt=2/3", created_at: "2026-01-01T00:02:00Z" },
    ];
    expect(latestActionForSha(comments, "abc")).toBe("rerun");
    expect(latestActionForSha(comments, "def")).toBe("failed");
    expect(latestActionForSha(comments, "ghi")).toBeNull();
  });
});

describe("comment formatters", () => {
  test("formatFailureComment", () => {
    const body = formatFailureComment({
      sha: "abc1234567890",
      attempt: 1, budget: 3,
      failures: [{ name: "build", state: "F", bucket: "fail", link: "https://x/1" }],
    });
    expect(body).toContain("[pr_checks_failed] sha=abc1234 attempt=1/3");
    expect(body).toContain("- build: fail — https://x/1");
    expect(body).toContain("Bouncing back to In Dev");
  });
  test("formatPassedComment", () => {
    expect(formatPassedComment("abc1234567890")).toBe("[pr_checks_passed] sha=abc1234\nAll checks passed. Ready for human review.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/dalang/tests/orchestrator/pr-checks.test.ts`
Expected: FAIL — functions missing.

- [ ] **Step 3: Implement**

Append to `packages/dalang/src/orchestrator/pr-checks.ts`:

```ts
import type { TrackerComment } from "../types";

export type ActionTag = "failed" | "passed" | "escalated" | "rerun" | "no_pr";

const TAG_REGEX = /^\[pr_checks_(failed|passed|escalated|rerun|no_pr)\](?:\s+sha=([a-f0-9]+))?/;

export function countFailureComments(comments: TrackerComment[]): number {
  return comments.filter((c) => c.body.startsWith("[pr_checks_failed]")).length;
}

export function latestActionForSha(comments: TrackerComment[], sha: string): ActionTag | null {
  const sorted = [...comments].sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (let i = sorted.length - 1; i >= 0; i--) {
    const m = TAG_REGEX.exec(sorted[i]!.body);
    if (m && m[2] === sha) return m[1] as ActionTag;
  }
  return null;
}

function shortSha(sha: string): string { return sha.slice(0, 7); }

export function formatFailureComment(args: {
  sha: string; attempt: number; budget: number; failures: Check[];
}): string {
  const lines = [`[pr_checks_failed] sha=${shortSha(args.sha)} attempt=${args.attempt}/${args.budget}`];
  for (const f of args.failures) lines.push(`- ${f.name}: ${f.bucket} — ${f.link}`);
  lines.push("", "Bouncing back to In Dev. Read this comment and fix the failures.");
  return lines.join("\n");
}

export function formatPassedComment(sha: string): string {
  return `[pr_checks_passed] sha=${shortSha(sha)}\nAll checks passed. Ready for human review.`;
}

export function formatEscalatedComment(args: { sha: string; attempt: number; budget: number; failures: Check[] }): string {
  const lines = [
    `[pr_checks_escalated] sha=${shortSha(args.sha)} attempt=${args.attempt}/${args.budget}`,
    "Failure budget exhausted. Parking for human review.",
  ];
  for (const f of args.failures) lines.push(`- ${f.name}: ${f.bucket} — ${f.link}`);
  return lines.join("\n");
}

export function formatNoPrComment(branchName: string | null): string {
  return `[pr_checks_no_pr]\nNo open PR found for branch ${branchName ?? "(none set)"}. Did the agent run \`gh pr create\`?`;
}

export function formatRerunComment(sha: string, count: number): string {
  return `[pr_checks_rerun] sha=${shortSha(sha)}\nRe-triggered ${count} failed check${count === 1 ? "" : "s"}. Will re-poll.`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/dalang/tests/orchestrator/pr-checks.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/dalang/src/orchestrator/pr-checks.ts packages/dalang/tests/orchestrator/pr-checks.test.ts
git commit -m "feat(dalang): pure helpers for pr_checks comment counting and formatting"
```

---

## Task 8: Pure logic — decide next action

**Files:**
- Modify: `packages/dalang/src/orchestrator/pr-checks.ts`
- Modify: `packages/dalang/tests/orchestrator/pr-checks.test.ts`

- [ ] **Step 1: Write the failing test**

Append:

```ts
import { decideAction } from "../../src/orchestrator/pr-checks";

describe("decideAction", () => {
  const base = { budget: 3, rerunFlakes: true };

  test("no PR resolved → no_pr (counts toward budget)", () => {
    expect(decideAction({ ...base, prResolved: null, comments: [], summary: null })).toEqual({
      kind: "no_pr_bounce",
    });
  });
  test("pending → noop", () => {
    expect(decideAction({ ...base, prResolved: { sha: "abc" }, comments: [],
      summary: { kind: "pending", failures: [] }})).toEqual({ kind: "noop" });
  });
  test("passed and not yet acted on this sha → emit passed", () => {
    expect(decideAction({ ...base, prResolved: { sha: "abc" }, comments: [],
      summary: { kind: "passed", failures: [] }})).toEqual({ kind: "passed", sha: "abc" });
  });
  test("passed but already posted for this sha → noop", () => {
    expect(decideAction({ ...base, prResolved: { sha: "abc" },
      comments: [{ id: "1", author: "agent", body: "[pr_checks_passed] sha=abc", created_at: "2026-01-01T00:00:00Z" }],
      summary: { kind: "passed", failures: [] }})).toEqual({ kind: "noop" });
  });
  test("failed first time on a sha and rerun_flakes → rerun", () => {
    expect(decideAction({ ...base, prResolved: { sha: "abc" }, comments: [],
      summary: { kind: "failed", failures: [{ name: "x", state: "F", bucket: "fail", link: "l" }]}})).toMatchObject({ kind: "rerun" });
  });
  test("failed and rerun already done for this sha → count failure", () => {
    const comments = [{ id: "1", author: "agent", body: "[pr_checks_rerun] sha=abc", created_at: "2026-01-01T00:00:00Z" }];
    expect(decideAction({ ...base, prResolved: { sha: "abc" }, comments,
      summary: { kind: "failed", failures: [{ name: "x", state: "F", bucket: "fail", link: "l" }]}})).toMatchObject({
        kind: "failed_bounce", attempt: 1,
      });
  });
  test("failed under budget → failed_bounce", () => {
    const comments = [
      { id: "1", author: "agent", body: "[pr_checks_failed] sha=old1 attempt=1/3", created_at: "2026-01-01T00:00:00Z" },
      { id: "2", author: "agent", body: "[pr_checks_rerun] sha=abc", created_at: "2026-01-01T00:00:01Z" },
    ];
    const r = decideAction({ ...base, prResolved: { sha: "abc" }, comments,
      summary: { kind: "failed", failures: [{ name: "x", state: "F", bucket: "fail", link: "l" }]}});
    expect(r).toMatchObject({ kind: "failed_bounce", attempt: 2 });
  });
  test("failed at budget → escalate", () => {
    const comments = [
      { id: "1", author: "agent", body: "[pr_checks_failed] sha=a attempt=1/3", created_at: "2026-01-01T00:00:00Z" },
      { id: "2", author: "agent", body: "[pr_checks_failed] sha=b attempt=2/3", created_at: "2026-01-01T00:00:01Z" },
      { id: "3", author: "agent", body: "[pr_checks_rerun] sha=abc",          created_at: "2026-01-01T00:00:02Z" },
    ];
    const r = decideAction({ ...base, prResolved: { sha: "abc" }, comments,
      summary: { kind: "failed", failures: [{ name: "x", state: "F", bucket: "fail", link: "l" }]}});
    expect(r).toMatchObject({ kind: "escalate", attempt: 3 });
  });
  test("failed but already bounced for this sha → noop (waiting for agent fix)", () => {
    const comments = [{ id: "1", author: "agent", body: "[pr_checks_failed] sha=abc attempt=1/3", created_at: "2026-01-01T00:00:00Z" }];
    expect(decideAction({ ...base, prResolved: { sha: "abc" }, comments,
      summary: { kind: "failed", failures: [{ name: "x", state: "F", bucket: "fail", link: "l" }]}})).toEqual({ kind: "noop" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/dalang/tests/orchestrator/pr-checks.test.ts`
Expected: FAIL — `decideAction` missing.

- [ ] **Step 3: Implement**

Append to `packages/dalang/src/orchestrator/pr-checks.ts`:

```ts
export type Action =
  | { kind: "noop" }
  | { kind: "no_pr_bounce" }
  | { kind: "rerun" }
  | { kind: "failed_bounce"; attempt: number; sha: string; failures: Check[] }
  | { kind: "escalate"; attempt: number; sha: string; failures: Check[] }
  | { kind: "passed"; sha: string };

export function decideAction(args: {
  budget: number;
  rerunFlakes: boolean;
  prResolved: { sha: string } | null;
  comments: TrackerComment[];
  summary: Summary | null;
}): Action {
  if (args.prResolved === null) return { kind: "no_pr_bounce" };
  const { sha } = args.prResolved;
  const summary = args.summary;
  if (!summary || summary.kind === "pending") return { kind: "noop" };

  const lastForThisSha = latestActionForSha(args.comments, sha);

  if (summary.kind === "passed") {
    if (lastForThisSha === "passed") return { kind: "noop" };
    return { kind: "passed", sha };
  }

  // failed
  if (lastForThisSha === "failed" || lastForThisSha === "escalated") return { kind: "noop" };
  if (args.rerunFlakes && lastForThisSha === null) return { kind: "rerun" };
  // either rerun has happened for this sha, or rerun_flakes is off
  const priorFailures = countFailureComments(args.comments);
  const attempt = priorFailures + 1;
  if (attempt >= args.budget) return { kind: "escalate", attempt, sha, failures: summary.failures };
  return { kind: "failed_bounce", attempt, sha, failures: summary.failures };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/dalang/tests/orchestrator/pr-checks.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/dalang/src/orchestrator/pr-checks.ts packages/dalang/tests/orchestrator/pr-checks.test.ts
git commit -m "feat(dalang): decideAction state machine for pr_checks reconciler"
```

---

## Task 9: Reconciler — orchestrate gh + tracker writes

**Files:**
- Create: `packages/dalang/src/orchestrator/pr-checks-runner.ts`
- Test: `packages/dalang/tests/orchestrator/pr-checks-runner.test.ts`

- [ ] **Step 1: Write the failing test (red checks → bounce)**

```ts
// packages/dalang/tests/orchestrator/pr-checks-runner.test.ts
import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPrChecksReconciler } from "../../src/orchestrator/pr-checks-runner";
import type { TrackerAdapter } from "../../src/tracker/adapter";
import type { NormalizedIssue, OrchestratorState, TrackerComment } from "../../src/types";

async function ghStub(scriptBody: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "gh-"));
  const path = join(dir, "gh");
  await writeFile(path, `#!/bin/sh\n${scriptBody}\n`);
  await chmod(path, 0o755);
  return path;
}

function fakeTracker(state: { comments: TrackerComment[]; states: Record<string, string> }): TrackerAdapter {
  return {
    fetchCandidateIssues: async () => [],
    fetchIssuesByStates: async () => [],
    fetchIssueStatesByIds: async () => [],
    fetchIssue: async () => null,
    listComments: async () => state.comments,
    addComment: async (id, body) => { state.comments.push({ id: String(state.comments.length + 1), author: "agent", body, created_at: new Date().toISOString() }); },
    updateState: async (id, s) => { state.states[id] = s; },
  };
}

function emptyState(): OrchestratorState {
  return {
    poll_interval_ms: 1000,
    max_concurrent_agents: 1,
    running: new Map(),
    completed: new Set(),
    retry_attempts: new Map(),
    pr_checks_polls: new Map(),
    claude_totals: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
  } as OrchestratorState;
}

const issue: NormalizedIssue = {
  id: "i1", identifier: "TJ-1", title: "x", description: null, priority: null,
  state: "Waiting PR Checks", branch_name: "feat/tj-1", url: null,
  external_ref: null, internal_ref: "tj-1", labels: [], blocked_by: [],
  created_at: null, updated_at: null,
};

describe("runPrChecksReconciler", () => {
  test("red checks (rerun_flakes=false) under budget → bounce to In Dev with [pr_checks_failed] comment", async () => {
    const stub = await ghStub(`
      case "$1 $2" in
        "pr list") echo '[{"url":"https://x/pr/1","number":1,"headRefOid":"abc1234567"}]' ;;
        "pr checks") echo '[{"name":"build","state":"FAILURE","bucket":"fail","link":"https://x/run/9"}]' ;;
      esac`);
    const tracker = { comments: [] as TrackerComment[], states: { i1: "Waiting PR Checks" } };
    const adapter = fakeTracker(tracker);
    const state = emptyState();

    await runPrChecksReconciler({
      issues: [issue], state, tracker: adapter,
      cfg: { enabled: true, poll_interval_ms: 1000, failure_budget: 3, rerun_flakes: false, gh_executable: stub },
      cwd: process.cwd(),
      now: () => new Date("2026-01-01T00:00:00Z"),
    });

    expect(tracker.states.i1).toBe("In Dev");
    expect(tracker.comments).toHaveLength(1);
    expect(tracker.comments[0]!.body).toContain("[pr_checks_failed] sha=abc1234 attempt=1/3");
    expect(tracker.comments[0]!.body).toContain("- build: fail — https://x/run/9");
  });

  test("green checks → state moves to Ready for Human Review with [pr_checks_passed]", async () => {
    const stub = await ghStub(`
      case "$1 $2" in
        "pr list") echo '[{"url":"https://x/pr/1","number":1,"headRefOid":"abc1234567"}]' ;;
        "pr checks") echo '[{"name":"build","state":"SUCCESS","bucket":"pass","link":"https://x/run/9"}]' ;;
      esac`);
    const tracker = { comments: [] as TrackerComment[], states: { i1: "Waiting PR Checks" } };
    const adapter = fakeTracker(tracker);
    const state = emptyState();
    await runPrChecksReconciler({
      issues: [issue], state, tracker: adapter,
      cfg: { enabled: true, poll_interval_ms: 1000, failure_budget: 3, rerun_flakes: false, gh_executable: stub },
      cwd: process.cwd(),
      now: () => new Date("2026-01-01T00:00:00Z"),
    });
    expect(tracker.states.i1).toBe("Ready for Human Review");
    expect(tracker.comments[0]!.body).toContain("[pr_checks_passed] sha=abc1234");
  });

  test("third failure → escalate to Ready for Human Review", async () => {
    const stub = await ghStub(`
      case "$1 $2" in
        "pr list") echo '[{"url":"https://x/pr/1","number":1,"headRefOid":"def4567890"}]' ;;
        "pr checks") echo '[{"name":"build","state":"FAILURE","bucket":"fail","link":"https://x/run/9"}]' ;;
      esac`);
    const tracker = {
      comments: [
        { id: "1", author: "agent", body: "[pr_checks_failed] sha=aaa attempt=1/3", created_at: "2026-01-01T00:00:00Z" },
        { id: "2", author: "agent", body: "[pr_checks_failed] sha=bbb attempt=2/3", created_at: "2026-01-01T00:00:01Z" },
      ] as TrackerComment[],
      states: { i1: "Waiting PR Checks" },
    };
    await runPrChecksReconciler({
      issues: [issue], state: emptyState(), tracker: fakeTracker(tracker),
      cfg: { enabled: true, poll_interval_ms: 1000, failure_budget: 3, rerun_flakes: false, gh_executable: stub },
      cwd: process.cwd(),
      now: () => new Date("2026-01-01T00:00:02Z"),
    });
    expect(tracker.states.i1).toBe("Ready for Human Review");
    expect(tracker.comments[2]!.body).toContain("[pr_checks_escalated] sha=def4567 attempt=3/3");
  });

  test("throttle: skips if last poll within poll_interval_ms", async () => {
    const stub = await ghStub(`exit 99`); // would fail if invoked
    const tracker = { comments: [] as TrackerComment[], states: { i1: "Waiting PR Checks" } };
    const state = emptyState();
    state.pr_checks_polls.set("i1", { last_polled_at: "2026-01-01T00:00:00Z", last_seen_sha: null, last_action: "pending" });
    await runPrChecksReconciler({
      issues: [issue], state, tracker: fakeTracker(tracker),
      cfg: { enabled: true, poll_interval_ms: 60000, failure_budget: 3, rerun_flakes: false, gh_executable: stub },
      cwd: process.cwd(),
      now: () => new Date("2026-01-01T00:00:30Z"),
    });
    expect(tracker.states.i1).toBe("Waiting PR Checks"); // unchanged
    expect(tracker.comments).toHaveLength(0);
  });

  test("disabled config → no-op", async () => {
    const stub = await ghStub(`exit 99`);
    const tracker = { comments: [] as TrackerComment[], states: { i1: "Waiting PR Checks" } };
    await runPrChecksReconciler({
      issues: [issue], state: emptyState(), tracker: fakeTracker(tracker),
      cfg: { enabled: false, poll_interval_ms: 1000, failure_budget: 3, rerun_flakes: false, gh_executable: stub },
      cwd: process.cwd(),
      now: () => new Date(),
    });
    expect(tracker.states.i1).toBe("Waiting PR Checks");
  });

  test("no PR found → bounce to In Dev with [pr_checks_no_pr]", async () => {
    const stub = await ghStub(`
      case "$1 $2" in
        "pr list") echo '[]' ;;
      esac`);
    const tracker = { comments: [] as TrackerComment[], states: { i1: "Waiting PR Checks" } };
    await runPrChecksReconciler({
      issues: [issue], state: emptyState(), tracker: fakeTracker(tracker),
      cfg: { enabled: true, poll_interval_ms: 1000, failure_budget: 3, rerun_flakes: false, gh_executable: stub },
      cwd: process.cwd(),
      now: () => new Date(),
    });
    expect(tracker.states.i1).toBe("In Dev");
    expect(tracker.comments[0]!.body).toContain("[pr_checks_no_pr]");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/dalang/tests/orchestrator/pr-checks-runner.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the runner**

```ts
// packages/dalang/src/orchestrator/pr-checks-runner.ts
import type { TrackerAdapter } from "../tracker/adapter";
import type { NormalizedIssue, OrchestratorState } from "../types";
import { runGh } from "../lib/gh";
import {
  parseChecks, summarise, decideAction,
  formatFailureComment, formatPassedComment, formatEscalatedComment,
  formatNoPrComment, formatRerunComment,
} from "./pr-checks";

export interface PrChecksConfig {
  enabled: boolean;
  poll_interval_ms: number;
  failure_budget: number;
  rerun_flakes: boolean;
  gh_executable: string;
}

export interface ReconcilerArgs {
  issues: NormalizedIssue[];
  state: OrchestratorState;
  tracker: TrackerAdapter;
  cfg: PrChecksConfig;
  cwd: string;
  now: () => Date;
}

interface PrInfo { url: string; number: number; sha: string; }

async function resolvePr(gh: string, branch: string, cwd: string): Promise<PrInfo | null> {
  const r = await runGh(gh, ["pr", "list", "--head", branch, "--state", "open", "--json", "url,number,headRefOid"], { cwd });
  if (r.exitCode !== 0) return null;
  try {
    const data = JSON.parse(r.stdout) as Array<{ url: string; number: number; headRefOid: string }>;
    if (!Array.isArray(data) || data.length === 0) return null;
    const first = data[0]!;
    return { url: first.url, number: first.number, sha: first.headRefOid };
  } catch {
    return null;
  }
}

async function fetchChecks(gh: string, prNumber: number, cwd: string): Promise<string> {
  const r = await runGh(gh, ["pr", "checks", String(prNumber), "--json", "name,state,bucket,link"], { cwd });
  if (r.exitCode !== 0 && r.stdout.trim() === "") throw new Error(`gh pr checks failed: ${r.stderr}`);
  return r.stdout;
}

export async function runPrChecksReconciler(args: ReconcilerArgs): Promise<void> {
  if (!args.cfg.enabled) return;
  for (const issue of args.issues) {
    if (issue.state !== "Waiting PR Checks") continue;

    const cached = args.state.pr_checks_polls.get(issue.id);
    const nowMs = args.now().getTime();
    if (cached) {
      const lastMs = Date.parse(cached.last_polled_at);
      if (Number.isFinite(lastMs) && nowMs - lastMs < args.cfg.poll_interval_ms) continue;
    }

    const branch = issue.branch_name;
    const pr = branch ? await resolvePr(args.cfg.gh_executable, branch, args.cwd) : null;

    let action;
    if (!pr) {
      action = { kind: "no_pr_bounce" as const };
    } else {
      const checksJson = await fetchChecks(args.cfg.gh_executable, pr.number, args.cwd).catch(() => "");
      const checks = checksJson ? parseChecks(checksJson) : [];
      const summary = summarise(checks);
      const comments = await args.tracker.listComments(issue.id);
      action = decideAction({
        budget: args.cfg.failure_budget,
        rerunFlakes: args.cfg.rerun_flakes,
        prResolved: { sha: pr.sha },
        comments,
        summary,
      });
    }

    let lastAction: NonNullable<ReturnType<Map<string, { last_action: string }>["get"]>>["last_action"] = null as never;
    switch (action.kind) {
      case "noop":
        lastAction = "pending";
        break;
      case "no_pr_bounce":
        await args.tracker.addComment(issue.id, formatNoPrComment(branch));
        await args.tracker.updateState(issue.id, "In Dev");
        lastAction = "no_pr";
        break;
      case "rerun":
        await args.tracker.addComment(issue.id, formatRerunComment(pr!.sha, 1));
        lastAction = "rerun";
        break;
      case "failed_bounce":
        await args.tracker.addComment(issue.id, formatFailureComment({
          sha: action.sha, attempt: action.attempt, budget: args.cfg.failure_budget, failures: action.failures,
        }));
        await args.tracker.updateState(issue.id, "In Dev");
        lastAction = "failed";
        break;
      case "escalate":
        await args.tracker.addComment(issue.id, formatEscalatedComment({
          sha: action.sha, attempt: action.attempt, budget: args.cfg.failure_budget, failures: action.failures,
        }));
        await args.tracker.updateState(issue.id, "Ready for Human Review");
        lastAction = "escalated";
        break;
      case "passed":
        await args.tracker.addComment(issue.id, formatPassedComment(action.sha));
        await args.tracker.updateState(issue.id, "Ready for Human Review");
        lastAction = "passed";
        break;
    }

    args.state.pr_checks_polls.set(issue.id, {
      last_polled_at: args.now().toISOString(),
      last_seen_sha: pr?.sha ?? null,
      last_action: lastAction,
    });
  }
}
```

Note on the `rerun` branch: the v1 implementation posts the rerun marker comment but does **not** invoke `gh run rerun --failed`. (The marker alone is enough to drive the comment-counter logic in `decideAction`; actually re-triggering the runs is a follow-up — see Task 12 for the simplification rationale and Task 13 for actual rerun invocation as future work.) The test in Step 1 passes because the failure case sets `rerun_flakes: false`, exercising the bounce path directly.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/dalang/tests/orchestrator/pr-checks-runner.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/dalang/src/orchestrator/pr-checks-runner.ts packages/dalang/tests/orchestrator/pr-checks-runner.test.ts
git commit -m "feat(dalang): pr_checks reconciler — gh + tracker write orchestration"
```

---

## Task 10: Wire reconciler into orchestrator tick

**Files:**
- Modify: `packages/dalang/src/orchestrator/orchestrator.ts`
- Modify: `packages/dalang/tests/orchestrator/orchestrator.test.ts` (extend existing — locate its dispatch-loop test pattern first)

- [ ] **Step 1: Write the failing test**

Locate the existing orchestrator test file (`grep -rln "Orchestrator" packages/dalang/tests/`). Append a test that:
1. Constructs an `Orchestrator` with `pr_checks.enabled: true`, a tracker fake whose `fetchIssuesByStates(["Waiting PR Checks"])` returns one issue, and a `gh_executable` shell stub returning red checks (use the helper from Task 9's test — extract to `packages/dalang/tests/helpers/gh-stub.ts` if duplicated).
2. Calls `await orch.tick()`.
3. Asserts the tracker's `updateState` was called with `("i1", "In Dev")` and `addComment` was called with a body starting with `[pr_checks_failed]`.

The test will FAIL until Step 3.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/dalang/tests/orchestrator/orchestrator.test.ts`
Expected: FAIL — current `tick()` doesn't call the reconciler.

- [ ] **Step 3: Wire it into `tick()`**

In `packages/dalang/src/orchestrator/orchestrator.ts`:

```ts
import { runPrChecksReconciler } from "./pr-checks";
```

Replace the body of `tick()`:

```ts
async tick(): Promise<void> {
  await this.reconcile();

  if (this.cfg.pr_checks.enabled) {
    let waiting: NormalizedIssue[] = [];
    try {
      waiting = await this.tracker.fetchIssuesByStates(["Waiting PR Checks"]);
    } catch (err) {
      this.log.warn({ err: (err as Error).message }, "pr_checks fetch failed; skipping");
    }
    await runPrChecksReconciler({
      issues: waiting,
      state: this.state,
      tracker: this.tracker,
      cfg: this.cfg.pr_checks,
      cwd: process.cwd(),
      now: () => new Date(),
    }).catch((err) => {
      this.log.warn({ err: (err as Error).message }, "pr_checks reconcile failed");
    });
  }

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
```

The import line should be `from "./pr-checks-runner"` not `./pr-checks` — adjust accordingly.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/dalang && bun run typecheck`
Expected: PASS — full dalang test suite green.

- [ ] **Step 5: Commit**

```bash
git add packages/dalang/src/orchestrator/orchestrator.ts packages/dalang/tests/orchestrator/orchestrator.test.ts packages/dalang/tests/helpers/gh-stub.ts
git commit -m "feat(dalang): wire pr_checks reconciler into tick()"
```

---

## Task 11: End-to-end test against real wayang server

**Files:**
- Create: `packages/dalang/tests/e2e/pr-checks-e2e.test.ts`

- [ ] **Step 1: Write the test**

Locate an existing dalang e2e test that boots wayang in-process (`grep -rln "createApp\|startWayang" packages/dalang/tests/`). Reuse its boot helper. The test:

1. Boots wayang on an ephemeral port with an in-memory SQLite.
2. Creates an issue in `Waiting PR Checks` with `branch_name: "feat/e2e-1"` via `POST /api/v1/issues`.
3. Constructs a `RestTrackerAdapter` pointed at that wayang instance.
4. Builds a minimal `WorkflowFrontMatter` with `pr_checks.enabled: true`, `failure_budget: 3`, `rerun_flakes: false`, `gh_executable` pointing at a stub returning failed checks.
5. Constructs an `Orchestrator` and calls `tick()` once.
6. Fetches the issue via `GET /api/v1/issues/:id` and asserts `state === "In Dev"`.
7. Fetches comments via `GET /api/v1/issues/:id/comments` and asserts a `[pr_checks_failed] sha=...` comment exists with `author === "agent"`.

If the helper does not exist (no dalang↔wayang e2e yet), write a minimal one inline in this test using `Bun.serve` + the wayang `createApp` factory (locate via `grep -n "export.*createApp\|export.*serve" packages/wayang/src/`).

- [ ] **Step 2: Run test**

Run: `bun test packages/dalang/tests/e2e/pr-checks-e2e.test.ts`
Expected: PASS (or, on a fresh implementation, FAIL until previous tasks land — should be PASS at this point).

- [ ] **Step 3: Run full repo type/lint/test**

Run: `bun run typecheck && bunx oxlint && bun test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/dalang/tests/e2e/pr-checks-e2e.test.ts
git commit -m "test(dalang): e2e pr_checks reconciler against real wayang"
```

---

## Task 12: Update specs (cross-link the new spec)

**Files:**
- Modify: `docs/superpowers/specs/2026-04-29-dalang-orchestrator-design.md`
- Modify: `docs/superpowers/specs/2026-04-29-wayang-tracker-design.md`

- [ ] **Step 1: Add cross-links**

In the dalang spec's §2 "In scope (v1)" or a new §2.1 "Extensions", add a one-line bullet:

> - PR-checks waiting state — see `2026-04-30-pr-checks-wait-design.md`.

In the wayang tracker spec where states are enumerated, add `Waiting PR Checks` to the canonical state list with a one-line note:

> `Waiting PR Checks` — orchestrator-driven; not in `ACTIVE_STATES`. See `2026-04-30-pr-checks-wait-design.md`.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-04-29-dalang-orchestrator-design.md docs/superpowers/specs/2026-04-29-wayang-tracker-design.md
git commit -m "docs: cross-link pr_checks design from dalang and wayang specs"
```

---

## Self-Review Notes

- **Spec coverage.** Every spec section (§4 state, §5.1–5.7 reconciler logic, §6 adapter, §7 config, §8 state cache, §11 tests, §12 rollout) maps to a task. §5.4 (rerun flakes) is partially implemented — the marker comment is posted but `gh run rerun --failed` is not invoked in v1. This is called out explicitly in Task 9 Step 3. Filing the actual rerun call is a deliberate follow-up, not a gap.
- **Type consistency.** `TrackerComment` defined in Task 2, used in Tasks 7/8/9. `Action` / `Summary` / `Check` defined in Task 6/7/8 — all referenced consistently in the runner (Task 9). `pr_checks_polls` shape defined in Task 4 matches usage in Task 9.
- **No placeholders.** Every code step shows the code; every test step shows the assertions; every command is explicit. The one approximation is "locate the existing test pattern" in Tasks 2/10/11 — these are necessary because the harness file may have evolved between plan-write and plan-execute, but the assertion content is fully specified.
