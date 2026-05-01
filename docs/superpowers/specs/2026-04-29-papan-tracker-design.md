# Papan Tracker — Design

Status: Draft v1
Date: 2026-04-29
Author: ruqqq
Companion spec: `2026-04-29-dalang-orchestrator-design.md`
Supersession note: multi-project behavior extends this v1 design in `2026-05-01-papan-multi-projects-design.md`; unscoped APIs and UI routes now target the default project for compatibility.

## 1. Purpose

`papan` is a single-user agent inbox. It is the issue tracker that feeds `dalang`, the orchestrator. Issues are copy-pasted into papan from external sources (primarily company Linear cards assigned to the user); dalang polls papan for issues in active states, runs Claude Code agents against them, and the agent updates state and posts progress comments via papan's API.

Source-of-truth for the original Linear ticket stays at the company. papan holds local copies plus their dalang-managed lifecycle. v1 has no sync-back to Linear.

Conformance: papan implements the tracker contract from the dalang spec §11 verbatim (REST endpoints + `NormalizedIssue` shape) and adds the agent-mutation surface (PATCH/POST/DELETE) needed for the agent to drive its own workflow.

## 2. Scope

### In scope (v1)

- Single-user, single-project, single-host. Loopback HTTP only.
- SQLite-backed persistent storage.
- REST API: dalang-facing read endpoints + agent/UI mutation endpoints.
- Server-sent events stream for live UI updates.
- Server-rendered HTML UI with HTMX interactions: list, detail, create.
- Issue model: id, identifier, title, description, priority, state, parent_issue_id, external_ref, external_url, branch_name, labels, blockers, timestamps.
- Comments and history per issue.
- Markdown rendering (server-side, sanitized) for description and comments.
- Optional bearer-token auth, env-gated.
- "Paste Linear URL" convenience on the create form.

### Out of scope (v1)

- Multi-user, multi-project, teams, assignees, sprints/cycles, custom fields, attachments.
- Sync-back to Linear or any external tracker.
- Webhook outbound.
- Full-text search (LIKE-based search is sufficient).
- React, RTL, SPA, bundlers.

## 3. Stack

| Concern               | Tool                                                              |
| --------------------- | ----------------------------------------------------------------- |
| Runtime               | Bun                                                               |
| Language              | TypeScript                                                        |
| HTTP                  | `Bun.serve` (built-in)                                            |
| Storage               | `bun:sqlite` (built-in)                                           |
| Templating            | TypeScript template literals (graduate to `eta` if it gets messy) |
| Frontend interactions | HTMX (vendored, no bundler)                                       |
| Markdown              | `marked` + sanitizer                                              |
| Type checker          | `tsgo` (typescript-native preview)                                |
| Linter                | `oxlint`                                                          |
| Formatter             | `oxfmt`                                                           |
| Test runner           | `bun test`                                                        |

### Testing rules (binding, same as dalang)

- No React Testing Library or component-rendering tests.
- UI logic that warrants tests is extracted into pure modules and unit-tested.
- HTML output is tested by snapshotting the string returned from a partial render function.

## 4. Repository Layout

```
packages/papan/
├── src/
│   ├── index.ts            # entry: Bun.serve + CLI
│   ├── db/
│   │   ├── schema.sql      # SQLite DDL
│   │   ├── migrations.ts   # idempotent migration runner
│   │   └── repo.ts         # typed query functions
│   ├── api/
│   │   ├── issues.ts       # /api/v1/issues + /by-ids + /:id
│   │   ├── comments.ts     # /api/v1/issues/:id/comments
│   │   ├── events.ts       # /api/v1/events  (SSE)
│   │   └── auth.ts         # bearer token middleware
│   ├── ui/
│   │   ├── routes.ts       # /, /issues/:id, /new
│   │   ├── pages/          # template literal functions returning HTML strings
│   │   ├── partials/       # HTMX-targetable fragments (issue row, comment, history item)
│   │   └── public/
│   │       ├── style.css
│   │       └── htmx.min.js (vendored)
│   ├── domain/
│   │   ├── issue.ts        # Issue type, state machine, normalization
│   │   ├── comment.ts
│   │   └── history.ts
│   └── lib/
│       ├── markdown.ts     # marked wrapper + sanitization
│       ├── sse.ts          # in-memory pub/sub
│       └── ids.ts          # ULID + PENTAS-N sequence
├── tests/
└── package.json
```

## 5. Data Model

SQLite database at `~/.papan/papan.db` (override via `PAPAN_DB_PATH`).

