# Papan QA Before Human Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Papan-specific browser QA gate to the review workflow before the item can proceed toward human review.

**Architecture:** This is a workflow-prompt change, not an application runtime change. The `Ready for Review` state will inspect the PR or branch diff; when the diff touches `packages/papan/`, it must run a bounded Playwright QA loop against a Papan server started on an ephemeral port and temporary SQLite database. Non-Papan changes skip this gate and continue through the existing automated review and PR-check path.

**Tech Stack:** Markdown workflow fragments, GitHub CLI, Bun, Papan CLI/server, Playwright when a Playwright harness exists in the implementation branch, existing repo verification with `bun test`, `bun run typecheck`, and `bun run lint`.

---

## Context

- Current dispatch entry is `WORKFLOW.md`, which includes `workflow/state-dispatch.md`.
- `workflow/state-dispatch.md` routes `Ready for Review` to `workflow/states/ready-for-review.md`.
- `workflow/states/ready-for-review.md` currently runs code review, handles review findings, ensures the PR is ready for CI, then moves the item to `Waiting PR Checks`.
- Papan starts through `packages/papan/src/index.ts` with `--port` and `--db`; `runPapan({ port: 0, dbPath })` already supports ephemeral ports and isolated databases.
- No Playwright config or tests exist in the repository at planning time. The workflow must therefore distinguish between "Playwright coverage passed" and "the branch lacks the required Playwright harness".

## Acceptance Criteria

- For a `Ready for Review` item whose changed files include `packages/papan/**`, the workflow requires a Papan QA gate before moving to `Waiting PR Checks`.
- For non-Papan diffs, the Papan QA gate is explicitly skipped and the existing review flow is preserved.
- The Papan QA gate starts Papan on a random port with a random database path.
- The gate runs existing Playwright scripts when present.
- The gate requires the agent to add or expand Playwright scripts until broad E2E coverage reaches 100% for the Papan user flow under review.
- The coverage loop has a hard iteration cap of `3` attempts.
- If the Playwright harness is missing, coverage cannot reach 100%, or a non-flaky scenario fails, the workflow requires a detailed issue comment and moves the item back to `In Dev`.
- If a failure appears flaky, the workflow permits one immediate rerun within the same attempt and requires the final comment to identify the flake evidence.

## ADR Decision

No ADR is needed. This work changes the operational workflow instructions only; it does not introduce a durable package boundary, storage contract, API contract, or cross-package architecture choice.

## File Structure

- Modify: `workflow/states/ready-for-review.md` — insert a Papan QA gate between automated code review and the transition to `Waiting PR Checks`.
- Optionally modify: `WORKFLOW.md` only if the implementation decides the top-level prompt needs a short include-level note. The preferred implementation keeps the change localized to `workflow/states/ready-for-review.md`.
- Do not modify application code, package dependencies, or Playwright infrastructure in this work item unless plan review explicitly widens scope.

## Task 1: Add Papan Diff Detection To Ready For Review

**Files:**

- Modify: `workflow/states/ready-for-review.md`

- [ ] **Step 1: Update the workflow step list with a Papan-only gate**

Replace the current numbered list in `workflow/states/ready-for-review.md` with this structure:

