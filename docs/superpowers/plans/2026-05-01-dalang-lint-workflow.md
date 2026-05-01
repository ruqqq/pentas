# Dalang Workflow Lint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `dalang lint <WORKFLOW.md>` so workflow authors can validate front matter, import expansion, Liquid prompt references, filters, loop variables, and PR-check state names before dispatch.

**Architecture:** Reuse the existing `loadWorkflow()` pipeline so lint sees the same YAML defaults and imported prompt body as runtime dispatch. Add a focused `config/workflow-linter.ts` module that returns structured diagnostics, then wire a CLI subcommand that prints human-readable errors and exits non-zero on lint failures. Keep the Liquid prompt schema hand-maintained beside the linter so the runtime prompt context remains explicit and testable.

**Tech Stack:** Bun, TypeScript, `bun test`, `tsgo`, `oxlint`, `yaml`, `liquidjs`.

**Spec references:** `docs/superpowers/specs/2026-04-29-dalang-orchestrator-design.md` §6, `docs/superpowers/specs/2026-04-30-control-plane-github-projects-design.md` §5 and §7, `docs/superpowers/specs/2026-04-30-pr-checks-wait-design.md` §7.

---

## PRD Summary

**Problem Statement:** Invalid `WORKFLOW.md` files currently pass startup validation when the error is hidden in an unexecuted Liquid branch, then crash only when a dispatch renders that branch.

**Proposed Solution:** Add a lint subcommand that statically scans the merged prompt template and validates it against the known prompt context shape, while also reusing existing config validation and checking PR-check configured states.

**Success Criteria:**

- `dalang lint <WORKFLOW.md>` exits `0` and prints a success line for a valid workflow.
- The command exits non-zero and reports file-scoped diagnostics for invalid front matter, import expansion, unknown Liquid variables, unknown filters, bad `for` loop collections, and unknown loop property references.
- The linter rejects unknown top-level Liquid roots such as `project` or `foo`, not only dotted paths like `issue.foo`.
- The linter rejects `recent_history.summary` and any other field not present on the declared prompt context.
- The linter accepts `control_plane.*` and the legacy `tracker.*` alias with the same field set.
- The runtime `issue` context includes `project: string | null`, so accepting `issue.project` in lint matches what dispatch actually renders.
- When PR checks are enabled, the linter rejects configured wait/pass/fail/escalation states that are not present in `control_plane.active_states + control_plane.terminal_states`.

**Acceptance Criteria:**

- As a workflow author, I can run `dalang lint ./WORKFLOW.md` and see all static workflow errors before running the daemon.
- As an agent operator, I can rely on lint to catch the imported-template failure mode from `workflow/preamble.md` after imports are expanded.
- As a maintainer, I can add prompt context fields in one linter schema table and cover them with unit tests.

**Non-Goals:**

- Do not build a full Liquid type checker for arbitrary expressions.
- Do not attempt to prove branch reachability.
- Do not modify runtime prompt rendering behavior in `prompt-builder.ts`.
- Do not validate arbitrary state names outside the PR-check config fields and existing zod schema.

**ADR Decision:** No ADR is needed. The change stays inside the existing workflow loader, CLI, and prompt-builder contracts; it does not introduce a durable cross-package protocol or choose between long-lived architecture options.

## File Structure

