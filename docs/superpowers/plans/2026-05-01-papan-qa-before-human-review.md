# Papan QA Before Human Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Papan-specific QA stage before human review, backed by initial Playwright E2E coverage for the Papan browser flow.

**Architecture:** Introduce `Ready for QA` and `In QA` as first-class workflow states between `Ready for Review` and `Waiting PR Checks`. Automated review moves Papan-changing work to `Ready for QA`; the QA state runs a bounded Playwright loop against an isolated Papan server on an ephemeral port and temporary SQLite database, then moves passing work to `Waiting PR Checks` and failing work back to `In Dev`.

**Tech Stack:** Markdown workflow fragments, Papan state model, dalang default active states, Bun, TypeScript, `@playwright/test`, Papan `runPapan({ port: 0, dbPath })`, SQLite temp files, existing verification with `bun test`, `bun run typecheck`, and `bun run lint`.

---

## Context

- `WORKFLOW.md` includes `workflow/state-dispatch.md`, which dispatches by project `Status`.
- Current workflow states include `Ready for Review`, `Waiting PR Checks`, and `Ready for Human Review`, but not `Ready for QA` or `In QA`.
- Papan canonical states live in `packages/papan/src/domain/issue.ts`; UI columns and selects are derived from `ALL_STATES`.
- dalang default dispatch states live in `packages/dalang/src/config/schema.ts`.
- Papan can already start with an isolated database and random port through `runPapan({ port: 0, dbPath })`.
- The repo currently has no Playwright dependency, config, or browser E2E tests.

## Acceptance Criteria

- `Ready for QA` and `In QA` exist in the GitHub Projects board contract, Papan state model, UI, tests, and dalang default active states.
- `Ready for Review` performs automated review, then sends Papan-changing diffs to `Ready for QA` and non-Papan diffs to `Waiting PR Checks`.
- `Ready for QA` claims the item by moving it to `In QA`, runs the Papan QA gate, comments with evidence, then moves passing items to `Waiting PR Checks`.
- The Papan QA gate starts Papan with a temporary database path and ephemeral port.
- Initial Playwright scripts exercise the broad browser flow: create issue, list issue, open detail, edit state, add comment, verify comment/history rendering, and verify the board reflects the state change.
- The QA loop targets 100% coverage of the listed scenarios and stops after 3 attempts.
- Persistent non-flaky failures produce a detailed issue comment and move the item back to `In Dev`.
- Flaky failures get one immediate rerun of the same command before classification.

## Risk Areas

- **State machines:** `Ready for QA` and `In QA` must be added consistently to Papan `ALL_STATES`, Papan `ACTIVE_STATES`, dalang defaults, workflow docs, and board contract.
- **Provider behavior:** Adding active states changes which project items dalang dispatches. Both QA states must be active so the orchestrator can pick them up.
- **GitHub API assumptions:** The board must have matching single-select options or state updates will fail. The workflow docs must call this out.
- **Cross-package contracts:** Papan state names are stored strings consumed by dalang and the workflow prompt; keep exact spelling stable.
- **Playwright process lifecycle:** Tests must close the Bun server and SQLite database and delete the temporary DB directory.
- **Migrations:** No database schema migration is needed because state is stored as text and validation is in TypeScript.

## ADR Decision

No ADR is required. This adds workflow states, tests, and prompt behavior using existing string-state contracts; it does not introduce a durable storage migration, new package boundary, or external API contract.

## File Structure

- Modify: `package.json` — add a root script for Papan browser QA.
- Modify: `packages/papan/package.json` — add `@playwright/test` dev dependency and `test:e2e` script.
- Create: `packages/papan/playwright.config.ts` — Playwright config scoped to Papan E2E tests.
- Create: `packages/papan/tests/e2e/papan-flow.spec.ts` — initial broad Papan browser flow test.
- Modify: `packages/papan/src/domain/issue.ts` — add `Ready for QA` and `In QA`.
- Modify: `packages/papan/tests/domain/issue.test.ts` — lock state ordering and active-state classification.
- Modify: `packages/papan/tests/ui/issue-card.test.ts` — assert state selector contains new states.
- Modify: `packages/papan/src/ui/public/style.css` — add distinct badge colors for new states.
- Modify: `packages/dalang/src/config/schema.ts` — add new active states to default dispatch states.
- Modify: `packages/dalang/tests/config/schema.test.ts` — assert default active states include QA states.
- Modify: `workflow/project-board.md` — add board options for `Ready for QA` and `In QA`.
- Modify: `workflow/state-dispatch.md` — include new state fragments.
- Create: `workflow/states/ready-for-qa.md` — QA claim state.
- Create: `workflow/states/in-qa.md` — bounded Papan QA execution state.
- Modify: `workflow/states/ready-for-review.md` — route Papan diffs to `Ready for QA`.
- Modify: `workflow/superpowers.md` — recommend Playwright/verification discipline in QA.

