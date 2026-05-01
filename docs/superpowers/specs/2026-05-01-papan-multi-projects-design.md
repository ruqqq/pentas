# Papan Multi-Project Support — Design

Status: Proposed
Date: 2026-05-01
Author: dalang planning agent
Companion ADR: `docs/adr/adr-0001-papan-project-scoping.md`
Extends: `2026-04-29-papan-tracker-design.md`, `2026-04-29-dalang-orchestrator-design.md`

## 1. Purpose

A single Papan process should host multiple independent project boards so one machine only needs one tracker instance. Each project owns its issue list, UI board, comments, history, and dalang dispatch scope.

The existing dalang tracker contract stays compatible. Multi-project scoping is expressed through the already reserved `tracker.board` field, interpreted as a Papan project slug.

## 2. Product Requirements

### Personas

- A local developer running one Papan instance for multiple repositories or workstreams.
- dalang, which needs to poll and mutate only the project configured in its workflow.

### User Stories

- As a developer, I want to create and switch between Papan projects so separate work queues do not mix.
- As a developer, I want issue identifiers, labels, blockers, and search to stay scoped to the active project so project boards remain readable.
- As an operator, I want existing single-project data to keep working after upgrade.
- As dalang, I want to dispatch from one configured Papan project without seeing work from other projects.

### Acceptance Criteria

- Papan persists projects with stable slugs and assigns every issue to one project.
- Existing databases migrate into a default project with no data loss.
- UI routes show a project switcher and project-scoped issue list, detail, create, comments, and history views.
- REST list/detail/by-ids/create/update/delete/comment/history endpoints support project scoping without breaking current unscoped clients.
- dalang includes `tracker.board` on all Papan reads and writes when configured.
- SSE updates carry enough project context for UI clients to refresh only affected project views.
- Tests cover migration, API project isolation, UI project isolation, dalang board propagation, and backward compatibility.

### Non-Goals

- Multi-user auth or per-project permissions.
- Syncing projects back to Linear, GitHub Projects, or any external tracker.
- Moving issues between projects in the first implementation unless it falls out naturally from edit support.
- Cross-project blockers or parent-child relationships.
- Project archival, deletion recovery, or rich project settings.

## 3. Data Model

Add:

```sql
CREATE TABLE projects (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
```

Change `issues`:

```sql
project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT
```

Indexes:

```sql
CREATE INDEX issues_project_state_idx ON issues(project_id, state);
CREATE INDEX issues_project_updated_at_idx ON issues(project_id, updated_at, id);
CREATE UNIQUE INDEX issues_project_identifier_idx ON issues(project_id, identifier);
```

Migration:

1. Create `projects`.
2. Insert default project: slug `default`, name `Default`.
3. Add `issues.project_id`, backfill every existing issue to default, and preserve existing issue IDs.
4. Preserve the existing global `seq('issue_identifier')` behavior for the first implementation.

Identifier policy: keep `PENTAS-N` globally monotonic for now. Project-local prefixes or per-project sequences are deferred because they require a project settings model and would complicate migration.

Parent/blocker policy: parent issues and blockers must belong to the same project as the child issue. Repository functions and API validation reject cross-project links with `400 project_scope_mismatch`.

## 4. API Contract

The current dalang-facing endpoints remain valid:

```text
GET /api/v1/issues?state=<S>&cursor=<C>
GET /api/v1/issues/by-ids?id=<I>
GET /api/v1/issues/:id
DELETE /api/v1/issues/:id
```

Add optional project scoping:

```text
GET /api/v1/issues?project=<slug>&state=<S>&cursor=<C>
GET /api/v1/issues/by-ids?project=<slug>&id=<I>
GET /api/v1/issues/:id?project=<slug>
POST /api/v1/issues              body.project_slug?: string
PATCH /api/v1/issues/:id         body.project_slug is not accepted for moves in MVP
DELETE /api/v1/issues/:id?project=<slug>
GET /api/v1/issues/:id/comments?project=<slug>
POST /api/v1/issues/:id/comments?project=<slug>
GET /api/v1/issues/:id/history?project=<slug>
```