- Create `packages/dalang/src/config/workflow-linter.ts`: structured diagnostics, context schema, Liquid prompt static checks, PR-check state validation.
- Create `packages/dalang/tests/config/workflow-linter.test.ts`: focused tests for merged imports, unknown paths, filters, loops, aliases, and PR-check state names.
- Modify `packages/dalang/src/types.ts`: add `project: string | null` to `WorkItem` / `NormalizedIssue` so the prompt context matches the accepted lint schema.
- Modify `packages/dalang/src/control-plane/normalize.ts` and `packages/dalang/src/control-plane/github/normalize.ts`: populate `project` from a string `raw.project` when one is already available, otherwise `null`. Do not invent a project name from unrelated fields.
- Update existing dalang fixtures that construct `WorkItem` / `NormalizedIssue` to include `project: null` unless a test intentionally exercises a project value.
- Modify `packages/dalang/src/cli/args.ts`: parse `lint <workflowPath>` while preserving current daemon argument behavior.
- Modify `packages/dalang/tests/cli/args.test.ts`: CLI parsing coverage for lint mode and existing daemon mode.
- Modify `packages/dalang/src/index.ts`: route lint mode before `Bootstrap`, print diagnostics, and set process exit code.
- Modify `packages/dalang/src/lib.ts`: export the linter for direct tests and future reuse.

## Task 1: Align Runtime Issue Context with the Requested Lint Schema

**Files:**

- Modify: `packages/dalang/src/types.ts`
- Modify: `packages/dalang/src/control-plane/normalize.ts`
- Modify: `packages/dalang/src/control-plane/github/normalize.ts`
- Modify: existing tests that construct `WorkItem` / `NormalizedIssue`

- [ ] **Step 1: Write failing type/normalizer tests for `issue.project`**

Update `packages/dalang/tests/types.test.ts`, `packages/dalang/tests/control-plane/normalize.test.ts`, and `packages/dalang/tests/control-plane/github/normalize.test.ts` so normalized work items expose `project: string | null`.

Expected coverage:

- `NormalizedIssue` fixtures must include `project`.
- Generic normalization accepts string `project` and defaults missing or malformed `project` to `null`.
- GitHub Projects normalization sets `project` from string project metadata only when the raw item exposes it; otherwise it falls back to `null`.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
bun test packages/dalang/tests/types.test.ts packages/dalang/tests/control-plane/normalize.test.ts packages/dalang/tests/control-plane/github/normalize.test.ts
```

Expected: FAIL until `WorkItem` and normalizers include `project`.

- [ ] **Step 3: Add the runtime field**

Add `project: string | null` to `WorkItem` in `packages/dalang/src/types.ts`.

Populate it in both normalizer paths:

- `packages/dalang/src/control-plane/normalize.ts`: accept string `raw.project`, else `null`.
- `packages/dalang/src/control-plane/github/normalize.ts`: accept a string `project` field exposed on the raw Project item if present; otherwise `null`.

Update all strict TS test fixtures that construct `WorkItem` / `NormalizedIssue`.

- [ ] **Step 4: Run tests**

Run:

```bash
bun test packages/dalang/tests/types.test.ts packages/dalang/tests/control-plane/normalize.test.ts packages/dalang/tests/control-plane/github/normalize.test.ts
```

Expected: PASS.

## Task 2: Add Linter Diagnostics and Context Schema

**Files:**

- Create: `packages/dalang/src/config/workflow-linter.ts`
- Test: `packages/dalang/tests/config/workflow-linter.test.ts`

- [ ] **Step 1: Write failing tests for prompt context validation**

Add `packages/dalang/tests/config/workflow-linter.test.ts`:

```ts
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { lintWorkflow } from "../../src/config/workflow-linter";

async function writeWorkflow(body: string, frontMatter = ""): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dalang-lint-"));
  const path = join(dir, "WORKFLOW.md");
  await writeFile(
    path,
    `---
${frontMatter}
---
${body}
`,
  );
  return path;
}

test("lint accepts known prompt context fields", async () => {
  const path = await writeWorkflow(`
{{ issue.identifier }} {{ issue.title }} {{ issue.project }}
{{ control_plane.kind }} {{ tracker.endpoint }}
{% for comment in recent_comments %}{{ comment.author }} {{ comment.created_at }}{% endfor %}
{% for entry in recent_history %}{{ entry.issue_id }} {{ entry.at }}{% endfor %}
`);

  const result = await lintWorkflow(path);

  expect(result.ok).toBe(true);
  expect(result.diagnostics).toEqual([]);
});