```sql
CREATE TABLE issues (
  id              TEXT PRIMARY KEY,        -- ULID
  identifier      TEXT NOT NULL UNIQUE,    -- 'PENTAS-1', monotonic
  title           TEXT NOT NULL,
  description     TEXT,
  priority        INTEGER,                 -- 1..4 or NULL
  state           TEXT NOT NULL,           -- canonical states (§6)
  parent_issue_id TEXT REFERENCES issues(id) ON DELETE SET NULL,
  external_ref    TEXT,                    -- 'ABC-123' or arbitrary string
  external_url    TEXT,                    -- canonical URL of the source ticket
  branch_name     TEXT,                    -- optional; mirrored to NormalizedIssue
  created_at      TEXT NOT NULL,           -- ISO-8601
  updated_at      TEXT NOT NULL
);

CREATE INDEX issues_state_idx        ON issues(state);
CREATE INDEX issues_updated_at_idx   ON issues(updated_at);
CREATE INDEX issues_parent_idx       ON issues(parent_issue_id);

CREATE TABLE issue_labels (
  issue_id  TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  label     TEXT NOT NULL,                  -- stored lowercase
  PRIMARY KEY (issue_id, label)
);

CREATE TABLE issue_blockers (
  issue_id   TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  blocker_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  PRIMARY KEY (issue_id, blocker_id),
  CHECK (issue_id <> blocker_id)
);

CREATE TABLE comments (
  id          TEXT PRIMARY KEY,             -- ULID
  issue_id    TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,                -- markdown
  author      TEXT NOT NULL,                -- 'user' | 'agent'
  created_at  TEXT NOT NULL
);
CREATE INDEX comments_issue_id_idx ON comments(issue_id);

CREATE TABLE history (
  id          TEXT PRIMARY KEY,
  issue_id    TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,                -- 'created' | 'state_changed' | 'edited' | 'comment_added' | 'deleted'
  from_value  TEXT,
  to_value    TEXT,
  actor       TEXT NOT NULL,                -- 'user' | 'agent'
  at          TEXT NOT NULL
);
CREATE INDEX history_issue_id_idx ON history(issue_id);

CREATE TABLE seq (
  name   TEXT PRIMARY KEY,
  value  INTEGER NOT NULL
);
-- seq('issue_identifier', N) → next allocated identifier is 'PENTAS-(N+1)'
```

## 6. Issue States

Fixed canonical set v1, hard-coded:

```
Todo  →  In Progress  →  In Review  →  Done
                                     ↘ Cancelled
       (any non-Done) → Cancelled
```

- Active: `Todo`, `In Progress`.
- Terminal: `Done`, `Cancelled`.
- Matches dalang's `tracker.active_states` / `tracker.terminal_states` defaults.

State transitions are unrestricted in v1 (any → any). dalang does not depend on a specific transition graph; this avoids workflow-engine creep.

The state set has been extended in subsequent specs. See `2026-04-30-pr-checks-wait-design.md` for `Waiting PR Checks` — orchestrator-driven, not in `ACTIVE_STATES` (so the dispatcher does not pick up tickets parked there); dalang polls them via a non-agent reconciler.

## 7. API Surface

All endpoints under `/api/v1/`. Auth middleware (§7.4) applies uniformly when `PAPAN_API_TOKEN` is set.

### 7.1 Endpoints consumed by dalang

Verbatim copy of dalang spec §11.1. papan MUST satisfy these unchanged.

```
GET /api/v1/issues?state=<S>&state=<S>[&cursor=<C>]
       → 200 { issues: NormalizedIssue[], next_cursor: string | null }

GET /api/v1/issues/by-ids?id=<I>&id=<I>
       → 200 { issues: NormalizedIssue[] }

GET /api/v1/issues/:id
       → 200 NormalizedIssue | 404
```

### 7.2 Endpoints consumed by the agent and UI

```
POST   /api/v1/issues
         body: {
           title: string,                      // required
           description?: string,
           priority?: number | null,
           state?: string,                     // default 'Todo'
           parent_issue_id?: string | null,
           external_ref?: string | null,
           external_url?: string | null,
           branch_name?: string | null,
           labels?: string[],
           blocker_ids?: string[]
         }
         → 201 NormalizedIssue

PATCH  /api/v1/issues/:id
         body: partial of the above + actor?: 'user' | 'agent'
         → 200 NormalizedIssue
         If `state` changes, append a 'state_changed' history row with the supplied actor (default 'user').

DELETE /api/v1/issues/:id
         → 204
         (rare; primarily used by tests)

POST   /api/v1/issues/:id/comments
         body: { body: string, author?: 'user' | 'agent' }      // default 'user'
         → 201 Comment
         Appends a 'comment_added' history row.

GET    /api/v1/issues/:id/comments
         → 200 { comments: Comment[] }                         // oldest first

GET    /api/v1/issues/:id/history
         → 200 { history: HistoryEntry[] }                     // oldest first
```