Project management endpoints:

```text
GET  /api/v1/projects
POST /api/v1/projects
     body: { slug: string, name: string, description?: string | null }
GET  /api/v1/projects/:slug
```

Unscoped behavior:

- If `project` is omitted, APIs use the default project.
- Unknown project slug returns `404 {error:{code:"project_not_found"}}`.
- An issue ID that exists in another project returns `404 {error:{code:"issue_not_found"}}` when a project filter is supplied, including delete requests.
- Delete is project-scoped: `DELETE /api/v1/issues/:id?project=<slug>` only deletes the issue when the requested issue belongs to the resolved project. The existing unscoped route remains valid and targets the default project.

`NormalizedIssue` remains compatible. Papan may add extension fields:

```ts
project: { id: string; slug: string; name: string } | null;
```

dalang must ignore extension fields through existing defensive normalization.

## 5. dalang Integration

`tracker.board` and `control_plane.board` already exist in config validation. The Papan control-plane adapter should store `board: string | null` and append `project=<board>` to:

- issue list calls;
- by-ids refresh calls;
- issue detail calls;
- comments/history reads;
- state updates;
- comment writes.

When `board` is null, the adapter keeps current URLs and therefore targets Papan's default project.

Prompt rendering should continue to include the tracker config; no prompt contract change is required beyond ensuring the resolved board value is visible anywhere the existing tracker context is printed.

## 6. UI

Routes:

```text
/                         redirects to /projects/default
/projects                 project index
/projects/new             create project
/projects/:slug           board
/projects/:slug/new       create issue in project
/projects/:slug/issues/:id
/projects/:slug/partials/board
```

Backward-compatible routes (`/`, `/new`, `/issues/:id`, `/partials/board`) continue to target the default project.

UI changes:

- Add a project switcher in the page chrome.
- Show active project name and slug on board and detail pages.
- Keep board columns and issue cards unchanged except for project-scoped links.
- New issue forms include project context from the route, not from a free-form input.
- Project index lists project name, slug, issue count, active issue count, and last updated issue time.

## 7. SSE

Event payloads for issue events add:

```ts
project: { id: string; slug: string };
```

Existing event names stay unchanged. Project board pages refresh only when `event.project.slug` matches the current route. The default board remains compatible by treating missing `project` as `default` during the transition.

`issue.deleted` changes from `{ id, identifier }` to:

```ts
{
  id: string;
  identifier: string;
  project: { id: string; slug: string };
}
```

Delete events emitted during compatibility paths still include the resolved default project.

## 8. Security and Privacy

The existing instance-wide bearer token remains unchanged. Project scoping is an organization mechanism, not an authorization boundary. This must be clear in code comments and docs so future users do not assume per-project secrecy.

## 9. Test Matrix

- Migration creates default project and backfills existing issues.
- Fresh migration creates projects table and default project idempotently.
- Creating issues with different projects keeps list/detail/by-ids/delete isolated.
- Cross-project parent and blocker writes return `400 project_scope_mismatch`.
- Comments and history endpoints reject project mismatches.
- Delete with `project=<other-slug>` returns `404 issue_not_found` and leaves the issue intact.
- UI board, detail, and create routes render project-scoped links.
- Project index renders counts from multiple projects.
- SSE payloads, including `issue.deleted`, include project slug and UI partial refresh URLs include the project route.
- dalang Papan adapter appends `project=<board>` when board is set and omits it when null.
- Full backward compatibility smoke: existing unscoped API/UI tests still target default project.

## 10. Open Questions

- Should the default project slug be configurable before first boot, or is `default` sufficient for MVP?
- Should project slugs be immutable after creation? This design assumes yes for stable dalang config.
- Should future project settings include custom identifier prefixes, or should `PENTAS-N` remain instance-wide permanently?