test("lint rejects unknown prompt context fields", async () => {
  const path = await writeWorkflow(`
{{ issue.not_a_field }}
{{ recent_history.summary }}
{{ project }}
{% if foo %}bad root{% endif %}
{% for entry in recent_history %}{{ entry.summary }}{% endfor %}
`);

  const result = await lintWorkflow(path);

  expect(result.ok).toBe(false);
  expect(result.diagnostics.map((d) => d.message)).toContain(
    "Unknown Liquid variable path `issue.not_a_field`",
  );
  expect(result.diagnostics.map((d) => d.message)).toContain(
    "Unknown Liquid variable path `recent_history.summary`",
  );
  expect(result.diagnostics.map((d) => d.message)).toContain(
    "Unknown Liquid variable path `project`",
  );
  expect(result.diagnostics.map((d) => d.message)).toContain(
    "Unknown Liquid variable path `foo`",
  );
  expect(result.diagnostics.map((d) => d.message)).toContain(
    "Unknown Liquid variable path `entry.summary`",
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
bun test packages/dalang/tests/config/workflow-linter.test.ts
```

Expected: FAIL because `workflow-linter.ts` does not exist.

- [ ] **Step 3: Implement diagnostic types, schema, and path validation**

Create `packages/dalang/src/config/workflow-linter.ts`:

```ts
import { Liquid } from "liquidjs";
import { loadWorkflow, WorkflowError } from "./workflow-loader";
import type { WorkflowFrontMatter } from "./schema";

export type WorkflowLintSeverity = "error";

export interface WorkflowLintDiagnostic {
  severity: WorkflowLintSeverity;
  code:
    | "workflow_load_error"
    | "unknown_liquid_variable"
    | "unknown_liquid_filter"
    | "invalid_liquid_for"
    | "invalid_pr_checks_state";
  message: string;
}

export interface WorkflowLintResult {
  ok: boolean;
  diagnostics: WorkflowLintDiagnostic[];
}

type SchemaNode = true | { readonly array?: SchemaNode; readonly fields?: Record<string, SchemaNode> };

const ISSUE_FIELDS = [
  "id",
  "identifier",
  "title",
  "description",
  "priority",
  "state",
  "branch_name",
  "url",
  "external_ref",
  "internal_ref",
  "labels",
  "blocked_by",
  "project",
  "created_at",
  "updated_at",
] as const;

const PROMPT_CONTEXT: Record<string, SchemaNode> = {
  issue: {
    fields: Object.fromEntries(ISSUE_FIELDS.map((field) => [field, true])),
  },
  attempt: true,
  control_plane: {
    fields: {
      kind: true,
      endpoint: true,
      api_key: true,
    },
  },
  tracker: {
    fields: {
      kind: true,
      endpoint: true,
      api_key: true,
    },
  },
  recent_comments: {
    array: {
      fields: {
        id: true,
        author: true,
        body: true,
        created_at: true,
      },
    },
  },
  recent_history: {
    array: {
      fields: {
        id: true,
        issue_id: true,
        kind: true,
        from_value: true,
        to_value: true,
        actor: true,
        at: true,
      },
    },
  },
};

const KNOWN_FILTERS = new Set([
  "abs",
  "append",
  "at_least",
  "at_most",
  "capitalize",
  "ceil",
  "compact",
  "concat",
  "date",
  "default",
  "divided_by",
  "downcase",
  "escape",
  "escape_once",
  "first",
  "floor",
  "join",
  "last",
  "lstrip",
  "map",
  "minus",
  "modulo",
  "newline_to_br",
  "plus",
  "prepend",
  "remove",
  "remove_first",
  "replace",
  "replace_first",
  "reverse",
  "round",
  "rstrip",
  "size",
  "slice",
  "sort",
  "sort_natural",
  "split",
  "strip",
  "strip_html",
  "strip_newlines",
  "times",
  "truncate",
  "truncatewords",
  "uniq",
  "upcase",
  "url_decode",
  "url_encode",
  "where",
]);

const liquid = new Liquid({ strictVariables: true, strictFilters: true });

const LIQUID_EXPRESSION_KEYWORDS = new Set(["and", "or", "not", "contains", "true", "false", "nil", "null", "empty", "blank"]);

export async function lintWorkflow(path: string): Promise<WorkflowLintResult> {
  const diagnostics: WorkflowLintDiagnostic[] = [];
  let loaded: Awaited<ReturnType<typeof loadWorkflow>>;
  try {
    loaded = await loadWorkflow(path);
  } catch (err) {
    diagnostics.push({
      severity: "error",
      code: "workflow_load_error",
      message:
        err instanceof WorkflowError
          ? `${err.code}: ${err.message}`
          : `workflow_load_error: ${(err as Error).message}`,
    });
    return { ok: false, diagnostics };
  }

  diagnostics.push(...lintLiquidTemplate(loaded.promptTemplate));
  diagnostics.push(...lintPrChecksStates(loaded.config));
  return { ok: diagnostics.length === 0, diagnostics };
}

export function lintLiquidTemplate(template: string): WorkflowLintDiagnostic[] {
  const diagnostics: WorkflowLintDiagnostic[] = [];
  try {
    liquid.parse(template);
  } catch (err) {
    diagnostics.push({
      severity: "error",
      code: "workflow_load_error",
      message: `Liquid parse failed: ${(err as Error).message}`,
    });
  }

  const loopScopes = collectLoopScopes(template, diagnostics);
  for (const variablePath of collectVariablePaths(template)) {
    if (!isKnownPath(variablePath, loopScopes)) {
      diagnostics.push({
        severity: "error",
        code: "unknown_liquid_variable",
        message: `Unknown Liquid variable path \`${variablePath}\``,
      });
    }
  }
  for (const filter of collectFilters(template)) {
    if (!KNOWN_FILTERS.has(filter)) {
      diagnostics.push({
        severity: "error",
        code: "unknown_liquid_filter",
        message: `Unknown Liquid filter \`${filter}\``,
      });
    }
  }
  return diagnostics;
}
```

- [ ] **Step 4: Add scanner helpers in the same file**

Append these helpers below `lintLiquidTemplate`:

```ts
function collectLoopScopes(
  template: string,
  diagnostics: WorkflowLintDiagnostic[],
): Map<string, SchemaNode> {
  const scopes = new Map<string, SchemaNode>();
  const forTag = /{%\s*for\s+([A-Za-z_][\w]*)\s+in\s+([^%]+?)\s*%}/g;
  for (const match of template.matchAll(forTag)) {
    const variable = match[1]!;
    const collection = normalizePath(match[2]!.trim());
    const collectionNode = resolvePath(collection, scopes);
    const itemNode = collectionNode && typeof collectionNode === "object" ? collectionNode.array : undefined;
    if (!itemNode) {
      diagnostics.push({
        severity: "error",
        code: "invalid_liquid_for",
        message: `Invalid Liquid for-loop collection \`${collection}\``,
      });
      continue;
    }
    scopes.set(variable, itemNode);
  }
  return scopes;
}

function collectVariablePaths(template: string): string[] {
  const out = new Set<string>();
  const outputTag = /{{\s*([^}]+?)\s*}}/g;
  const ifTag = /{%\s*(?:if|elsif|unless)\s+([^%]+?)\s*%}/g;
  for (const match of template.matchAll(outputTag)) {
    collectExpressionPaths(match[1]!, out);
  }
  for (const match of template.matchAll(ifTag)) {
    collectExpressionPaths(match[1]!, out);
  }
  return [...out];
}

function collectExpressionPaths(expression: string, out: Set<string>): void {
  const beforeFilters = expression.split("|")[0] ?? expression;
  const pathPattern = /\b[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*\b/g;
  for (const match of beforeFilters.matchAll(pathPattern)) {
    const candidate = normalizePath(match[0]!);
    if (!LIQUID_EXPRESSION_KEYWORDS.has(candidate)) out.add(candidate);
  }
}

function collectFilters(template: string): string[] {
  const out = new Set<string>();
  const outputTag = /{{\s*([^}]+?)\s*}}/g;
  for (const match of template.matchAll(outputTag)) {
    const parts = match[1]!.split("|").slice(1);
    for (const part of parts) {
      const filter = part.trim().match(/^([A-Za-z_][\w]*)/)?.[1];
      if (filter) out.add(filter);
    }
  }
  return [...out];
}

function isKnownPath(path: string, loopScopes: Map<string, SchemaNode>): boolean {
  return resolvePath(path, loopScopes) !== null;
}

function resolvePath(path: string, loopScopes: Map<string, SchemaNode>): SchemaNode | null {
  const parts = normalizePath(path).split(".");
  const [root, ...rest] = parts;
  let node = root ? loopScopes.get(root) ?? PROMPT_CONTEXT[root] : undefined;
  for (const part of rest) {
    if (!node || node === true || !("fields" in node) || !node.fields) return null;
    node = node.fields[part];
  }
  return node ?? null;
}

function normalizePath(path: string): string {
  return path.replace(/\[['"]([^'"]+)['"]\]/g, ".$1").replace(/\["([^"]+)"\]/g, ".$1").trim();
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
bun test packages/dalang/tests/config/workflow-linter.test.ts
```

Expected: the two tests pass.

## Task 3: Validate Imports, Filters, For Loops, and PR-Check States

**Files:**

- Modify: `packages/dalang/tests/config/workflow-linter.test.ts`
- Modify: `packages/dalang/src/config/workflow-linter.ts`

- [ ] **Step 1: Add focused failing tests**

Append tests:

```ts
test("lint scans imported prompt body after expansion", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dalang-lint-import-"));
  await writeFile(join(dir, "preamble.md"), "{{ recent_history.summary }}");
  const path = join(dir, "WORKFLOW.md");
  await writeFile(path, "---\n---\n@preamble.md\n");

  const result = await lintWorkflow(path);

  expect(result.ok).toBe(false);
  expect(result.diagnostics.map((d) => d.message)).toContain(
    "Unknown Liquid variable path `recent_history.summary`",
  );
});

test("lint rejects unknown filters and invalid for collections", async () => {
  const path = await writeWorkflow(`
{{ issue.title | not_a_filter }}
{% for item in issue.title %}{{ item.name }}{% endfor %}
`);

  const result = await lintWorkflow(path);

  expect(result.ok).toBe(false);
  expect(result.diagnostics.map((d) => d.message)).toContain(
    "Unknown Liquid filter `not_a_filter`",
  );
  expect(result.diagnostics.map((d) => d.message)).toContain(
    "Invalid Liquid for-loop collection `issue.title`",
  );
});

test("lint validates github-projects pr_checks states", async () => {
  const path = await writeWorkflow(
    "{{ issue.title }}",
    `
control_plane:
  kind: github-projects
  owner_type: user
  owner: ruqqq
  project_number: 1
  repository: ruqqq/pentas
  token: token
  status_field: Status
  active_states: ["In Dev"]
  terminal_states: ["Done"]
  ownership:
    mode: label
    value: dalang
  pr_checks:
    enabled: true
    wait_state: "Waiting PR Checks"
    pass_state: "Ready for Human Review"
    fail_state: "In Dev"
    escalation_state: "Ready for Human Review"
`,
  );

  const result = await lintWorkflow(path);

  expect(result.ok).toBe(false);
  expect(result.diagnostics.map((d) => d.message)).toContain(
    "Unknown pr_checks.wait_state `Waiting PR Checks`; expected one of: In Dev, Done",
  );
  expect(result.diagnostics.map((d) => d.message)).toContain(
    "Unknown pr_checks.pass_state `Ready for Human Review`; expected one of: In Dev, Done",
  );
  expect(result.diagnostics.map((d) => d.message)).toContain(
    "Unknown pr_checks.escalation_state `Ready for Human Review`; expected one of: In Dev, Done",
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
bun test packages/dalang/tests/config/workflow-linter.test.ts
```

Expected: FAIL until import scanning, filters, loops, and PR-check state validation are complete.

- [ ] **Step 3: Implement PR-check state validation**

Append to `packages/dalang/src/config/workflow-linter.ts`:

```ts
function lintPrChecksStates(cfg: WorkflowFrontMatter): WorkflowLintDiagnostic[] {
  if (cfg.control_plane.kind !== "github-projects") return [];
  const prChecks = cfg.control_plane.pr_checks;
  if (!prChecks?.enabled) return [];

  const allowed = new Set([...cfg.control_plane.active_states, ...cfg.control_plane.terminal_states]);
  const expected = [...allowed].join(", ");
  const checks = [
    ["wait_state", prChecks.wait_state],
    ["pass_state", prChecks.pass_state],
    ["fail_state", prChecks.fail_state],
    ["escalation_state", prChecks.escalation_state],
  ] as const;

  return checks.flatMap(([field, state]) =>
    allowed.has(state)
      ? []
      : [
          {
            severity: "error" as const,
            code: "invalid_pr_checks_state" as const,
            message: `Unknown pr_checks.${field} \`${state}\`; expected one of: ${expected}`,
          },
        ],
  );
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
bun test packages/dalang/tests/config/workflow-linter.test.ts
```

Expected: all linter tests pass.

## Task 4: Add the `dalang lint` CLI Path

**Files:**

- Modify: `packages/dalang/src/cli/args.ts`
- Modify: `packages/dalang/tests/cli/args.test.ts`
- Modify: `packages/dalang/src/index.ts`
- Modify: `packages/dalang/src/lib.ts`

- [ ] **Step 1: Write failing CLI parser tests**

Update `packages/dalang/tests/cli/args.test.ts` with:

```ts
test("parses lint subcommand with explicit workflow path", () => {
  expect(parseArgs(["lint", "custom/WORKFLOW.md"])).toEqual({
    command: "lint",
    workflowPath: "custom/WORKFLOW.md",
    port: null,
  });
});

test("parses lint subcommand with default workflow path", () => {
  expect(parseArgs(["lint"])).toEqual({
    command: "lint",
    workflowPath: "./WORKFLOW.md",
    port: null,
  });
});

test("rejects --port for lint", () => {
  expect(() => parseArgs(["lint", "--port", "3000"])).toThrow("--port is only valid for serve mode");
});
```

Update existing expected parser objects to include `command: "serve"`.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
bun test packages/dalang/tests/cli/args.test.ts
```

Expected: FAIL until parser supports `command`.

- [ ] **Step 3: Update parser**

Replace `ParsedArgs` and the top of `parseArgs` in `packages/dalang/src/cli/args.ts`:

```ts
export interface ParsedArgs {
  command: "serve" | "lint";
  workflowPath: string;
  port: number | null;
}

export function parseArgs(argv: string[]): ParsedArgs {
  if (argv[0] === "lint") {
    const rest = argv.slice(1);
    if (rest.includes("--port")) throw new Error("--port is only valid for serve mode");
    if (rest.length > 1) throw new Error(`unexpected positional argument: ${rest[1]}`);
    return { command: "lint", workflowPath: rest[0] ?? "./WORKFLOW.md", port: null };
  }

  let workflowPath: string | null = null;
  let port: number | null = null;
```

Change the final return to:

```ts
  return { command: "serve", workflowPath: workflowPath ?? "./WORKFLOW.md", port };
}
```

- [ ] **Step 4: Wire lint mode in `index.ts`**

Insert after `const args = parseArgs(Bun.argv.slice(2));`:

```ts
if (args.command === "lint") {
  const { lintWorkflow } = await import("./config/workflow-linter");
  const result = await lintWorkflow(args.workflowPath);
  if (result.ok) {
    console.log(`OK: ${args.workflowPath}`);
    process.exit(0);
  }
  for (const diagnostic of result.diagnostics) {
    console.error(`${diagnostic.severity}: ${diagnostic.message}`);
  }
  process.exit(1);
}
```

Leave the existing `Bootstrap` path unchanged for `serve` mode.

- [ ] **Step 5: Export the linter**

Add to `packages/dalang/src/lib.ts`:

```ts
export { lintWorkflow, lintLiquidTemplate } from "./config/workflow-linter";
export type { WorkflowLintDiagnostic, WorkflowLintResult } from "./config/workflow-linter";
```

- [ ] **Step 6: Run parser tests**

Run:

```bash
bun test packages/dalang/tests/cli/args.test.ts
```

Expected: PASS.

## Task 5: Add CLI Integration Coverage

**Files:**

- Modify: `packages/dalang/tests/cli/bootstrap.test.ts` or create `packages/dalang/tests/cli/lint-command.test.ts`

- [ ] **Step 1: Add subprocess tests for exit behavior**

Create `packages/dalang/tests/cli/lint-command.test.ts`:

```ts
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

async function runDalang(args: string[]) {
  return Bun.spawn({
    cmd: ["bun", "run", "packages/dalang/src/index.ts", ...args],
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });
}

test("dalang lint exits 0 for a valid workflow", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dalang-lint-cli-"));
  const path = join(dir, "WORKFLOW.md");
  await writeFile(path, "---\n---\n{{ issue.identifier }}\n");

  const proc = await runDalang(["lint", path]);
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  expect(exitCode).toBe(0);
  expect(stdout).toContain(`OK: ${path}`);
});

test("dalang lint exits 1 and prints diagnostics for an invalid workflow", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dalang-lint-cli-"));
  const path = join(dir, "WORKFLOW.md");
  await writeFile(path, "---\n---\n{{ recent_history.summary }}\n");

  const proc = await runDalang(["lint", path]);
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  expect(exitCode).toBe(1);
  expect(stderr).toContain("Unknown Liquid variable path `recent_history.summary`");
});
```

- [ ] **Step 2: Run the CLI integration test**

Run:

```bash
bun test packages/dalang/tests/cli/lint-command.test.ts
```

Expected: PASS.

## Task 6: Verification and Cleanup

**Files:**

- Review all touched files.

- [ ] **Step 1: Run focused tests**

Run:

```bash
bun test packages/dalang/tests/config/workflow-linter.test.ts packages/dalang/tests/cli/args.test.ts packages/dalang/tests/cli/lint-command.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run package tests**

Run:

```bash
bun test packages/dalang/tests/config packages/dalang/tests/cli
```

Expected: PASS.

- [ ] **Step 3: Run repo verification**

Run:

```bash
bun test
bun run typecheck
bun run lint
```

Expected: PASS. Do not run `oxfmt` on Markdown because `CLAUDE.md` documents a known formatter issue for `.md` files.

- [ ] **Step 4: Review diagnostic quality manually**

Run against a fixture with multiple failures:

```bash
bun run packages/dalang/src/index.ts lint /tmp/bad-WORKFLOW.md
```

Expected: the command prints one diagnostic per line, includes unknown Liquid paths and PR-check state errors, and exits `1`.

## Open Questions for Plan Review

- Resolved during plan review: keep `issue.project` accepted by lint by adding `project: string | null` to the runtime `WorkItem` / `NormalizedIssue` shape first.
- The proposed scanner is intentionally grep-style for output tags, condition tags, filters, and `for` loops. Implementation may switch to Liquid AST traversal if the installed API is cleaner, but it must preserve the documented tests for dotted paths, unknown top-level roots, filters, loops, aliases, and imported templates.
- The filter allowlist is hand-maintained. If liquidjs exposes a stable public built-in filter registry, prefer using that registry in Task 2 instead of the literal set.