## Task 1: Add QA States To Papan

**Files:**

- Modify: `packages/papan/src/domain/issue.ts`
- Modify: `packages/papan/tests/domain/issue.test.ts`
- Modify: `packages/papan/tests/ui/issue-card.test.ts`
- Modify: `packages/papan/src/ui/public/style.css`

- [ ] **Step 1: Update the failing domain-state expectations**

In `packages/papan/tests/domain/issue.test.ts`, update the canonical state test to expect:

```ts
expect(ALL_STATES).toEqual([
  "Todo",
  "Plan",
  "Review Plan",
  "Ready for Dev",
  "In Dev",
  "Ready for Review",
  "Ready for QA",
  "In QA",
  "Waiting PR Checks",
  "Ready for Human Review",
  "Done",
  "Cancelled",
]);
expect(ACTIVE_STATES).toEqual([
  "Todo",
  "Plan",
  "Review Plan",
  "Ready for Dev",
  "In Dev",
  "Ready for Review",
  "Ready for QA",
  "In QA",
]);
```

Also replace the `Waiting PR Checks state` neighbor assertion so `Waiting PR Checks` follows `In QA`, and add assertions that `Ready for QA` and `In QA` are valid and active.

- [ ] **Step 2: Run the focused failing test**

Run:

```bash
bun test packages/papan/tests/domain/issue.test.ts
```

Expected: FAIL because `Ready for QA` and `In QA` are not yet in `ALL_STATES` or `ACTIVE_STATES`.

- [ ] **Step 3: Add the states to Papan**

In `packages/papan/src/domain/issue.ts`, update the union and arrays:

```ts
export type IssueState =
  | "Todo"
  | "Plan"
  | "Review Plan"
  | "Ready for Dev"
  | "In Dev"
  | "Ready for Review"
  | "Ready for QA"
  | "In QA"
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
  "Ready for QA",
  "In QA",
  "Waiting PR Checks",
  "Ready for Human Review",
  "Done",
  "Cancelled",
] as const satisfies readonly IssueState[];

export const ACTIVE_STATES = [
  "Todo",
  "Plan",
  "Review Plan",
  "Ready for Dev",
  "In Dev",
  "Ready for Review",
  "Ready for QA",
  "In QA",
] as const satisfies readonly IssueState[];
```

Keep `Waiting PR Checks` out of `ACTIVE_STATES`.

- [ ] **Step 4: Update UI state tests and styles**

In `packages/papan/tests/ui/issue-card.test.ts`, add selector assertions:

```ts
expect(html).toContain('<option value="Ready for QA">Ready for QA</option>');
expect(html).toContain('<option value="In QA">In QA</option>');
```

In `packages/papan/src/ui/public/style.css`, place these beside the existing workflow state badge rules:

```css
.state-badge[data-state="Ready for QA"] {
  background: #e9d5ff;
  color: #581c87;
}

.state-badge[data-state="Ready for QA"]::before {
  background: #9333ea;
}

.state-badge[data-state="In QA"] {
  background: #cffafe;
  color: #155e75;
}

.state-badge[data-state="In QA"]::before {
  background: #0891b2;
}
```

- [ ] **Step 5: Verify Papan state behavior**

Run:

```bash
bun test packages/papan/tests/domain/issue.test.ts packages/papan/tests/ui/issue-card.test.ts packages/papan/tests/ui/state-badge.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/papan/src/domain/issue.ts packages/papan/tests/domain/issue.test.ts packages/papan/tests/ui/issue-card.test.ts packages/papan/src/ui/public/style.css
git commit -m "feat(papan): add QA workflow states"
```

