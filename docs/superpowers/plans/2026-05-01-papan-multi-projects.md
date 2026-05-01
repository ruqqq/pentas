# Papan Multi-Project Support Plan

> Planning artifact for `ruqqq/pentas#6`. Human review required before implementation.

**Goal:** Add first-class project support to Papan so one instance can host multiple independent issue boards, while preserving existing single-project API/UI behavior and dalang's tracker contract.

**Source of truth:** `docs/superpowers/specs/2026-05-01-papan-multi-projects-design.md`

**Architecture decision:** `docs/adr/adr-0001-papan-project-scoping.md`

## Scope

In scope:

- Papan project domain model, persistence, migration, repository APIs, REST routes, SSE payloads, and server-rendered UI routes.
- dalang Papan adapter support for passing `tracker.board` as `project=<slug>`.
- Backward compatibility for existing unscoped Papan APIs and UI routes through the default project.
- Focused tests across migration, API isolation, UI links, SSE payloads, and dalang URL generation.

Out of scope:

- Per-project auth.
- External tracker sync.
- Cross-project issue relationships.
- Project-local identifier prefixes.
- Deleting or archiving projects.

## Assumptions

- `tracker.board` is the public configuration surface for project scope.
- The default project slug is `default`.
- Existing issue identifiers remain globally monotonic `PENTAS-N`.
- Project slugs are immutable after creation.
- Project boundaries are organizational only; they are not an authorization boundary.

## Risk Areas to Review

- SQLite migrations: adding `issues.project_id` must support both fresh databases and existing single-project databases without losing rows, labels, blockers, comments, or history.
- State and relationship integrity: parent issues and blockers must stay within one project; every create, update, delete, comment, and history path must resolve project scope before mutating state.
- Provider behavior: dalang's Papan adapter must propagate `tracker.board` consistently while GitHub control-plane behavior remains unchanged.
- GitHub API assumptions: none for the Papan implementation path; the only GitHub Projects dependency is the workflow state transition after plan review.
- Cross-package contract: `tracker.board` becomes the stable project slug for Papan, and `NormalizedIssue` gains only backward-compatible project metadata.

## Implementation Tasks

### Task 1: Project Schema and Migration

Files:

- `packages/papan/src/db/schema.sql`
- `packages/papan/src/db/migrations.ts`
- `packages/papan/tests/db/migrations.test.ts`

Steps:

- [ ] Add `projects` table and default project seed.
- [ ] Add `issues.project_id` and project-aware indexes.
- [ ] Backfill existing issues into the default project.
- [ ] Adjust migration tests for fresh and existing databases.

Verification:

```bash
bun test packages/papan/tests/db/migrations.test.ts
```

### Task 2: Project Domain and Repository Layer

Files:

- `packages/papan/src/domain/project.ts`
- `packages/papan/src/db/repo/projects.ts`
- `packages/papan/src/db/repo/issues.ts`
- `packages/papan/tests/db/repo/projects.test.ts`
- `packages/papan/tests/db/repo/issues.test.ts`

Steps:

- [ ] Define `Project` and project validation helpers.
- [ ] Add project CRUD/list repository functions for MVP needs.
- [ ] Thread `project_id` through issue create, update, list, detail, and by-ids queries.
- [ ] Enforce same-project parent and blocker relationships.
- [ ] Extend `NormalizedIssue` with optional project metadata while keeping existing fields intact.

Verification:

```bash
bun test packages/papan/tests/db/repo/projects.test.ts packages/papan/tests/db/repo/issues.test.ts
```

### Task 3: Project-Aware API Routes

Files:

- `packages/papan/src/api/routes/projects.ts`
- `packages/papan/src/api/routes/issues-list.ts`
- `packages/papan/src/api/routes/issues-by-ids.ts`
- `packages/papan/src/api/routes/issues-detail.ts`
- `packages/papan/src/api/routes/issues-create.ts`
- `packages/papan/src/api/routes/issues-update.ts`
- `packages/papan/src/api/routes/issues-delete.ts`
- `packages/papan/src/api/routes/comments.ts`
- `packages/papan/src/api/routes/history.ts`
- `packages/papan/src/main.ts`
- `packages/papan/tests/api/*.test.ts`