```markdown
1. Find the PR for the branch or linked issue.
2. Use `code-review` to inspect the diff for bugs, regressions, missing tests, and security or maintainability risks.
3. If review finds required code changes, comment with findings and move the item back to `In Dev`.
4. If review only finds non-blocking notes, add them to the PR or issue comment.
5. Check whether the PR or branch diff touches `packages/papan/**`.
6. If no Papan files changed, skip the Papan QA gate and record that it was skipped.
7. If Papan files changed, run the Papan QA gate below before proceeding.
8. Ensure the PR is pushed and ready for CI.
9. Move the item to `Waiting PR Checks`. The control plane PR-check reconciler will move it to `Ready for Human Review` on pass, back to `In Dev` on failure, or to `Ready for Human Review` after repeated failure-budget exhaustion.
```

- [ ] **Step 2: Add exact changed-file detection guidance**

Add this paragraph after the list:

````markdown
To decide whether the Papan QA gate applies, prefer PR metadata when available:

```bash
gh pr diff --name-only
```

If there is no PR yet, compare the current branch with the default branch:

```bash
git fetch origin main
git diff --name-only origin/main...HEAD
```

The gate applies when any changed path starts with `packages/papan/`.
````

- [ ] **Step 3: Verify the Markdown renders as intended**

Run:

```bash
sed -n '1,220p' workflow/states/ready-for-review.md
```

Expected: the new list appears once; the fenced shell snippets are nested correctly; no unrelated state instructions changed.

## Task 2: Add The Bounded Papan QA Gate

**Files:**

- Modify: `workflow/states/ready-for-review.md`

- [ ] **Step 1: Add the QA gate section**

Append this section below the changed-file detection guidance:

````markdown
### Papan QA gate

Only run this gate when the changed-file check includes `packages/papan/**`.

1. Create a temporary database path with `mktemp` and start Papan on an ephemeral port:

```bash
PAPAN_DB_PATH="$(mktemp -t papan-qa-XXXXXX.db)"
bun run --filter=@pentas/papan start -- --port 0 --db "$PAPAN_DB_PATH"
```

2. Capture the printed `papan listening on ...` URL and use that as the Playwright `baseURL`.
3. Run existing Playwright scripts if the branch defines them.
4. If no Playwright harness exists, comment that Papan browser QA cannot be completed, propose adding the harness/tests in `In Dev`, and move the item back to `In Dev`.
5. Exercise the broad Papan E2E flow with Playwright: create issue, list issue, open detail, edit state, add comment, verify history/comment rendering, and verify the board reflects the change.
6. Assert every scenario result in Playwright; do not rely on screenshots or manual inspection alone.
7. Measure coverage using the branch's configured Playwright/coverage command. The target for the Papan E2E flow is 100% of the scenarios listed above.
8. If coverage is below 100%, add or expand Playwright tests and rerun the gate.
9. Stop after 3 QA loop attempts. Do not keep adding tests indefinitely.
10. Stop the Papan server and remove the temporary database before leaving the state.

If a scenario fails and the failure is not clearly flaky, add an issue comment with:

- the exact command that failed,
- the Papan URL and database mode used, excluding secrets,
- the failed scenario name,
- the observed result,
- the expected result,
- whether the Playwright harness was missing or coverage was incomplete,
- the proposed fix,
- the QA loop attempt count.

Then move the item back to `In Dev`.
````

- [ ] **Step 2: Add flake handling**

Add this paragraph after the failure instructions:

```markdown
If a failure appears flaky, rerun the same Playwright command once before deciding. Treat it as flaky only when the same code and same temporary setup passes on rerun. Mention the rerun evidence in the issue comment. A persistent failure is not flaky.
```

- [ ] **Step 3: Verify the command examples match current package scripts**

Run:

```bash
bun run --filter=@pentas/papan start -- --help
```

Expected: if the command starts the server rather than printing help, stop it immediately; the important compatibility check is that Bun accepts the filtered `start` script and forwards arguments after `--`.

## Task 3: Add Plan Review Evidence

**Files:**

- Modify: `workflow/states/ready-for-review.md`
- Existing plan artifact: `docs/superpowers/plans/2026-05-01-papan-qa-before-human-review.md`

- [ ] **Step 1: Run targeted text checks**

Run:

```bash
rg -n "Papan QA gate|packages/papan|3 QA loop attempts|Waiting PR Checks" workflow/states/ready-for-review.md
```

Expected: all key phrases are present in `workflow/states/ready-for-review.md`.

- [ ] **Step 2: Run repo verification that is meaningful for a Markdown workflow change**

Run:

```bash
bun run typecheck
bun run lint
```

Expected: both pass. Do not run `oxfmt` or `format:check` on Markdown; `CLAUDE.md` documents a known formatter issue for `.md` files.

- [ ] **Step 3: Review the diff**

Run:

```bash
git diff -- workflow/states/ready-for-review.md docs/superpowers/plans/2026-05-01-papan-qa-before-human-review.md
```

Expected: the workflow change is scoped to `Ready for Review`; the plan artifact contains no placeholder language such as unset values or deferred implementation notes.

- [ ] **Step 4: Commit**

```bash
git add workflow/states/ready-for-review.md docs/superpowers/plans/2026-05-01-papan-qa-before-human-review.md
git commit -m "docs(workflow): plan papan QA gate before human review"
```

## Self-Review

- Spec coverage: the plan covers `WORKFLOW.md` dispatch, the existing `Ready for Review` handoff, Papan server startup with random port/database, existing Playwright scripts, adding coverage until 100%, a 3-attempt hard limit, and failure comments before returning to `In Dev`.
- Placeholder scan: no unset values or future-fill placeholders are intentionally present.
- Type consistency: this is Markdown-only; command and state names match the current workflow (`In Dev`, `Waiting PR Checks`, `Ready for Human Review`) and package names (`@pentas/papan`, `packages/papan/**`).