## Task 2: Add QA States To Dalang Defaults And Workflow Contract

**Files:**

- Modify: `packages/dalang/src/config/schema.ts`
- Modify: `packages/dalang/tests/config/schema.test.ts`
- Modify: `workflow/project-board.md`
- Modify: `workflow/state-dispatch.md`

- [ ] **Step 1: Update failing dalang default-state test**

In `packages/dalang/tests/config/schema.test.ts`, update `applyDefaults fills empty input with all defaults` so `result.tracker.active_states` includes:

```ts
[
  "Todo",
  "Plan",
  "Review Plan",
  "Ready for Dev",
  "In Dev",
  "Ready for Review",
  "Ready for QA",
  "In QA",
]
```

- [ ] **Step 2: Run the focused failing test**

Run:

```bash
bun test packages/dalang/tests/config/schema.test.ts
```

Expected: FAIL because the default active states do not yet include QA.

- [ ] **Step 3: Add QA states to dalang defaults**

In `packages/dalang/src/config/schema.ts`, update `DEFAULT_ACTIVE_STATES`:

```ts
const DEFAULT_ACTIVE_STATES = [
  "Todo",
  "Plan",
  "Review Plan",
  "Ready for Dev",
  "In Dev",
  "Ready for Review",
  "Ready for QA",
  "In QA",
];
```

- [ ] **Step 4: Update the board contract**

In `workflow/project-board.md`, add these options between `Ready for Review` and `Waiting PR Checks`:

```markdown
- `Ready for QA`: automated review passed and Papan-changing work is waiting for browser QA.
- `In QA`: Papan browser QA is in progress.
```

- [ ] **Step 5: Add dispatch entries**

In `workflow/state-dispatch.md`, add:

```liquid
@states/ready-for-qa.md
@states/in-qa.md
```

Place them after `@states/ready-for-review.md` or directly before it; the included fragments each contain their own `{% when %}` guard.

- [ ] **Step 6: Verify dalang defaults and workflow text**

Run:

```bash
bun test packages/dalang/tests/config/schema.test.ts
rg -n "Ready for QA|In QA" workflow/project-board.md workflow/state-dispatch.md packages/dalang/src/config/schema.ts
```

Expected: test passes and `rg` finds both states in the contract, dispatch file, and defaults.

- [ ] **Step 7: Commit**

```bash
git add packages/dalang/src/config/schema.ts packages/dalang/tests/config/schema.test.ts workflow/project-board.md workflow/state-dispatch.md
git commit -m "feat(dalang): dispatch papan QA states"
```

## Task 3: Add Initial Papan Playwright E2E Harness

**Files:**

- Modify: `package.json`
- Modify: `packages/papan/package.json`
- Create: `packages/papan/playwright.config.ts`
- Create: `packages/papan/tests/e2e/papan-flow.spec.ts`

- [ ] **Step 1: Add scripts and dependency**

In root `package.json`, add:

```json
"test:papan:e2e": "bun run --filter=@pentas/papan test:e2e"
```

In `packages/papan/package.json`, add:

```json
"test:e2e": "playwright test --config playwright.config.ts"
```

and add a package `devDependencies` block:

```json
"devDependencies": {
  "@playwright/test": "^1.52.0"
}
```

Run:

```bash
bun install
```

Expected: lockfile updates and `@playwright/test` is available.

- [ ] **Step 2: Add Playwright config**

Create `packages/papan/playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  use: {
    trace: "on-first-retry",
    ...devices["Desktop Chrome"],
  },
});
```

- [ ] **Step 3: Write the failing E2E test**

