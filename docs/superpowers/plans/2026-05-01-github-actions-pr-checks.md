# GitHub Actions PR Checks Implementation Plan

> **For agentic workers:** Implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add GitHub Actions checks for pull requests and `main` pushes so repository changes are validated by oxfmt check, oxlint, typechecks, and tests.

**Architecture:** A single workflow file defines four independent jobs so GitHub can run them in parallel and report clear check names. Each job checks out the repo, installs Bun, runs `bun install --frozen-lockfile`, then runs one validation command. Formatting uses `oxfmt --check` only over supported JS/TS source globs because the repository-wide command currently trips upstream `DataCloneError` failures on non-JS/TS files, including JSON and CSS. The implementation also fixes the one known JS/TS formatting drift so the new formatter job can be introduced green.

**Tech Stack:** GitHub Actions, Bun workspace tooling, `oxfmt`, `oxlint`, `tsgo`, `bun test`.

**Spec Context:** Repo tooling and CI expectations come from `CLAUDE.md`, root `package.json`, and the harness sections in `docs/superpowers/specs/2026-04-29-dalang-orchestrator-design.md` and `docs/superpowers/specs/2026-04-29-papan-tracker-design.md`. The PR-checks wait specs explain why named GitHub PR checks matter, but no dalang runtime changes are needed for this issue.

**PRD:** Unnecessary. The issue already defines the acceptance checks precisely.

**ADR:** Unnecessary. This introduces standard repository CI wiring and does not choose a durable runtime architecture or cross-package contract.

---

## File Structure

**Create:**

- `.github/workflows/pr-checks.yml` - GitHub Actions workflow with parallel format, lint, typecheck, and test jobs.

**Modify:**

- `packages/dalang/tests/config/env-resolver.test.ts` - apply oxfmt-only formatting drift that currently blocks the supported-file formatter check.

---

## Task 1: Fix Existing Supported-File Formatting Drift

**Files:**

- Modify: `packages/dalang/tests/config/env-resolver.test.ts`

- [ ] **Step 1: Confirm the formatter failure**

Run:

```bash
bunx --bun oxfmt --check '**/*.{ts,tsx,js,jsx}' --no-error-on-unmatched-pattern
```

Expected before the fix: exits 1 and reports only `packages/dalang/tests/config/env-resolver.test.ts`.

- [ ] **Step 2: Apply oxfmt to the failing TypeScript file only**

Run:

```bash
bunx --bun oxfmt packages/dalang/tests/config/env-resolver.test.ts
```

Expected behavior: only whitespace/quote/wrapping changes from oxfmt; no test behavior changes.

- [ ] **Step 3: Re-run the supported-file formatter check**

Run:

```bash
bunx --bun oxfmt --check '**/*.{ts,tsx,js,jsx}' --no-error-on-unmatched-pattern
```

Expected after the fix: exits 0. If another JS/TS file appears, format only that file and re-run the command.

---

## Task 2: Add The PR Checks Workflow

**Files:**

- Create: `.github/workflows/pr-checks.yml`

- [ ] **Step 1: Create the workflow directory and file**

Create `.github/workflows/pr-checks.yml`.

- [ ] **Step 2: Define workflow triggers**

Use:

```yaml
name: PR Checks

on:
  pull_request:
  push:
    branches:
      - main
  workflow_dispatch:
```

Expected behavior: PRs get validation before review, pushes to `main` catch direct changes, and `workflow_dispatch` gives a manual retry path.

- [ ] **Step 3: Add baseline workflow controls**

Use read-only contents permission and cancel stale runs for the same ref:

```yaml
permissions:
  contents: read

concurrency:
  group: pr-checks-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

- [ ] **Step 4: Add the shared setup pattern to each job**

Each job should run on `ubuntu-latest` and perform:

```yaml
- uses: actions/checkout@v4
- uses: oven-sh/setup-bun@v2
- run: bun install --frozen-lockfile
```

Keep the setup duplicated inside each job instead of using a composite action; this repo does not have local CI actions yet, and duplication is small.

- [ ] **Step 5: Add four independent jobs**

Add these jobs with clear names:

- `oxfmt`: run `bunx --bun oxfmt --check '**/*.{ts,tsx,js,jsx}' --no-error-on-unmatched-pattern`
- `oxlint`: run `bun run lint`
- `typecheck`: run `bun run typecheck`
- `test`: run `bun test`

Do not run `bun run format` because CI must check formatting, not write files. Do not use the root `format:check` script as-is because it runs repository-wide and currently fails before producing a useful PR check. Do not use `bunx --bun oxfmt --check . '!**/*.md'`; excluding Markdown alone still leaves JSON and CSS paths that trigger `DataCloneError` locally.

---

## Task 3: Verify Locally

**Files:**

- Read: `.github/workflows/pr-checks.yml`
- Read: `packages/dalang/tests/config/env-resolver.test.ts`

- [ ] **Step 1: Run the exact formatter check command**

Run:

```bash
bunx --bun oxfmt --check '**/*.{ts,tsx,js,jsx}' --no-error-on-unmatched-pattern
```

Expected: exits 0.

- [ ] **Step 2: Run lint**

Run:

```bash
bun run lint
```

Expected: exits 0.

- [ ] **Step 3: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: exits 0.

- [ ] **Step 4: Run tests**

Run:

```bash
bun test
```

Expected: exits 0.

- [ ] **Step 5: Sanity-check workflow syntax**

Read the workflow file and confirm:

- Job IDs are `oxfmt`, `oxlint`, `typecheck`, and `test`.
- No job depends on another job with `needs`.
- The formatter command is scoped to `**/*.{ts,tsx,js,jsx}` and uses `--no-error-on-unmatched-pattern`.
- The install step uses `bun install --frozen-lockfile`.

---

## Task 4: Acceptance Criteria

- [ ] Pull requests show four separate GitHub checks: `oxfmt`, `oxlint`, `typecheck`, and `test`.
- [ ] The checks run in parallel.
- [ ] Formatting is checked with oxfmt over supported JS/TS files only.
- [ ] `packages/dalang/tests/config/env-resolver.test.ts` formatting drift is fixed so the formatter check lands green.
- [ ] Lint uses the repo's root `bun run lint` script.
- [ ] Typechecking uses the repo's root `bun run typecheck` script.
- [ ] Tests use the repo's root `bun test` command.
- [ ] Local verification covers all four commands before opening the PR.

---

## Open Questions For Plan Review

- Should the workflow also run on every branch push, or is `pull_request` plus `main` push enough for now? The plan chooses `pull_request` plus `main` to keep CI focused.
- Should the root `format:check` script be updated to use the supported-file command and reused by CI? The plan avoids modifying package scripts because the issue only asks for GitHub Actions, but this is a reasonable follow-up if humans want one canonical formatter-check command.