### 7.3 Server-Sent Events

```
GET /api/v1/events
       → text/event-stream
```

Emits the following named events (`event: <name>` plus a JSON `data:` payload):

- `issue.created` → `NormalizedIssue`
- `issue.updated` → `NormalizedIssue`
- `issue.deleted` → `{ id, identifier }`
- `state.changed` → `{ id, identifier, from, to, actor }`
- `comment.added` → `{ issue_id, comment: Comment }`

Single global stream; clients filter client-side. papan's UI subscribes to keep the list and detail pages live while dalang's agent mutates issues.

### 7.4 Auth

- If `PAPAN_API_TOKEN` is set in the environment, every `/api/v1/*` request must carry `Authorization: Bearer <token>`. Missing/wrong → `401`.
- If `PAPAN_API_TOKEN` is unset, `/api/v1/*` is open. Server still binds `127.0.0.1` by default.
- UI routes (`/`, `/issues/:id`, `/new`, `/static/*`) are unauthenticated regardless of token presence.

### 7.5 NormalizedIssue and supporting shapes

```ts
interface NormalizedIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  priority: number | null;
  state: string;
  branch_name: string | null;
  url: string | null; // mirrors external_url; named `url` for Symphony §4.1.1 compatibility
  labels: string[]; // lowercase
  blocked_by: { id: string | null; identifier: string | null; state: string | null }[];
  created_at: string | null;
  updated_at: string | null;
}

interface Comment {
  id: string;
  issue_id: string;
  body: string; // raw markdown
  body_html: string; // server-rendered, sanitized
  author: "user" | "agent";
  created_at: string;
}

interface HistoryEntry {
  id: string;
  issue_id: string;
  kind: "created" | "state_changed" | "edited" | "comment_added" | "deleted";
  from_value: string | null;
  to_value: string | null;
  actor: "user" | "agent";
  at: string;
}
```

`NormalizedIssue.url` is sourced from `issues.external_url`. `branch_name` is sourced from `issues.branch_name`.

## 8. UI

Three pages, all server-rendered HTML strings, with HTMX for in-place updates. Server is `Bun.serve`; static assets served from `src/ui/public/`.

**Visual design pass:** the UI implementation will go through the `frontend-design` skill to produce a clean, minimal aesthetic — distinctive but understated, avoiding generic AI-generated-looking interfaces. The skill informs typography, spacing, color, and microcopy choices; it does not change the structural decisions in §8.1–§8.4 (server-rendered HTML, HTMX interactions, no SPA framework).

### 8.1 `GET /` — Issue list

- Top filter bar: state checkboxes (Active / Terminal / All), text search input (matches title or description, SQL `LIKE %q%`).
- Table of issues: identifier, title (link to detail), state badge, priority, labels, parent, updated_at.
- Inline state-change `<select>` per row, `hx-patch="/api/v1/issues/:id"` swapping the row partial on success.
- "New issue" button → `/new`.
- HTMX SSE extension subscribes to `/api/v1/events`. On `issue.updated` / `issue.created` / `state.changed` / `issue.deleted`, refetch the affected row(s) or the whole table.

### 8.2 `GET /issues/:id` — Issue detail

- Header: identifier, title (inline-editable), state badge, state-change dropdown.
- Sidebar: priority, labels, parent (link), blockers (links + states), `external_ref`, `external_url` (link), `branch_name`, timestamps.
- Description: markdown rendered. Click → swap to textarea → save → swap back (HTMX `hx-patch`).
- Comments: oldest first, author badge, markdown rendered. New-comment form posts to `POST /api/v1/issues/:id/comments`, response prepends/appends.
- History timeline below comments.
- SSE subscription filters events client-side to this `:id`.

### 8.3 `GET /new` — Create issue

- Form fields: title (required), description (textarea, markdown), priority, state (default Todo), labels (comma-separated), parent_issue_id (typeahead from existing issues), external_ref, external_url, branch_name.
- Convenience: top-of-form "Paste Linear URL" input. If the value matches a Linear pattern (`https://linear.app/<org>/issue/<KEY>/...`), parse `<KEY>` into `external_ref` and the URL into `external_url`. Title and description still must be entered manually (no Linear API integration in v1).
- Submit → 302 to detail page on success.

### 8.4 Static assets

- `/static/style.css` — hand-written, single file.
- `/static/htmx.min.js` — vendored (~14 KB).
- `/static/sse.js` — HTMX SSE extension (vendored, ~2 KB).

## 9. ID Generation

- Internal `id`: ULID via a small pure function in `src/lib/ids.ts`. No dep needed.
- Public `identifier`: `PENTAS-N`, monotonic. Allocation:

  ```sql
  BEGIN;
    UPDATE seq SET value = value + 1 WHERE name = 'issue_identifier' RETURNING value;
  COMMIT;
  ```

  (initialized to `0` so the first issue is `PENTAS-1`).