Create `packages/papan/tests/e2e/papan-flow.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runPapan } from "../../src/main";

let baseURL: string;
let cleanup: () => void = () => {};

test.beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "papan-e2e-"));
  const dbPath = join(dir, "papan.db");
  const app = runPapan({ port: 0, dbPath });
  baseURL = String(app.server.url).replace(/\/$/, "");
  cleanup = () => {
    app.server.stop(true);
    app.db.close();
    rmSync(dir, { recursive: true, force: true });
  };
});

test.afterAll(() => cleanup());

test("covers create, list, detail, state, comments, history, and board update", async ({ page }) => {
  const title = `Papan browser QA ${Date.now()}`;
  const comment = "QA comment rendered from Playwright";

  await page.goto(`${baseURL}/new`);
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Description").fill("Created by the Papan QA browser flow.");
  await page.getByLabel("Labels").fill("qa,e2e");
  await page.getByRole("button", { name: "Create issue" }).click();

  await expect(page.getByRole("heading", { name: /PENTAS-\d+ / })).toContainText(title);
  await expect(page.getByText("qa")).toBeVisible();
  await expect(page.getByText("e2e")).toBeVisible();

  await page.goto(`${baseURL}/`);
  await expect(page.locator(".card", { hasText: title })).toBeVisible();

  await page.locator(".card", { hasText: title }).getByRole("link", { name: /PENTAS-\d+/ }).click();
  await page.locator("article select").selectOption("In QA");
  await expect(page.locator(".state-badge", { hasText: "In QA" })).toBeVisible();

  await page.getByPlaceholder("Add a comment").fill(comment);
  await page.getByRole("button", { name: "Add comment" }).click();

  await page.reload();
  await expect(page.locator("#comments-list")).toContainText(comment);
  await expect(page.locator("#history")).toContainText("state Todo");
  await expect(page.locator("#history")).toContainText("In QA");
  await expect(page.locator("#history")).toContainText("comment added");

  await page.goto(`${baseURL}/`);
  const inQaColumn = page.locator('.kcol[data-state="In QA"]');
  await expect(inQaColumn.locator(".card", { hasText: title })).toBeVisible();
});
```

- [ ] **Step 4: Run the E2E test and fix selector fallout only if needed**

Run:

```bash
bun run test:papan:e2e
```

Expected: PASS after Playwright browsers are available. If the command reports missing browsers, run:

```bash
bunx playwright install chromium
bun run test:papan:e2e
```

If selectors fail because accessible names differ, update only the test selectors to match current rendered HTML; do not change Papan UI behavior just for the test.

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lock packages/papan/package.json packages/papan/playwright.config.ts packages/papan/tests/e2e/papan-flow.spec.ts
git commit -m "test(papan): add browser QA flow"
```

## Task 4: Add Ready For QA And In QA Workflow States

**Files:**

- Modify: `workflow/states/ready-for-review.md`
- Create: `workflow/states/ready-for-qa.md`
- Create: `workflow/states/in-qa.md`
- Modify: `workflow/superpowers.md`

- [ ] **Step 1: Update Ready for Review routing**

In `workflow/states/ready-for-review.md`, keep the code-review instructions, then replace the current Papan QA execution block with routing:

```markdown
5. Check whether the PR or branch diff touches `packages/papan/**`.
6. If no Papan files changed, skip Papan QA, record that it was skipped, move the item to `Waiting PR Checks`, then end this turn.
7. If Papan files changed, add a comment summarizing automated-review findings and move the item to `Ready for QA`, then end this turn.
```

Keep the changed-file detection commands:

```bash
gh pr diff --name-only
git fetch origin main
git diff --name-only origin/main...HEAD
```

- [ ] **Step 2: Add the Ready for QA claim state**

Create `workflow/states/ready-for-qa.md`:

```markdown
{% when "Ready for QA" %}

Claim Papan QA work and start the QA session.