Steps:

- [ ] Add `GET/POST /api/v1/projects` and `GET /api/v1/projects/:slug`.
- [ ] Parse optional `project=<slug>` on issue, delete, comment, and history routes.
- [ ] Default omitted project scope to `default`.
- [ ] Ensure `DELETE /api/v1/issues/:id?project=<slug>` only deletes issues in the resolved project.
- [ ] Return `project_not_found`, `issue_not_found`, and `project_scope_mismatch` consistently.
- [ ] Publish issue SSE events, including `issue.deleted`, with project metadata.
- [ ] Add API tests proving cross-project delete attempts return `404 issue_not_found` and leave the issue intact.

Verification:

```bash
bun test packages/papan/tests/api
```

### Task 4: Project-Aware UI

Files:

- `packages/papan/src/ui/routes.ts`
- `packages/papan/src/ui/layout.ts`
- `packages/papan/src/ui/pages/board.ts`
- `packages/papan/src/ui/pages/detail.ts`
- `packages/papan/src/ui/pages/new.ts`
- `packages/papan/src/ui/pages/projects.ts`
- `packages/papan/src/ui/partials/issue-card.ts`
- `packages/papan/src/ui/public/style.css`
- `packages/papan/tests/ui/*.test.ts`

Steps:

- [ ] Add `/projects`, `/projects/new`, `/projects/:slug`, `/projects/:slug/new`, and `/projects/:slug/issues/:id`.
- [ ] Keep `/`, `/new`, `/issues/:id`, and `/partials/board` mapped to default project.
- [ ] Add project switcher and project-scoped links.
- [ ] Render project index with issue counts.
- [ ] Make SSE board refresh URLs project-scoped.

Verification:

```bash
bun test packages/papan/tests/ui
```

### Task 5: dalang Board Propagation

Files:

- `packages/dalang/src/control-plane/papan-adapter.ts`
- `packages/dalang/src/control-plane/factory.ts`
- `packages/dalang/tests/control-plane/factory.test.ts`
- `packages/dalang/tests/control-plane/papan-adapter.test.ts` or nearest existing adapter test file
- `packages/dalang/tests/config/schema.test.ts`
- `packages/dalang/tests/config/validate.test.ts`

Steps:

- [ ] Add `board: string | null` to `PapanControlPlaneConfig`.
- [ ] Pass board from validated `control_plane.board` / `tracker.board` into the adapter.
- [ ] Append `project=<board>` to all Papan reads and writes when board is set.
- [ ] Preserve current URLs when board is null.
- [ ] Add URL-construction tests using a fake Papan server.

Verification:

```bash
bun test packages/dalang/tests/control-plane packages/dalang/tests/config
```

### Task 6: End-to-End Compatibility

Files:

- `packages/papan/tests/integration/full-cycle.test.ts`
- `packages/dalang/tests/e2e/pr-checks-e2e.test.ts`
- `docs/superpowers/specs/2026-04-29-papan-tracker-design.md`
- `docs/superpowers/specs/2026-04-29-dalang-orchestrator-design.md`

Steps:

- [ ] Add a multi-project integration cycle: create two projects, create issues in each, verify isolation.
- [ ] Add a dalang smoke path where `tracker.board` dispatches only one Papan project.
- [ ] Update older specs with a short supersession note pointing to the multi-project spec.

Verification:

```bash
bun test packages/papan/tests/integration/full-cycle.test.ts
bun test packages/dalang/tests/e2e/pr-checks-e2e.test.ts
bun test
bun run typecheck
bun run lint
```

## Review Checklist

- [ ] Confirm `default` is acceptable as the migration slug.
- [ ] Confirm global `PENTAS-N` identifiers are acceptable for multi-project MVP.
- [ ] Confirm `tracker.board` should be the only dalang-facing project config field.
- [ ] Confirm project scoping should not imply per-project authorization.