## 10. SSE Bus

In-memory pub/sub. A singleton `EventBus` keeps the set of active SSE writers.

- `subscribe(writer)` adds the writer; returns an `unsubscribe` function.
- `publish(name, data)` writes to all current writers; failures (write error / closed connection) silently `unsubscribe` that writer.
- Backpressure policy: drop on slow clients. Do not buffer.
- No persistence. Clients on reconnect re-fetch state via REST.

## 11. Failure Model

| Class      | Examples                                            | Response                                 |
| ---------- | --------------------------------------------------- | ---------------------------------------- |
| Validation | missing `title`, invalid `state`, bad cursor format | 400 `{error:{code,message,fields?}}`     |
| Auth       | missing/wrong bearer when token configured          | 401                                      |
| Not found  | unknown issue id                                    | 404 `{error:{code:"issue_not_found"}}`   |
| Conflict   | unique-constraint violation                         | 409 `{error:{code,message}}`             |
| Server     | DB error / unexpected exception                     | 500, log full stack, return generic JSON |

UI errors render an inline error partial via HTMX `hx-target` + `hx-swap`.

## 12. Test Matrix

### Core (`bun test`)

- **Schema/migrations** — runs on fresh DB; idempotent re-run; new column additions covered by migration steps.
- **Repo functions**
  - CRUD round-trip for issues, comments, history.
  - Labels normalized to lowercase on insert.
  - Blockers persisted and hydrated as `{id, identifier, state}` triples.
  - Identifier sequence is atomic under concurrent inserts.
  - Pagination cursor stability (cursor encodes `(updated_at, id)` so order is deterministic).
  - State filter respects multiple `state=` query params.
- **API handlers**
  - Every endpoint, every error class.
  - Auth middleware: 401 when token configured + missing/wrong; bypass when token unset.
  - Query param parsing: repeated `state=`, `id=`, cursor.
  - PATCH state-change appends history row with correct actor.
  - DELETE cascades labels/blockers/comments/history.
- **Domain logic**
  - Linear URL parser: positive cases, malformed URLs, non-Linear hosts.
  - Markdown rendering: HTML output snapshot, sanitization (no inline `<script>`, no `javascript:` URLs).
  - SSE bus: subscribe/publish/unsubscribe; slow-writer is dropped, not buffered.
  - ID generation: ULID monotonicity, identifier sequencing.
- **UI partial rendering**
  - Snapshot the HTML string output of each partial against fixtures. Detail page header, issue row, comment, history item, error partial, new-issue form.
  - No DOM rendering, no headless browser.

### Integration (`RUN_INTEGRATION=1`)

- Full HTTP request/response cycle against `Bun.serve` on an ephemeral port.
- End-to-end: create issue → list → patch state → post comment → SSE receives events.
- dalang round-trip: skipped here (covered in dalang's integration tests).

## 13. CLI

```
papan [--port <n>] [--db <path>]
```

- Defaults:
  - port: `PAPAN_PORT` env or `3001`.
  - db: `PAPAN_DB_PATH` env or `~/.papan/papan.db`.
- `--port 0` requests an ephemeral port.
- Startup:
  1. Ensure `~/.papan/` exists.
  2. Open SQLite, run migrations.
  3. Start `Bun.serve`.
  4. Log bound URL.
- Exit codes: `0` on clean shutdown, non-zero on startup failure or abnormal exit.

## 14. Definition of Done (v1)

- [ ] Schema + migrations runner.
- [ ] Repo layer (typed, transactional where needed).
- [ ] All API endpoints in §7.1 and §7.2.
- [ ] SSE endpoint with event bus.
- [ ] Bearer-token middleware (env-gated).
- [ ] Three UI pages with HTMX interactions.
- [ ] Markdown rendering (sanitized).
- [ ] Linear URL paste convenience on `/new`.
- [ ] CLI entry with `--port` and `--db`.
- [ ] tsgo type-check passes.
- [ ] oxlint clean.
- [ ] oxfmt formatted.
- [ ] `bun test` covers the matrix in §12.
- [ ] Manual smoke: create issue, change state, post comment, watch SSE update list, complete a dalang round-trip against a real claude session.

## 15. Open Questions / Future Work

- Linear API integration on the create form (auto-populate title/description from the URL).
- Bidirectional sync with Linear (mark cards as in-progress / done in the source tracker).
- Full-text search via FTS5.
- Multi-project support if/when the workflow demands it.
- Attachments.
- Outbound webhooks (e.g. notify Slack on state change).
- Optional MCP server façade so the agent can call papan via typed tool schemas instead of raw HTTP.