1. Confirm the linked PR or branch diff touches `packages/papan/**`. If it does not, comment that QA was skipped, move the item to `Waiting PR Checks`, then end this turn.
2. Add a concise issue comment that Papan QA is starting and name the PR or branch being tested.
3. Move the item to `In QA`, then end this turn. Do not run the QA gate in the same session after moving state.
```

- [ ] **Step 3: Add the In QA execution state**

Create `workflow/states/in-qa.md`:

````markdown
{% when "In QA" %}

Run the Papan browser QA gate.

1. Inspect the PR or branch diff and confirm it still touches `packages/papan/**`.
2. Start from the branch under review with dependencies installed.
3. Create a temporary database path and run Papan on an ephemeral port. The Playwright harness may do this internally; if running manually, use:

```bash
PAPAN_DB_PATH="$(mktemp -t papan-qa-XXXXXX.db)"
bun run --filter=@pentas/papan start -- --port 0 --db "$PAPAN_DB_PATH"
```

4. Run existing Papan Playwright scripts:

```bash
bun run test:papan:e2e
```

5. Confirm 100% scenario coverage for: create issue, list issue, open detail, edit state, add comment, verify history/comment rendering, and verify board state reflection.
6. If any scenario is missing, add or expand Playwright tests and rerun the gate.
7. Stop after 3 QA loop attempts. Do not keep adding tests indefinitely.
8. If a scenario fails, rerun the same Playwright command once only when the failure appears flaky. Treat it as flaky only when the same code and same temporary setup passes on rerun.
9. Stop the Papan server and remove the temporary database before leaving the state.
10. On success, add an issue comment with commands run, attempt count, coverage checklist, and flake rerun evidence if any. Move the item to `Waiting PR Checks`, then end this turn.
11. On persistent failure or incomplete coverage, add an issue comment with the exact failed command, Papan URL and database mode excluding secrets, failed scenario, observed result, expected result, coverage gap, proposed fix, and attempt count. Move the item back to `In Dev`, then end this turn.
````

- [ ] **Step 4: Add skill guidance**

In `workflow/superpowers.md`, add one bullet:

```markdown
- Use `superpowers:systematic-debugging` for persistent Papan QA failures before proposing a fix, and use `superpowers:test-driven-development` when adding missing Playwright coverage in `In QA`.
```

- [ ] **Step 5: Verify workflow text**

Run:

```bash
rg -n "Ready for QA|In QA|test:papan:e2e|3 QA loop attempts|packages/papan" workflow
```

Expected: both new states are dispatchable and the QA loop is documented only in `In QA`.

- [ ] **Step 6: Commit**

```bash
git add workflow/states/ready-for-review.md workflow/states/ready-for-qa.md workflow/states/in-qa.md workflow/superpowers.md
git commit -m "docs(workflow): add papan QA states"
```

## Task 5: Final Verification

**Files:**

- All modified files from Tasks 1-4.

- [ ] **Step 1: Run focused tests**

Run:

```bash
bun test packages/papan/tests/domain/issue.test.ts packages/papan/tests/ui/issue-card.test.ts packages/dalang/tests/config/schema.test.ts
bun run test:papan:e2e
```

Expected: PASS.

- [ ] **Step 2: Run repo verification**

Run:

```bash
bun run typecheck
bun run lint
bun test
```

Expected: PASS. Existing lint warnings are acceptable only if unchanged and there are 0 errors.

- [ ] **Step 3: Review the final diff**

Run:

```bash
git diff --check HEAD~4..HEAD
git diff --stat HEAD~4..HEAD
rg -n "Ready for QA|In QA" packages workflow docs/superpowers/plans/2026-05-01-papan-qa-before-human-review.md
```

Expected: no whitespace errors; diff is scoped to the files named in this plan; both QA states are present across Papan, dalang defaults, workflow, and the plan.

- [ ] **Step 4: Publish implementation**

Push the branch and open or update the draft PR. The issue comment must include:

```markdown
[AGENT MESSAGE]
Implementation complete and draft PR opened: <PR URL>

Changes:
- Added Papan QA workflow states: `Ready for QA` and `In QA`.
- Added initial Playwright browser QA coverage for the Papan create/list/detail/state/comment/history/board flow.
- Updated Ready for Review to route Papan-changing PRs into QA before PR checks.

Verification:
- `bun test packages/papan/tests/domain/issue.test.ts packages/papan/tests/ui/issue-card.test.ts packages/dalang/tests/config/schema.test.ts`
- `bun run test:papan:e2e`
- `bun run typecheck`
- `bun run lint`
- `bun test`

Residual risk:
- GitHub Projects must have `Ready for QA` and `In QA` single-select options before the workflow can update those states successfully.
```

Move the item to `Ready for Review`, then end the turn.

## Self-Review

- Spec coverage: covers random Papan server/database startup, existing Playwright scripts, initial Playwright scripts, 100% scenario coverage target, 3-attempt loop limit, persistent failure reporting, and the new `Ready for QA` / `In QA` workflow states.
- Placeholder scan: no unset values or delayed implementation steps remain.
- Type consistency: state names are exactly `Ready for QA` and `In QA` throughout Papan, dalang defaults, workflow docs, and verification commands.
- Test coverage: unit tests lock state ordering/classification, UI tests lock state selectors, and Playwright covers the requested Papan browser flow.
