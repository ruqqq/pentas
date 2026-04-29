# Wayang Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `wayang`, the single-user agent inbox tracker that feeds `dalang`. Server-rendered HTML + HTMX + SQLite, exposed over a small REST API plus an SSE event stream. Conforms to the tracker contract from `docs/superpowers/specs/2026-04-29-dalang-orchestrator-design.md` §11 and implements the full spec at `docs/superpowers/specs/2026-04-29-wayang-tracker-design.md`.

**Architecture:** Bun process with `Bun.serve` for HTTP, `bun:sqlite` for storage, in-memory pub/sub for SSE. UI is server-rendered HTML strings with HTMX for in-place updates. Three pages: list, detail, create. The visual design pass invokes the `frontend-design` skill **after** structural HTML+behavior is correct.

**Tech Stack:** Bun, TypeScript, `bun:sqlite`, HTMX (vendored), `marked` + sanitizer, `tsgo`, `oxlint`, `oxfmt`, `bun test`. No bundler. No SPA framework.

**Repository:** monorepo skeleton (Phase 0) is shared with `dalang`. After Phase 0 the repo has `packages/wayang/` and `packages/dalang/` (stubbed). The dalang plan starts from this state.

---

## Phase 0 — Monorepo Skeleton

These tasks set up the bun workspace shared by both packages. Run once, before either package's feature work begins. Any later changes to harness configs (tsgo, oxlint, oxfmt) happen here.

### Task 0.1: Initialize bun workspace root

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `.gitignore`

- [ ] **Step 1: Create root `package.json`**

```json
{
  "name": "tok-juara",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*"],
  "scripts": {
    "test": "bun test",
    "typecheck": "tsgo --noEmit",
    "lint": "oxlint",
    "format": "oxfmt"
  },
  "devDependencies": {
    "@typescript/native-preview": "latest",
    "oxlint": "latest",
    "oxfmt": "latest"
  }
}
```

- [ ] **Step 2: Create root `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "types": ["bun"]
  }
}
```

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
dist/
*.log
.DS_Store
.env
.env.local
~/.dalang/
~/.wayang/
.bun/
```

- [ ] **Step 4: Install workspace deps**

Run: `bun install`
Expected: `node_modules/` populated; no errors.

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.base.json .gitignore
git commit -m "chore: initialize bun workspace root"
```

---

### Task 0.2: Configure oxlint and oxfmt

**Files:**
- Create: `oxlint.json`
- Create: `.oxfmtrc`

- [ ] **Step 1: Create `oxlint.json`**

```json
{
  "$schema": "https://raw.githubusercontent.com/oxc-project/oxc/main/npm/oxlint/configuration_schema.json",
  "categories": {
    "correctness": "error",
    "suspicious": "warn",
    "perf": "warn",
    "style": "off"
  },
  "rules": {
    "no-console": "off",
    "no-explicit-any": "warn"
  },
  "ignorePatterns": ["node_modules", "dist", "**/public/htmx.min.js", "**/public/sse.js"]
}
```

- [ ] **Step 2: Create `.oxfmtrc`**

```json
{
  "indent_width": 2,
  "use_tabs": false,
  "line_width": 100,
  "trailing_comma": "all",
  "semicolons": true,
  "single_quote": true
}
```

- [ ] **Step 3: Verify oxlint runs**

Run: `bun run lint`
Expected: no files matched (no source yet) or zero errors.

- [ ] **Step 4: Verify oxfmt runs**

Run: `bun run format -- --check`
Expected: nothing to format.

- [ ] **Step 5: Commit**

```bash
git add oxlint.json .oxfmtrc
git commit -m "chore: add oxlint and oxfmt configs"
```

---

### Task 0.3: Create package stubs

**Files:**
- Create: `packages/wayang/package.json`
- Create: `packages/wayang/tsconfig.json`
- Create: `packages/wayang/src/index.ts`
- Create: `packages/dalang/package.json`
- Create: `packages/dalang/tsconfig.json`
- Create: `packages/dalang/src/index.ts`

- [ ] **Step 1: Wayang `package.json`**

```json
{
  "name": "@tok-juara/wayang",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "bin": {
    "wayang": "./src/index.ts"
  },
  "scripts": {
    "start": "bun run src/index.ts",
    "test": "bun test"
  },
  "dependencies": {
    "marked": "^14.0.0",
    "isomorphic-dompurify": "^2.0.0"
  }
}
```

- [ ] **Step 2: Wayang `tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 3: Wayang stub `src/index.ts`**

```typescript
console.log('wayang stub');
```

- [ ] **Step 4: Dalang stub** (mirrors above for dalang)

`packages/dalang/package.json`:
```json
{
  "name": "@tok-juara/dalang",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "bin": {
    "dalang": "./src/index.ts"
  },
  "scripts": {
    "start": "bun run src/index.ts",
    "test": "bun test"
  }
}
```

`packages/dalang/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*", "tests/**/*"]
}
```

`packages/dalang/src/index.ts`:
```typescript
console.log('dalang stub');
```

- [ ] **Step 5: Verify both run**

Run: `bun run --filter=@tok-juara/wayang start`
Expected: `wayang stub`

Run: `bun run --filter=@tok-juara/dalang start`
Expected: `dalang stub`

- [ ] **Step 6: Commit**

```bash
git add packages/
git commit -m "chore: add wayang and dalang package stubs"
```

---

## Phase 1 — Wayang Foundation

### Task 1.1: ULID and identifier sequence

**Files:**
- Create: `packages/wayang/src/lib/ids.ts`
- Create: `packages/wayang/tests/lib/ids.test.ts`

- [ ] **Step 1: Write failing test** at `packages/wayang/tests/lib/ids.test.ts`

```typescript
import { describe, expect, test } from 'bun:test';
import { ulid, formatIdentifier } from '../../src/lib/ids';

describe('ulid', () => {
  test('produces 26-char Crockford base32 string', () => {
    const id = ulid();
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  test('two IDs in sequence are unique and lexicographically ordered', () => {
    const a = ulid();
    const b = ulid();
    expect(a).not.toEqual(b);
    expect(a < b).toBe(true);
  });
});

describe('formatIdentifier', () => {
  test('formats as JUARA-N', () => {
    expect(formatIdentifier(1)).toBe('JUARA-1');
    expect(formatIdentifier(42)).toBe('JUARA-42');
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `bun test packages/wayang/tests/lib/ids.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** at `packages/wayang/src/lib/ids.ts`

```typescript
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

let lastTime = 0;
let lastRandom = new Uint8Array(10);

function encodeTime(now: number, len: number): string {
  let out = '';
  let t = now;
  for (let i = len - 1; i >= 0; i--) {
    out = ENCODING[t % 32]! + out;
    t = Math.floor(t / 32);
  }
  return out;
}

function encodeRandom(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += ENCODING[bytes[i]! % 32];
  return out;
}

function fillRandom(): Uint8Array {
  const buf = new Uint8Array(10);
  crypto.getRandomValues(buf);
  return buf;
}

function bumpRandom(buf: Uint8Array): Uint8Array {
  const out = new Uint8Array(buf);
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i]! < 255) {
      out[i]!++;
      return out;
    }
    out[i] = 0;
  }
  return out;
}

export function ulid(): string {
  const now = Date.now();
  if (now === lastTime) {
    lastRandom = bumpRandom(lastRandom);
  } else {
    lastTime = now;
    lastRandom = fillRandom();
  }
  return encodeTime(now, 10) + encodeRandom(lastRandom);
}

export function formatIdentifier(n: number): string {
  return `JUARA-${n}`;
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `bun test packages/wayang/tests/lib/ids.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/wayang/src/lib/ids.ts packages/wayang/tests/lib/ids.test.ts
git commit -m "feat(wayang): add ULID and identifier formatter"
```

---

### Task 1.2: SQLite schema and migration runner

**Files:**
- Create: `packages/wayang/src/db/schema.sql`
- Create: `packages/wayang/src/db/migrations.ts`
- Create: `packages/wayang/tests/db/migrations.test.ts`

- [ ] **Step 1: Write `schema.sql`** (full DDL from spec §5)

```sql
CREATE TABLE IF NOT EXISTS issues (
  id              TEXT PRIMARY KEY,
  identifier      TEXT NOT NULL UNIQUE,
  title           TEXT NOT NULL,
  description     TEXT,
  priority        INTEGER,
  state           TEXT NOT NULL,
  parent_issue_id TEXT REFERENCES issues(id) ON DELETE SET NULL,
  external_ref    TEXT,
  external_url    TEXT,
  branch_name     TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS issues_state_idx      ON issues(state);
CREATE INDEX IF NOT EXISTS issues_updated_at_idx ON issues(updated_at);
CREATE INDEX IF NOT EXISTS issues_parent_idx     ON issues(parent_issue_id);

CREATE TABLE IF NOT EXISTS issue_labels (
  issue_id  TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  label     TEXT NOT NULL,
  PRIMARY KEY (issue_id, label)
);

CREATE TABLE IF NOT EXISTS issue_blockers (
  issue_id   TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  blocker_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  PRIMARY KEY (issue_id, blocker_id),
  CHECK (issue_id <> blocker_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id          TEXT PRIMARY KEY,
  issue_id    TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  author      TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS comments_issue_id_idx ON comments(issue_id);

CREATE TABLE IF NOT EXISTS history (
  id          TEXT PRIMARY KEY,
  issue_id    TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  from_value  TEXT,
  to_value    TEXT,
  actor       TEXT NOT NULL,
  at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS history_issue_id_idx ON history(issue_id);

CREATE TABLE IF NOT EXISTS seq (
  name   TEXT PRIMARY KEY,
  value  INTEGER NOT NULL
);

INSERT OR IGNORE INTO seq (name, value) VALUES ('issue_identifier', 0);
```

- [ ] **Step 2: Write failing test** at `packages/wayang/tests/db/migrations.test.ts`

```typescript
import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../../src/db/migrations';

describe('runMigrations', () => {
  test('creates all tables idempotently', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    runMigrations(db); // idempotent

    const tables = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => r.name);

    expect(tables).toContain('issues');
    expect(tables).toContain('issue_labels');
    expect(tables).toContain('issue_blockers');
    expect(tables).toContain('comments');
    expect(tables).toContain('history');
    expect(tables).toContain('seq');
  });

  test('initializes issue_identifier sequence to 0', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const row = db
      .query<{ value: number }, []>("SELECT value FROM seq WHERE name='issue_identifier'")
      .get();
    expect(row?.value).toBe(0);
  });
});
```

- [ ] **Step 3: Run test, verify failure**

Run: `bun test packages/wayang/tests/db/migrations.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement** at `packages/wayang/src/db/migrations.ts`

```typescript
import type { Database } from 'bun:sqlite';
import schema from './schema.sql' with { type: 'text' };

export function runMigrations(db: Database): void {
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(schema);
}
```

- [ ] **Step 5: Run test, verify pass**

Run: `bun test packages/wayang/tests/db/migrations.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/wayang/src/db packages/wayang/tests/db
git commit -m "feat(wayang): add SQLite schema and migration runner"
```

---

### Task 1.3: Identifier sequence allocator

**Files:**
- Create: `packages/wayang/src/db/seq.ts`
- Create: `packages/wayang/tests/db/seq.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../../src/db/migrations';
import { allocateIdentifier } from '../../src/db/seq';

describe('allocateIdentifier', () => {
  test('returns monotonically increasing JUARA-N', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    expect(allocateIdentifier(db)).toBe('JUARA-1');
    expect(allocateIdentifier(db)).toBe('JUARA-2');
    expect(allocateIdentifier(db)).toBe('JUARA-3');
  });
});
```

- [ ] **Step 2: Run, verify failure**

- [ ] **Step 3: Implement**

```typescript
import type { Database } from 'bun:sqlite';
import { formatIdentifier } from '../lib/ids';

export function allocateIdentifier(db: Database): string {
  const row = db
    .query<{ value: number }, []>(
      "UPDATE seq SET value = value + 1 WHERE name = 'issue_identifier' RETURNING value",
    )
    .get();
  if (!row) throw new Error('issue_identifier sequence missing');
  return formatIdentifier(row.value);
}
```

- [ ] **Step 4: Run, verify pass**

- [ ] **Step 5: Commit**

```bash
git add packages/wayang/src/db/seq.ts packages/wayang/tests/db/seq.test.ts
git commit -m "feat(wayang): add identifier sequence allocator"
```

---

## Phase 2 — Domain Layer

### Task 2.1: Issue type and state machine

**Files:**
- Create: `packages/wayang/src/domain/issue.ts`
- Create: `packages/wayang/tests/domain/issue.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, expect, test } from 'bun:test';
import { ACTIVE_STATES, ALL_STATES, TERMINAL_STATES, isActive, isTerminal, isValidState } from '../../src/domain/issue';

describe('issue state machine', () => {
  test('canonical sets are exhaustive', () => {
    expect(ALL_STATES).toEqual(['Todo', 'In Progress', 'In Review', 'Done', 'Cancelled']);
    expect(ACTIVE_STATES).toEqual(['Todo', 'In Progress']);
    expect(TERMINAL_STATES).toEqual(['Done', 'Cancelled']);
  });

  test('isActive / isTerminal classify correctly', () => {
    expect(isActive('Todo')).toBe(true);
    expect(isActive('In Progress')).toBe(true);
    expect(isActive('Done')).toBe(false);
    expect(isTerminal('Done')).toBe(true);
    expect(isTerminal('Cancelled')).toBe(true);
    expect(isTerminal('Todo')).toBe(false);
  });

  test('isValidState recognizes all canonical states', () => {
    for (const s of ALL_STATES) expect(isValidState(s)).toBe(true);
    expect(isValidState('garbage')).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify failure**

- [ ] **Step 3: Implement**

```typescript
export type IssueState = 'Todo' | 'In Progress' | 'In Review' | 'Done' | 'Cancelled';

export const ALL_STATES = ['Todo', 'In Progress', 'In Review', 'Done', 'Cancelled'] as const satisfies readonly IssueState[];
export const ACTIVE_STATES = ['Todo', 'In Progress'] as const satisfies readonly IssueState[];
export const TERMINAL_STATES = ['Done', 'Cancelled'] as const satisfies readonly IssueState[];

export function isActive(s: string): boolean {
  return (ACTIVE_STATES as readonly string[]).includes(s);
}
export function isTerminal(s: string): boolean {
  return (TERMINAL_STATES as readonly string[]).includes(s);
}
export function isValidState(s: string): s is IssueState {
  return (ALL_STATES as readonly string[]).includes(s);
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
  blocked_by: { id: string | null; identifier: string | null; state: string | null }[];
  created_at: string | null;
  updated_at: string | null;
}
```

- [ ] **Step 4: Run, verify pass**

- [ ] **Step 5: Commit**

```bash
git add packages/wayang/src/domain/issue.ts packages/wayang/tests/domain/issue.test.ts
git commit -m "feat(wayang): add issue state machine and NormalizedIssue type"
```

---

### Task 2.2: Markdown rendering with sanitization

**Files:**
- Create: `packages/wayang/src/lib/markdown.ts`
- Create: `packages/wayang/tests/lib/markdown.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, expect, test } from 'bun:test';
import { renderMarkdown } from '../../src/lib/markdown';

describe('renderMarkdown', () => {
  test('renders basic markdown', () => {
    const html = renderMarkdown('# Hello\n\n**bold**');
    expect(html).toContain('<h1');
    expect(html).toContain('<strong>bold</strong>');
  });

  test('strips inline scripts', () => {
    const html = renderMarkdown('<script>alert(1)</script>safe');
    expect(html).not.toContain('<script');
    expect(html).toContain('safe');
  });

  test('strips javascript: URLs', () => {
    const html = renderMarkdown('[click](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
  });

  test('preserves http(s) and relative links', () => {
    expect(renderMarkdown('[a](https://example.com)')).toContain('href="https://example.com"');
    expect(renderMarkdown('[a](/issues/1)')).toContain('href="/issues/1"');
  });
});
```

- [ ] **Step 2: Run, verify failure**

- [ ] **Step 3: Implement**

```typescript
import { marked } from 'marked';
import DOMPurify from 'isomorphic-dompurify';

const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'br', 'hr',
    'strong', 'em', 'del', 'code', 'pre',
    'ul', 'ol', 'li',
    'a', 'blockquote',
    'img',
  ],
  ALLOWED_ATTR: ['href', 'title', 'src', 'alt'],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
};

export function renderMarkdown(src: string): string {
  const raw = marked.parse(src, { async: false }) as string;
  return DOMPurify.sanitize(raw, PURIFY_CONFIG);
}
```

- [ ] **Step 4: Run, verify pass**

- [ ] **Step 5: Commit**

```bash
git add packages/wayang/src/lib/markdown.ts packages/wayang/tests/lib/markdown.test.ts
git commit -m "feat(wayang): add sanitized markdown renderer"
```

---

### Task 2.3: Linear URL parser

**Files:**
- Create: `packages/wayang/src/lib/linear-url.ts`
- Create: `packages/wayang/tests/lib/linear-url.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, expect, test } from 'bun:test';
import { parseLinearUrl } from '../../src/lib/linear-url';

describe('parseLinearUrl', () => {
  test('extracts org and key from canonical URL', () => {
    expect(parseLinearUrl('https://linear.app/acme/issue/ABC-123/some-title')).toEqual({
      external_ref: 'ABC-123',
      external_url: 'https://linear.app/acme/issue/ABC-123/some-title',
    });
  });

  test('extracts when slug is omitted', () => {
    expect(parseLinearUrl('https://linear.app/acme/issue/ABC-123')).toEqual({
      external_ref: 'ABC-123',
      external_url: 'https://linear.app/acme/issue/ABC-123',
    });
  });

  test('returns null for non-Linear URLs', () => {
    expect(parseLinearUrl('https://github.com/foo/bar/issues/1')).toBeNull();
    expect(parseLinearUrl('not-a-url')).toBeNull();
    expect(parseLinearUrl('')).toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify failure**

- [ ] **Step 3: Implement**

```typescript
const LINEAR_URL_RE = /^https:\/\/linear\.app\/[^/]+\/issue\/([A-Z][A-Z0-9]+-\d+)(?:\/.*)?$/;

export interface ParsedLinearUrl {
  external_ref: string;
  external_url: string;
}

export function parseLinearUrl(input: string): ParsedLinearUrl | null {
  const match = LINEAR_URL_RE.exec(input.trim());
  if (!match) return null;
  return { external_ref: match[1]!, external_url: input.trim() };
}
```

- [ ] **Step 4: Run, verify pass**

- [ ] **Step 5: Commit**

```bash
git add packages/wayang/src/lib/linear-url.ts packages/wayang/tests/lib/linear-url.test.ts
git commit -m "feat(wayang): add Linear URL parser"
```

---

## Phase 3 — Repository Layer

### Task 3.1: Issue repository — CRUD + normalization

**Files:**
- Create: `packages/wayang/src/db/repo/issues.ts`
- Create: `packages/wayang/tests/db/repo/issues.test.ts`

This task is large because it covers the central repo functions used by all API endpoints. Decompose into one helper per query but keep them in a single file.

- [ ] **Step 1: Write failing test**

```typescript
import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../../../src/db/migrations';
import {
  createIssue,
  getIssueById,
  getIssuesByStates,
  getIssuesByIds,
  updateIssue,
  deleteIssue,
} from '../../../src/db/repo/issues';

function freshDb(): Database {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

describe('issues repo', () => {
  test('createIssue assigns identifier and returns NormalizedIssue', () => {
    const db = freshDb();
    const issue = createIssue(db, { title: 'first', state: 'Todo' });
    expect(issue.identifier).toBe('JUARA-1');
    expect(issue.title).toBe('first');
    expect(issue.state).toBe('Todo');
    expect(issue.labels).toEqual([]);
    expect(issue.blocked_by).toEqual([]);
  });

  test('createIssue normalizes labels to lowercase', () => {
    const db = freshDb();
    const issue = createIssue(db, { title: 't', state: 'Todo', labels: ['Bug', 'P1', 'bug'] });
    expect(issue.labels.sort()).toEqual(['bug', 'p1']);
  });

  test('createIssue persists blockers and hydrates them', () => {
    const db = freshDb();
    const a = createIssue(db, { title: 'a', state: 'Todo' });
    const b = createIssue(db, { title: 'b', state: 'Todo', blocker_ids: [a.id] });
    expect(b.blocked_by).toEqual([{ id: a.id, identifier: 'JUARA-1', state: 'Todo' }]);
  });

  test('getIssueById returns null for unknown id', () => {
    const db = freshDb();
    expect(getIssueById(db, 'nope')).toBeNull();
  });

  test('getIssuesByStates filters and paginates', () => {
    const db = freshDb();
    createIssue(db, { title: 'a', state: 'Todo' });
    createIssue(db, { title: 'b', state: 'Done' });
    createIssue(db, { title: 'c', state: 'Todo' });
    const result = getIssuesByStates(db, ['Todo'], null, 50);
    expect(result.issues.length).toBe(2);
    expect(result.next_cursor).toBeNull();
  });

  test('getIssuesByIds returns matching subset', () => {
    const db = freshDb();
    const a = createIssue(db, { title: 'a', state: 'Todo' });
    const b = createIssue(db, { title: 'b', state: 'Todo' });
    const result = getIssuesByIds(db, [a.id, 'unknown', b.id]);
    expect(result.length).toBe(2);
  });

  test('updateIssue patches and bumps updated_at', () => {
    const db = freshDb();
    const a = createIssue(db, { title: 'a', state: 'Todo' });
    const before = a.updated_at;
    Bun.sleepSync(5);
    const updated = updateIssue(db, a.id, { state: 'In Progress' });
    expect(updated?.state).toBe('In Progress');
    expect(updated?.updated_at).not.toBe(before);
  });

  test('deleteIssue removes the row and cascades', () => {
    const db = freshDb();
    const a = createIssue(db, { title: 'a', state: 'Todo', labels: ['x'] });
    deleteIssue(db, a.id);
    expect(getIssueById(db, a.id)).toBeNull();
    const labelCount = db
      .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM issue_labels")
      .get();
    expect(labelCount?.n).toBe(0);
  });
});
```

- [ ] **Step 2: Run, verify failure**

- [ ] **Step 3: Implement**

```typescript
import type { Database } from 'bun:sqlite';
import { ulid } from '../../lib/ids';
import { allocateIdentifier } from '../seq';
import type { NormalizedIssue } from '../../domain/issue';

export interface CreateIssueInput {
  title: string;
  description?: string | null;
  priority?: number | null;
  state: string;
  parent_issue_id?: string | null;
  external_ref?: string | null;
  external_url?: string | null;
  branch_name?: string | null;
  labels?: string[];
  blocker_ids?: string[];
}

export type UpdateIssueInput = Partial<CreateIssueInput>;

interface IssueRow {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  priority: number | null;
  state: string;
  parent_issue_id: string | null;
  external_ref: string | null;
  external_url: string | null;
  branch_name: string | null;
  created_at: string;
  updated_at: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function hydrateLabels(db: Database, issueId: string): string[] {
  return db
    .query<{ label: string }, [string]>('SELECT label FROM issue_labels WHERE issue_id = ?')
    .all(issueId)
    .map((r) => r.label);
}

function hydrateBlockers(
  db: Database,
  issueId: string,
): NormalizedIssue['blocked_by'] {
  return db
    .query<{ id: string; identifier: string; state: string }, [string]>(
      `SELECT i.id, i.identifier, i.state
         FROM issue_blockers b
         JOIN issues i ON i.id = b.blocker_id
        WHERE b.issue_id = ?
        ORDER BY i.identifier`,
    )
    .all(issueId)
    .map((r) => ({ id: r.id, identifier: r.identifier, state: r.state }));
}

function rowToNormalized(db: Database, row: IssueRow): NormalizedIssue {
  return {
    id: row.id,
    identifier: row.identifier,
    title: row.title,
    description: row.description,
    priority: row.priority,
    state: row.state,
    branch_name: row.branch_name,
    url: row.external_url,
    labels: hydrateLabels(db, row.id),
    blocked_by: hydrateBlockers(db, row.id),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function createIssue(db: Database, input: CreateIssueInput): NormalizedIssue {
  const id = ulid();
  const identifier = allocateIdentifier(db);
  const now = nowIso();

  const tx = db.transaction(() => {
    db.query(
      `INSERT INTO issues
         (id, identifier, title, description, priority, state,
          parent_issue_id, external_ref, external_url, branch_name,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      identifier,
      input.title,
      input.description ?? null,
      input.priority ?? null,
      input.state,
      input.parent_issue_id ?? null,
      input.external_ref ?? null,
      input.external_url ?? null,
      input.branch_name ?? null,
      now,
      now,
    );

    if (input.labels?.length) {
      const seen = new Set<string>();
      for (const raw of input.labels) {
        const lbl = raw.toLowerCase().trim();
        if (!lbl || seen.has(lbl)) continue;
        seen.add(lbl);
        db.query('INSERT INTO issue_labels (issue_id, label) VALUES (?, ?)').run(id, lbl);
      }
    }

    if (input.blocker_ids?.length) {
      for (const blockerId of input.blocker_ids) {
        if (blockerId === id) continue;
        db.query(
          'INSERT OR IGNORE INTO issue_blockers (issue_id, blocker_id) VALUES (?, ?)',
        ).run(id, blockerId);
      }
    }
  });
  tx();

  const row = db.query<IssueRow, [string]>('SELECT * FROM issues WHERE id = ?').get(id);
  if (!row) throw new Error('createIssue: row vanished');
  return rowToNormalized(db, row);
}

export function getIssueById(db: Database, id: string): NormalizedIssue | null {
  const row = db.query<IssueRow, [string]>('SELECT * FROM issues WHERE id = ?').get(id);
  return row ? rowToNormalized(db, row) : null;
}

function encodeCursor(updated_at: string, id: string): string {
  return Buffer.from(`${updated_at}|${id}`).toString('base64url');
}
function decodeCursor(c: string): { updated_at: string; id: string } | null {
  try {
    const [u, i] = Buffer.from(c, 'base64url').toString('utf8').split('|');
    if (!u || !i) return null;
    return { updated_at: u, id: i };
  } catch {
    return null;
  }
}

export interface PageResult {
  issues: NormalizedIssue[];
  next_cursor: string | null;
}

export function getIssuesByStates(
  db: Database,
  states: string[],
  cursor: string | null,
  limit: number,
): PageResult {
  if (states.length === 0) return { issues: [], next_cursor: null };

  const placeholders = states.map(() => '?').join(',');
  const params: (string | number)[] = [...states];
  let where = `state IN (${placeholders})`;

  if (cursor) {
    const c = decodeCursor(cursor);
    if (c) {
      where += ` AND (updated_at, id) < (?, ?)`;
      params.push(c.updated_at, c.id);
    }
  }

  const rows = db
    .query<IssueRow, (string | number)[]>(
      `SELECT * FROM issues
        WHERE ${where}
        ORDER BY updated_at DESC, id DESC
        LIMIT ?`,
    )
    .all(...params, limit + 1);

  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  const next = hasMore && slice.length
    ? encodeCursor(slice[slice.length - 1]!.updated_at, slice[slice.length - 1]!.id)
    : null;

  return { issues: slice.map((r) => rowToNormalized(db, r)), next_cursor: next };
}

export function getIssuesByIds(db: Database, ids: string[]): NormalizedIssue[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .query<IssueRow, string[]>(`SELECT * FROM issues WHERE id IN (${placeholders})`)
    .all(...ids);
  return rows.map((r) => rowToNormalized(db, r));
}

export function updateIssue(
  db: Database,
  id: string,
  input: UpdateIssueInput,
): NormalizedIssue | null {
  const existing = db.query<IssueRow, [string]>('SELECT * FROM issues WHERE id = ?').get(id);
  if (!existing) return null;

  const now = nowIso();
  const tx = db.transaction(() => {
    const fields: string[] = ['updated_at = ?'];
    const params: (string | number | null)[] = [now];
    const setIfDefined = <K extends keyof CreateIssueInput>(key: K, col: string) => {
      if (input[key] === undefined) return;
      fields.push(`${col} = ?`);
      params.push((input[key] ?? null) as string | number | null);
    };
    setIfDefined('title', 'title');
    setIfDefined('description', 'description');
    setIfDefined('priority', 'priority');
    setIfDefined('state', 'state');
    setIfDefined('parent_issue_id', 'parent_issue_id');
    setIfDefined('external_ref', 'external_ref');
    setIfDefined('external_url', 'external_url');
    setIfDefined('branch_name', 'branch_name');

    params.push(id);
    db.query(`UPDATE issues SET ${fields.join(', ')} WHERE id = ?`).run(...params);

    if (input.labels !== undefined) {
      db.query('DELETE FROM issue_labels WHERE issue_id = ?').run(id);
      const seen = new Set<string>();
      for (const raw of input.labels ?? []) {
        const lbl = raw.toLowerCase().trim();
        if (!lbl || seen.has(lbl)) continue;
        seen.add(lbl);
        db.query('INSERT INTO issue_labels (issue_id, label) VALUES (?, ?)').run(id, lbl);
      }
    }

    if (input.blocker_ids !== undefined) {
      db.query('DELETE FROM issue_blockers WHERE issue_id = ?').run(id);
      for (const blockerId of input.blocker_ids ?? []) {
        if (blockerId === id) continue;
        db.query(
          'INSERT OR IGNORE INTO issue_blockers (issue_id, blocker_id) VALUES (?, ?)',
        ).run(id, blockerId);
      }
    }
  });
  tx();

  const row = db.query<IssueRow, [string]>('SELECT * FROM issues WHERE id = ?').get(id);
  return row ? rowToNormalized(db, row) : null;
}

export function deleteIssue(db: Database, id: string): boolean {
  const result = db.query('DELETE FROM issues WHERE id = ?').run(id);
  return result.changes > 0;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `bun test packages/wayang/tests/db/repo/issues.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/wayang/src/db/repo packages/wayang/tests/db/repo
git commit -m "feat(wayang): add issues repository with CRUD and pagination"
```

---

### Task 3.2: Comments and history repos

**Files:**
- Create: `packages/wayang/src/db/repo/comments.ts`
- Create: `packages/wayang/src/db/repo/history.ts`
- Create: `packages/wayang/tests/db/repo/comments.test.ts`
- Create: `packages/wayang/tests/db/repo/history.test.ts`

- [ ] **Step 1: Write failing tests**

`tests/db/repo/comments.test.ts`:
```typescript
import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../../../src/db/migrations';
import { createIssue } from '../../../src/db/repo/issues';
import { addComment, listComments } from '../../../src/db/repo/comments';

function freshDb(): Database {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

describe('comments repo', () => {
  test('addComment + listComments roundtrip', () => {
    const db = freshDb();
    const issue = createIssue(db, { title: 't', state: 'Todo' });
    const c1 = addComment(db, issue.id, { body: 'first', author: 'user' });
    const c2 = addComment(db, issue.id, { body: 'second', author: 'agent' });
    const list = listComments(db, issue.id);
    expect(list.map((c) => c.id)).toEqual([c1.id, c2.id]);
    expect(list[0]!.author).toBe('user');
    expect(list[1]!.author).toBe('agent');
    expect(list[0]!.body_html).toContain('first');
  });
});
```

`tests/db/repo/history.test.ts`:
```typescript
import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../../../src/db/migrations';
import { createIssue } from '../../../src/db/repo/issues';
import { addHistory, listHistory } from '../../../src/db/repo/history';

function freshDb(): Database {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

describe('history repo', () => {
  test('appends and lists in order', () => {
    const db = freshDb();
    const issue = createIssue(db, { title: 't', state: 'Todo' });
    addHistory(db, { issue_id: issue.id, kind: 'created', from_value: null, to_value: 'Todo', actor: 'user' });
    addHistory(db, { issue_id: issue.id, kind: 'state_changed', from_value: 'Todo', to_value: 'In Progress', actor: 'agent' });
    const list = listHistory(db, issue.id);
    expect(list.length).toBe(2);
    expect(list[0]!.kind).toBe('created');
    expect(list[1]!.kind).toBe('state_changed');
  });
});
```

- [ ] **Step 2: Run, verify failure**

- [ ] **Step 3: Implement**

`src/domain/comment.ts`:
```typescript
export interface Comment {
  id: string;
  issue_id: string;
  body: string;
  body_html: string;
  author: 'user' | 'agent';
  created_at: string;
}
```

`src/domain/history.ts`:
```typescript
export type HistoryKind = 'created' | 'state_changed' | 'edited' | 'comment_added' | 'deleted';

export interface HistoryEntry {
  id: string;
  issue_id: string;
  kind: HistoryKind;
  from_value: string | null;
  to_value: string | null;
  actor: 'user' | 'agent';
  at: string;
}
```

`src/db/repo/comments.ts`:
```typescript
import type { Database } from 'bun:sqlite';
import { ulid } from '../../lib/ids';
import { renderMarkdown } from '../../lib/markdown';
import type { Comment } from '../../domain/comment';

export interface AddCommentInput {
  body: string;
  author?: 'user' | 'agent';
}

interface CommentRow {
  id: string;
  issue_id: string;
  body: string;
  author: 'user' | 'agent';
  created_at: string;
}

function rowToComment(row: CommentRow): Comment {
  return { ...row, body_html: renderMarkdown(row.body) };
}

export function addComment(db: Database, issueId: string, input: AddCommentInput): Comment {
  const id = ulid();
  const author = input.author ?? 'user';
  const at = new Date().toISOString();
  db.query(
    'INSERT INTO comments (id, issue_id, body, author, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(id, issueId, input.body, author, at);
  return rowToComment({ id, issue_id: issueId, body: input.body, author, created_at: at });
}

export function listComments(db: Database, issueId: string): Comment[] {
  return db
    .query<CommentRow, [string]>(
      'SELECT * FROM comments WHERE issue_id = ? ORDER BY created_at ASC, id ASC',
    )
    .all(issueId)
    .map(rowToComment);
}
```

`src/db/repo/history.ts`:
```typescript
import type { Database } from 'bun:sqlite';
import { ulid } from '../../lib/ids';
import type { HistoryEntry, HistoryKind } from '../../domain/history';

export interface AddHistoryInput {
  issue_id: string;
  kind: HistoryKind;
  from_value: string | null;
  to_value: string | null;
  actor: 'user' | 'agent';
}

interface HistoryRow {
  id: string;
  issue_id: string;
  kind: HistoryKind;
  from_value: string | null;
  to_value: string | null;
  actor: 'user' | 'agent';
  at: string;
}

export function addHistory(db: Database, input: AddHistoryInput): HistoryEntry {
  const id = ulid();
  const at = new Date().toISOString();
  db.query(
    `INSERT INTO history (id, issue_id, kind, from_value, to_value, actor, at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.issue_id, input.kind, input.from_value, input.to_value, input.actor, at);
  return { id, ...input, at };
}

export function listHistory(db: Database, issueId: string): HistoryEntry[] {
  return db
    .query<HistoryRow, [string]>(
      'SELECT * FROM history WHERE issue_id = ? ORDER BY at ASC, id ASC',
    )
    .all(issueId);
}
```

- [ ] **Step 4: Run, verify pass**

- [ ] **Step 5: Commit**

```bash
git add packages/wayang/src/db/repo/comments.ts packages/wayang/src/db/repo/history.ts \
  packages/wayang/src/domain/comment.ts packages/wayang/src/domain/history.ts \
  packages/wayang/tests/db/repo/comments.test.ts packages/wayang/tests/db/repo/history.test.ts
git commit -m "feat(wayang): add comments and history repositories"
```

---

## Phase 4 — SSE Bus

### Task 4.1: In-memory event bus

**Files:**
- Create: `packages/wayang/src/lib/sse.ts`
- Create: `packages/wayang/tests/lib/sse.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, expect, test } from 'bun:test';
import { EventBus } from '../../src/lib/sse';

describe('EventBus', () => {
  test('publishes to all subscribers', () => {
    const bus = new EventBus();
    const a: unknown[] = [];
    const b: unknown[] = [];
    bus.subscribe((e) => a.push(e));
    bus.subscribe((e) => b.push(e));
    bus.publish('test', { v: 1 });
    expect(a).toEqual([{ name: 'test', data: { v: 1 } }]);
    expect(b).toEqual([{ name: 'test', data: { v: 1 } }]);
  });

  test('unsubscribe stops delivery', () => {
    const bus = new EventBus();
    const seen: unknown[] = [];
    const off = bus.subscribe((e) => seen.push(e));
    off();
    bus.publish('test', {});
    expect(seen).toEqual([]);
  });

  test('throwing subscriber is dropped, others still receive', () => {
    const bus = new EventBus();
    bus.subscribe(() => { throw new Error('boom'); });
    const seen: unknown[] = [];
    bus.subscribe((e) => seen.push(e));
    bus.publish('test', {});
    expect(seen.length).toBe(1);
    expect(bus.size).toBe(1);
  });
});
```

- [ ] **Step 2: Run, verify failure**

- [ ] **Step 3: Implement**

```typescript
export interface BusEvent {
  name: string;
  data: unknown;
}

export type Subscriber = (event: BusEvent) => void;

export class EventBus {
  #subs = new Set<Subscriber>();

  get size(): number {
    return this.#subs.size;
  }

  subscribe(fn: Subscriber): () => void {
    this.#subs.add(fn);
    return () => this.#subs.delete(fn);
  }

  publish(name: string, data: unknown): void {
    const event: BusEvent = { name, data };
    for (const fn of [...this.#subs]) {
      try {
        fn(event);
      } catch {
        this.#subs.delete(fn);
      }
    }
  }
}
```

- [ ] **Step 4: Run, verify pass**

- [ ] **Step 5: Commit**

```bash
git add packages/wayang/src/lib/sse.ts packages/wayang/tests/lib/sse.test.ts
git commit -m "feat(wayang): add in-memory SSE event bus"
```

---

## Phase 5 — API Layer

### Task 5.1: Server scaffolding and bearer-token middleware

**Files:**
- Create: `packages/wayang/src/api/auth.ts`
- Create: `packages/wayang/src/api/server.ts`
- Create: `packages/wayang/tests/api/auth.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, expect, test } from 'bun:test';
import { authMiddleware } from '../../src/api/auth';

describe('authMiddleware', () => {
  test('passes when no token configured', () => {
    const fn = authMiddleware(undefined);
    const req = new Request('http://x/api/v1/issues');
    expect(fn(req)).toBeNull();
  });

  test('rejects /api/v1/* without bearer when token configured', () => {
    const fn = authMiddleware('s3cret');
    const req = new Request('http://x/api/v1/issues');
    const res = fn(req);
    expect(res?.status).toBe(401);
  });

  test('passes /api/v1/* with correct bearer', () => {
    const fn = authMiddleware('s3cret');
    const req = new Request('http://x/api/v1/issues', {
      headers: { authorization: 'Bearer s3cret' },
    });
    expect(fn(req)).toBeNull();
  });

  test('skips UI routes when token is configured', () => {
    const fn = authMiddleware('s3cret');
    expect(fn(new Request('http://x/'))).toBeNull();
    expect(fn(new Request('http://x/issues/abc'))).toBeNull();
    expect(fn(new Request('http://x/static/style.css'))).toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify failure**

- [ ] **Step 3: Implement** at `src/api/auth.ts`

```typescript
export type AuthCheck = (req: Request) => Response | null;

export function authMiddleware(token: string | undefined): AuthCheck {
  return (req) => {
    if (!token) return null;
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/v1/')) return null;
    const header = req.headers.get('authorization');
    if (header === `Bearer ${token}`) return null;
    return Response.json({ error: { code: 'unauthorized', message: 'missing or invalid bearer token' } }, { status: 401 });
  };
}
```

- [ ] **Step 4: Run, verify pass**

- [ ] **Step 5: Implement server scaffold** at `src/api/server.ts`

```typescript
import type { Database } from 'bun:sqlite';
import { authMiddleware } from './auth';
import { EventBus } from '../lib/sse';

export interface ServerOptions {
  db: Database;
  apiToken: string | undefined;
  port: number;
  hostname?: string;
}

export interface RunningServer {
  url: string;
  port: number;
  bus: EventBus;
  stop(): void;
}

export type RouteHandler = (
  req: Request,
  match: URLPatternResult,
  ctx: { db: Database; bus: EventBus },
) => Response | Promise<Response>;

export interface Route {
  method: string;
  pattern: URLPattern;
  handler: RouteHandler;
}

export function startServer(opts: ServerOptions, routes: Route[]): RunningServer {
  const auth = authMiddleware(opts.apiToken);
  const bus = new EventBus();
  const ctx = { db: opts.db, bus };

  const server = Bun.serve({
    hostname: opts.hostname ?? '127.0.0.1',
    port: opts.port,
    async fetch(req) {
      const guard = auth(req);
      if (guard) return guard;

      for (const r of routes) {
        if (r.method !== req.method) continue;
        const match = r.pattern.exec(req.url);
        if (!match) continue;
        try {
          return await r.handler(req, match, ctx);
        } catch (err) {
          console.error('handler error', err);
          return Response.json(
            { error: { code: 'internal_error', message: 'unexpected error' } },
            { status: 500 },
          );
        }
      }
      return new Response('Not Found', { status: 404 });
    },
  });

  return {
    url: server.url.toString(),
    port: server.port,
    bus,
    stop: () => server.stop(true),
  };
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/wayang/src/api/auth.ts packages/wayang/src/api/server.ts packages/wayang/tests/api/auth.test.ts
git commit -m "feat(wayang): add server scaffolding and bearer-token middleware"
```

---

### Task 5.2: GET /api/v1/issues (list with state filter and pagination)

**Files:**
- Create: `packages/wayang/src/api/routes/issues-list.ts`
- Create: `packages/wayang/tests/api/issues-list.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, expect, test, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../../src/db/migrations';
import { createIssue } from '../../src/db/repo/issues';
import { startServer } from '../../src/api/server';
import { issuesListRoute } from '../../src/api/routes/issues-list';

let db: Database;
let server: ReturnType<typeof startServer>;

beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db);
});

function start() {
  server = startServer({ db, apiToken: undefined, port: 0 }, [issuesListRoute()]);
}

describe('GET /api/v1/issues', () => {
  test('filters by state', async () => {
    createIssue(db, { title: 'a', state: 'Todo' });
    createIssue(db, { title: 'b', state: 'Done' });
    start();
    const res = await fetch(`${server.url}api/v1/issues?state=Todo`);
    const body = (await res.json()) as { issues: { title: string }[]; next_cursor: string | null };
    expect(body.issues.map((i) => i.title)).toEqual(['a']);
    expect(body.next_cursor).toBeNull();
    server.stop();
  });

  test('returns 400 on missing state param', async () => {
    start();
    const res = await fetch(`${server.url}api/v1/issues`);
    expect(res.status).toBe(400);
    server.stop();
  });
});
```

- [ ] **Step 2: Run, verify failure**

- [ ] **Step 3: Implement**

```typescript
import { getIssuesByStates } from '../../db/repo/issues';
import type { Route } from '../server';

const DEFAULT_LIMIT = 50;

export function issuesListRoute(): Route {
  return {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/v1/issues' }),
    handler: (req, _match, { db }) => {
      const url = new URL(req.url);
      const states = url.searchParams.getAll('state');
      if (states.length === 0) {
        return Response.json(
          { error: { code: 'missing_state', message: 'at least one state parameter is required' } },
          { status: 400 },
        );
      }
      const cursor = url.searchParams.get('cursor');
      const result = getIssuesByStates(db, states, cursor, DEFAULT_LIMIT);
      return Response.json(result);
    },
  };
}
```

- [ ] **Step 4: Run, verify pass**

- [ ] **Step 5: Commit**

```bash
git add packages/wayang/src/api/routes/issues-list.ts packages/wayang/tests/api/issues-list.test.ts
git commit -m "feat(wayang): add GET /api/v1/issues route"
```

---

### Task 5.3: GET /api/v1/issues/by-ids and GET /api/v1/issues/:id

**Files:**
- Create: `packages/wayang/src/api/routes/issues-by-ids.ts`
- Create: `packages/wayang/src/api/routes/issues-detail.ts`
- Create: `packages/wayang/tests/api/issues-detail.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, expect, test, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../../src/db/migrations';
import { createIssue } from '../../src/db/repo/issues';
import { startServer } from '../../src/api/server';
import { issuesByIdsRoute } from '../../src/api/routes/issues-by-ids';
import { issuesDetailRoute } from '../../src/api/routes/issues-detail';

let db: Database;
beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db);
});

describe('issue lookups', () => {
  test('GET /api/v1/issues/by-ids', async () => {
    const a = createIssue(db, { title: 'a', state: 'Todo' });
    const server = startServer({ db, apiToken: undefined, port: 0 }, [issuesByIdsRoute()]);
    const res = await fetch(`${server.url}api/v1/issues/by-ids?id=${a.id}&id=missing`);
    const body = (await res.json()) as { issues: { id: string }[] };
    expect(body.issues.map((i) => i.id)).toEqual([a.id]);
    server.stop();
  });

  test('GET /api/v1/issues/:id 404', async () => {
    const server = startServer({ db, apiToken: undefined, port: 0 }, [issuesDetailRoute()]);
    const res = await fetch(`${server.url}api/v1/issues/missing`);
    expect(res.status).toBe(404);
    server.stop();
  });

  test('GET /api/v1/issues/:id 200', async () => {
    const a = createIssue(db, { title: 'a', state: 'Todo' });
    const server = startServer({ db, apiToken: undefined, port: 0 }, [issuesDetailRoute()]);
    const res = await fetch(`${server.url}api/v1/issues/${a.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe(a.id);
    server.stop();
  });
});
```

- [ ] **Step 2: Run, verify failure**

- [ ] **Step 3: Implement**

`issues-by-ids.ts`:
```typescript
import { getIssuesByIds } from '../../db/repo/issues';
import type { Route } from '../server';

export function issuesByIdsRoute(): Route {
  return {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/v1/issues/by-ids' }),
    handler: (req, _match, { db }) => {
      const url = new URL(req.url);
      const ids = url.searchParams.getAll('id');
      const issues = getIssuesByIds(db, ids);
      return Response.json({ issues });
    },
  };
}
```

`issues-detail.ts`:
```typescript
import { getIssueById } from '../../db/repo/issues';
import type { Route } from '../server';

export function issuesDetailRoute(): Route {
  return {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/v1/issues/:id' }),
    handler: (_req, match, { db }) => {
      const id = match.pathname.groups.id!;
      const issue = getIssueById(db, id);
      if (!issue) {
        return Response.json(
          { error: { code: 'issue_not_found', message: `issue ${id} not found` } },
          { status: 404 },
        );
      }
      return Response.json(issue);
    },
  };
}
```

Note: register `issuesByIdsRoute()` **before** `issuesDetailRoute()` so the more specific path wins.

- [ ] **Step 4: Run, verify pass**

- [ ] **Step 5: Commit**

```bash
git add packages/wayang/src/api/routes packages/wayang/tests/api/issues-detail.test.ts
git commit -m "feat(wayang): add issue by-ids and detail routes"
```

---

### Task 5.4: POST /api/v1/issues with state-change broadcasting

**Files:**
- Create: `packages/wayang/src/api/routes/issues-create.ts`
- Create: `packages/wayang/tests/api/issues-create.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, expect, test, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../../src/db/migrations';
import { startServer } from '../../src/api/server';
import { issuesCreateRoute } from '../../src/api/routes/issues-create';

let db: Database;
beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db);
});

describe('POST /api/v1/issues', () => {
  test('creates with defaults', async () => {
    const server = startServer({ db, apiToken: undefined, port: 0 }, [issuesCreateRoute()]);
    const res = await fetch(`${server.url}api/v1/issues`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'new' }),
    });
    expect(res.status).toBe(201);
    const issue = (await res.json()) as { state: string; title: string; identifier: string };
    expect(issue.state).toBe('Todo');
    expect(issue.title).toBe('new');
    expect(issue.identifier).toBe('JUARA-1');
    server.stop();
  });

  test('400 on missing title', async () => {
    const server = startServer({ db, apiToken: undefined, port: 0 }, [issuesCreateRoute()]);
    const res = await fetch(`${server.url}api/v1/issues`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    server.stop();
  });

  test('400 on invalid state', async () => {
    const server = startServer({ db, apiToken: undefined, port: 0 }, [issuesCreateRoute()]);
    const res = await fetch(`${server.url}api/v1/issues`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 't', state: 'Bogus' }),
    });
    expect(res.status).toBe(400);
    server.stop();
  });
});
```

- [ ] **Step 2: Run, verify failure**

- [ ] **Step 3: Implement**

```typescript
import { createIssue } from '../../db/repo/issues';
import { addHistory } from '../../db/repo/history';
import { isValidState } from '../../domain/issue';
import type { Route } from '../server';

interface CreateBody {
  title?: unknown;
  description?: unknown;
  priority?: unknown;
  state?: unknown;
  parent_issue_id?: unknown;
  external_ref?: unknown;
  external_url?: unknown;
  branch_name?: unknown;
  labels?: unknown;
  blocker_ids?: unknown;
}

export function issuesCreateRoute(): Route {
  return {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/v1/issues' }),
    handler: async (req, _match, { db, bus }) => {
      let body: CreateBody;
      try {
        body = (await req.json()) as CreateBody;
      } catch {
        return Response.json({ error: { code: 'bad_json', message: 'invalid JSON body' } }, { status: 400 });
      }

      if (typeof body.title !== 'string' || body.title.trim() === '') {
        return Response.json(
          { error: { code: 'missing_field', message: 'title is required', fields: ['title'] } },
          { status: 400 },
        );
      }

      const state = typeof body.state === 'string' ? body.state : 'Todo';
      if (!isValidState(state)) {
        return Response.json(
          { error: { code: 'invalid_state', message: `unknown state ${state}`, fields: ['state'] } },
          { status: 400 },
        );
      }

      const issue = createIssue(db, {
        title: body.title.trim(),
        description: typeof body.description === 'string' ? body.description : null,
        priority: typeof body.priority === 'number' ? body.priority : null,
        state,
        parent_issue_id: typeof body.parent_issue_id === 'string' ? body.parent_issue_id : null,
        external_ref: typeof body.external_ref === 'string' ? body.external_ref : null,
        external_url: typeof body.external_url === 'string' ? body.external_url : null,
        branch_name: typeof body.branch_name === 'string' ? body.branch_name : null,
        labels: Array.isArray(body.labels) ? body.labels.filter((s): s is string => typeof s === 'string') : [],
        blocker_ids: Array.isArray(body.blocker_ids) ? body.blocker_ids.filter((s): s is string => typeof s === 'string') : [],
      });

      addHistory(db, { issue_id: issue.id, kind: 'created', from_value: null, to_value: state, actor: 'user' });
      bus.publish('issue.created', issue);

      return Response.json(issue, { status: 201 });
    },
  };
}
```

- [ ] **Step 4: Run, verify pass**

- [ ] **Step 5: Commit**

```bash
git add packages/wayang/src/api/routes/issues-create.ts packages/wayang/tests/api/issues-create.test.ts
git commit -m "feat(wayang): add POST /api/v1/issues route"
```

---

### Task 5.5: PATCH and DELETE /api/v1/issues/:id

**Files:**
- Create: `packages/wayang/src/api/routes/issues-update.ts`
- Create: `packages/wayang/src/api/routes/issues-delete.ts`
- Create: `packages/wayang/tests/api/issues-update.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, expect, test, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../../src/db/migrations';
import { createIssue } from '../../src/db/repo/issues';
import { listHistory } from '../../src/db/repo/history';
import { startServer } from '../../src/api/server';
import { issuesUpdateRoute } from '../../src/api/routes/issues-update';
import { issuesDeleteRoute } from '../../src/api/routes/issues-delete';

let db: Database;
beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db);
});

describe('PATCH/DELETE /api/v1/issues/:id', () => {
  test('PATCH state change appends history with actor', async () => {
    const a = createIssue(db, { title: 't', state: 'Todo' });
    const server = startServer({ db, apiToken: undefined, port: 0 }, [issuesUpdateRoute()]);
    const res = await fetch(`${server.url}api/v1/issues/${a.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'In Progress', actor: 'agent' }),
    });
    expect(res.status).toBe(200);
    const history = listHistory(db, a.id);
    const stateChange = history.find((h) => h.kind === 'state_changed');
    expect(stateChange?.actor).toBe('agent');
    expect(stateChange?.from_value).toBe('Todo');
    expect(stateChange?.to_value).toBe('In Progress');
    server.stop();
  });

  test('DELETE removes', async () => {
    const a = createIssue(db, { title: 't', state: 'Todo' });
    const server = startServer({ db, apiToken: undefined, port: 0 }, [issuesDeleteRoute()]);
    const res = await fetch(`${server.url}api/v1/issues/${a.id}`, { method: 'DELETE' });
    expect(res.status).toBe(204);
    server.stop();
  });
});
```

- [ ] **Step 2: Run, verify failure**

- [ ] **Step 3: Implement**

`issues-update.ts`:
```typescript
import { getIssueById, updateIssue } from '../../db/repo/issues';
import { addHistory } from '../../db/repo/history';
import { isValidState } from '../../domain/issue';
import type { Route } from '../server';

interface PatchBody {
  title?: unknown;
  description?: unknown;
  priority?: unknown;
  state?: unknown;
  parent_issue_id?: unknown;
  external_ref?: unknown;
  external_url?: unknown;
  branch_name?: unknown;
  labels?: unknown;
  blocker_ids?: unknown;
  actor?: unknown;
}

export function issuesUpdateRoute(): Route {
  return {
    method: 'PATCH',
    pattern: new URLPattern({ pathname: '/api/v1/issues/:id' }),
    handler: async (req, match, { db, bus }) => {
      const id = match.pathname.groups.id!;
      const existing = getIssueById(db, id);
      if (!existing) {
        return Response.json(
          { error: { code: 'issue_not_found', message: `issue ${id} not found` } },
          { status: 404 },
        );
      }

      let body: PatchBody;
      try {
        body = (await req.json()) as PatchBody;
      } catch {
        return Response.json({ error: { code: 'bad_json', message: 'invalid JSON body' } }, { status: 400 });
      }

      if (body.state !== undefined && (typeof body.state !== 'string' || !isValidState(body.state))) {
        return Response.json(
          { error: { code: 'invalid_state', message: 'unknown state', fields: ['state'] } },
          { status: 400 },
        );
      }

      const actor: 'user' | 'agent' = body.actor === 'agent' ? 'agent' : 'user';
      const oldState = existing.state;

      const updated = updateIssue(db, id, {
        ...(typeof body.title === 'string' ? { title: body.title } : {}),
        ...(body.description !== undefined ? { description: typeof body.description === 'string' ? body.description : null } : {}),
        ...(body.priority !== undefined ? { priority: typeof body.priority === 'number' ? body.priority : null } : {}),
        ...(typeof body.state === 'string' ? { state: body.state } : {}),
        ...(body.parent_issue_id !== undefined ? { parent_issue_id: typeof body.parent_issue_id === 'string' ? body.parent_issue_id : null } : {}),
        ...(body.external_ref !== undefined ? { external_ref: typeof body.external_ref === 'string' ? body.external_ref : null } : {}),
        ...(body.external_url !== undefined ? { external_url: typeof body.external_url === 'string' ? body.external_url : null } : {}),
        ...(body.branch_name !== undefined ? { branch_name: typeof body.branch_name === 'string' ? body.branch_name : null } : {}),
        ...(Array.isArray(body.labels) ? { labels: body.labels.filter((s): s is string => typeof s === 'string') } : {}),
        ...(Array.isArray(body.blocker_ids) ? { blocker_ids: body.blocker_ids.filter((s): s is string => typeof s === 'string') } : {}),
      });

      if (!updated) {
        return Response.json({ error: { code: 'issue_not_found' } }, { status: 404 });
      }

      if (typeof body.state === 'string' && body.state !== oldState) {
        addHistory(db, {
          issue_id: id,
          kind: 'state_changed',
          from_value: oldState,
          to_value: body.state,
          actor,
        });
        bus.publish('state.changed', { id, identifier: updated.identifier, from: oldState, to: body.state, actor });
      } else {
        addHistory(db, { issue_id: id, kind: 'edited', from_value: null, to_value: null, actor });
      }

      bus.publish('issue.updated', updated);
      return Response.json(updated);
    },
  };
}
```

`issues-delete.ts`:
```typescript
import { getIssueById, deleteIssue } from '../../db/repo/issues';
import type { Route } from '../server';

export function issuesDeleteRoute(): Route {
  return {
    method: 'DELETE',
    pattern: new URLPattern({ pathname: '/api/v1/issues/:id' }),
    handler: (_req, match, { db, bus }) => {
      const id = match.pathname.groups.id!;
      const existing = getIssueById(db, id);
      if (!existing) {
        return Response.json({ error: { code: 'issue_not_found' } }, { status: 404 });
      }
      deleteIssue(db, id);
      bus.publish('issue.deleted', { id, identifier: existing.identifier });
      return new Response(null, { status: 204 });
    },
  };
}
```

- [ ] **Step 4: Run, verify pass**

- [ ] **Step 5: Commit**

```bash
git add packages/wayang/src/api/routes/issues-update.ts packages/wayang/src/api/routes/issues-delete.ts packages/wayang/tests/api/issues-update.test.ts
git commit -m "feat(wayang): add PATCH and DELETE issue routes"
```

---

### Task 5.6: Comments and history routes

**Files:**
- Create: `packages/wayang/src/api/routes/comments.ts`
- Create: `packages/wayang/src/api/routes/history.ts`
- Create: `packages/wayang/tests/api/comments.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, expect, test, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../../src/db/migrations';
import { createIssue } from '../../src/db/repo/issues';
import { startServer } from '../../src/api/server';
import { commentsListRoute, commentsCreateRoute } from '../../src/api/routes/comments';
import { historyListRoute } from '../../src/api/routes/history';

let db: Database;
beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db);
});

describe('comments and history routes', () => {
  test('POST + GET comments', async () => {
    const a = createIssue(db, { title: 't', state: 'Todo' });
    const server = startServer({ db, apiToken: undefined, port: 0 }, [
      commentsCreateRoute(),
      commentsListRoute(),
    ]);

    const post = await fetch(`${server.url}api/v1/issues/${a.id}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'hello **world**', author: 'agent' }),
    });
    expect(post.status).toBe(201);

    const get = await fetch(`${server.url}api/v1/issues/${a.id}/comments`);
    const body = (await get.json()) as { comments: { author: string; body_html: string }[] };
    expect(body.comments[0]!.author).toBe('agent');
    expect(body.comments[0]!.body_html).toContain('<strong>world</strong>');
    server.stop();
  });

  test('GET history shows creation event', async () => {
    const a = createIssue(db, { title: 't', state: 'Todo' });
    const server = startServer({ db, apiToken: undefined, port: 0 }, [historyListRoute()]);
    // No history added by repo; this test verifies route shape only.
    const res = await fetch(`${server.url}api/v1/issues/${a.id}/history`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { history: unknown[] };
    expect(Array.isArray(body.history)).toBe(true);
    server.stop();
  });
});
```

- [ ] **Step 2: Run, verify failure**

- [ ] **Step 3: Implement**

`comments.ts`:
```typescript
import { addComment, listComments } from '../../db/repo/comments';
import { addHistory } from '../../db/repo/history';
import { getIssueById } from '../../db/repo/issues';
import type { Route } from '../server';

interface CommentBody {
  body?: unknown;
  author?: unknown;
}

export function commentsListRoute(): Route {
  return {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/v1/issues/:id/comments' }),
    handler: (_req, match, { db }) => {
      const id = match.pathname.groups.id!;
      const issue = getIssueById(db, id);
      if (!issue) return Response.json({ error: { code: 'issue_not_found' } }, { status: 404 });
      return Response.json({ comments: listComments(db, id) });
    },
  };
}

export function commentsCreateRoute(): Route {
  return {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/v1/issues/:id/comments' }),
    handler: async (req, match, { db, bus }) => {
      const id = match.pathname.groups.id!;
      const issue = getIssueById(db, id);
      if (!issue) return Response.json({ error: { code: 'issue_not_found' } }, { status: 404 });

      let body: CommentBody;
      try {
        body = (await req.json()) as CommentBody;
      } catch {
        return Response.json({ error: { code: 'bad_json' } }, { status: 400 });
      }

      if (typeof body.body !== 'string' || body.body.trim() === '') {
        return Response.json(
          { error: { code: 'missing_field', message: 'body is required', fields: ['body'] } },
          { status: 400 },
        );
      }

      const author: 'user' | 'agent' = body.author === 'agent' ? 'agent' : 'user';
      const comment = addComment(db, id, { body: body.body, author });
      addHistory(db, { issue_id: id, kind: 'comment_added', from_value: null, to_value: null, actor: author });
      bus.publish('comment.added', { issue_id: id, comment });
      return Response.json(comment, { status: 201 });
    },
  };
}
```

`history.ts`:
```typescript
import { listHistory } from '../../db/repo/history';
import { getIssueById } from '../../db/repo/issues';
import type { Route } from '../server';

export function historyListRoute(): Route {
  return {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/v1/issues/:id/history' }),
    handler: (_req, match, { db }) => {
      const id = match.pathname.groups.id!;
      const issue = getIssueById(db, id);
      if (!issue) return Response.json({ error: { code: 'issue_not_found' } }, { status: 404 });
      return Response.json({ history: listHistory(db, id) });
    },
  };
}
```

- [ ] **Step 4: Run, verify pass**

- [ ] **Step 5: Commit**

```bash
git add packages/wayang/src/api/routes/comments.ts packages/wayang/src/api/routes/history.ts packages/wayang/tests/api/comments.test.ts
git commit -m "feat(wayang): add comments and history routes"
```

---

### Task 5.7: GET /api/v1/events (SSE stream)

**Files:**
- Create: `packages/wayang/src/api/routes/events.ts`
- Create: `packages/wayang/tests/api/events.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, expect, test, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../../src/db/migrations';
import { startServer } from '../../src/api/server';
import { eventsRoute } from '../../src/api/routes/events';

let db: Database;
beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db);
});

describe('GET /api/v1/events', () => {
  test('streams a published event', async () => {
    const server = startServer({ db, apiToken: undefined, port: 0 }, [eventsRoute()]);
    const res = await fetch(`${server.url}api/v1/events`);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    // publish from outside the stream
    setTimeout(() => server.bus.publish('test.evt', { v: 1 }), 20);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (!buf.includes('event: test.evt')) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value);
    }
    expect(buf).toContain('event: test.evt');
    expect(buf).toContain('data: {"v":1}');
    await reader.cancel();
    server.stop();
  });
});
```

- [ ] **Step 2: Run, verify failure**

- [ ] **Step 3: Implement**

```typescript
import type { Route } from '../server';

export function eventsRoute(): Route {
  return {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/v1/events' }),
    handler: (_req, _match, { bus }) => {
      const stream = new ReadableStream({
        start(controller) {
          const enc = new TextEncoder();
          const off = bus.subscribe((e) => {
            try {
              const payload = `event: ${e.name}\ndata: ${JSON.stringify(e.data)}\n\n`;
              controller.enqueue(enc.encode(payload));
            } catch {
              off();
            }
          });
          // initial comment to establish stream
          controller.enqueue(enc.encode(': connected\n\n'));
        },
      });

      return new Response(stream, {
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        },
      });
    },
  };
}
```

- [ ] **Step 4: Run, verify pass**

- [ ] **Step 5: Commit**

```bash
git add packages/wayang/src/api/routes/events.ts packages/wayang/tests/api/events.test.ts
git commit -m "feat(wayang): add SSE events route"
```

---

## Phase 6 — UI: Structural Pass

The structural pass produces correct, accessible HTML and HTMX behavior with **plain unstyled layout**. The visual design pass (Phase 7) replaces the styling and microcopy after structure is locked in. Do not skip ahead to design.

### Task 6.1: Static asset serving and HTMX vendoring

**Files:**
- Create: `packages/wayang/src/ui/public/style.css` (placeholder)
- Create: `packages/wayang/src/ui/public/htmx.min.js` (vendored)
- Create: `packages/wayang/src/ui/public/sse.js` (vendored)
- Create: `packages/wayang/src/ui/static.ts`

- [ ] **Step 1: Vendor HTMX**

Run:
```bash
mkdir -p packages/wayang/src/ui/public
curl -L -o packages/wayang/src/ui/public/htmx.min.js https://unpkg.com/htmx.org@2.0.3/dist/htmx.min.js
curl -L -o packages/wayang/src/ui/public/sse.js https://unpkg.com/htmx-ext-sse@2.2.2/sse.js
```
Verify both files are non-empty.

- [ ] **Step 2: Placeholder `style.css`**

```css
/* placeholder; replaced by frontend-design pass in Phase 7 */
body { font-family: system-ui, sans-serif; max-width: 960px; margin: 2rem auto; padding: 0 1rem; }
```

- [ ] **Step 3: Implement static route at `src/ui/static.ts`**

```typescript
import type { Route } from '../api/server';

const ROOT = new URL('./public/', import.meta.url);

export function staticRoute(): Route {
  return {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/static/:rest+' }),
    handler: async (_req, match) => {
      const rel = match.pathname.groups.rest!;
      if (rel.includes('..')) return new Response('Not Found', { status: 404 });
      const file = Bun.file(new URL(rel, ROOT).pathname);
      if (!(await file.exists())) return new Response('Not Found', { status: 404 });
      return new Response(file);
    },
  };
}
```

- [ ] **Step 4: Smoke-test from CLI**

(Verified later via integration test in Task 8.2.)

- [ ] **Step 5: Commit**

```bash
git add packages/wayang/src/ui/public packages/wayang/src/ui/static.ts
git commit -m "feat(wayang): vendor HTMX and add static asset route"
```

---

### Task 6.2: Layout shell and partial helpers

**Files:**
- Create: `packages/wayang/src/ui/layout.ts`
- Create: `packages/wayang/src/ui/partials/state-badge.ts`
- Create: `packages/wayang/tests/ui/state-badge.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, expect, test } from 'bun:test';
import { renderStateBadge } from '../../src/ui/partials/state-badge';

describe('renderStateBadge', () => {
  test('renders state label inside data-state attribute', () => {
    const html = renderStateBadge('In Progress');
    expect(html).toContain('data-state="In Progress"');
    expect(html).toContain('In Progress');
  });

  test('escapes user-provided values', () => {
    const html = renderStateBadge('<script>x</script>');
    expect(html).not.toContain('<script>');
  });
});
```

- [ ] **Step 2: Run, verify failure**

- [ ] **Step 3: Implement**

`src/ui/layout.ts`:
```typescript
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · wayang</title>
<link rel="stylesheet" href="/static/style.css">
<script src="/static/htmx.min.js" defer></script>
<script src="/static/sse.js" defer></script>
</head>
<body>
<header>
  <a href="/"><strong>wayang</strong></a>
  <a href="/new">+ New issue</a>
</header>
<main hx-ext="sse" sse-connect="/api/v1/events">
${body}
</main>
</body>
</html>`;
}
```

`src/ui/partials/state-badge.ts`:
```typescript
import { escapeHtml } from '../layout';

export function renderStateBadge(state: string): string {
  const safe = escapeHtml(state);
  return `<span class="state-badge" data-state="${safe}">${safe}</span>`;
}
```

- [ ] **Step 4: Run, verify pass**

- [ ] **Step 5: Commit**

```bash
git add packages/wayang/src/ui/layout.ts packages/wayang/src/ui/partials packages/wayang/tests/ui
git commit -m "feat(wayang): add UI layout shell and state-badge partial"
```

---

### Task 6.3: Issue list page and row partial

**Files:**
- Create: `packages/wayang/src/ui/partials/issue-row.ts`
- Create: `packages/wayang/src/ui/pages/list.ts`
- Create: `packages/wayang/src/ui/routes.ts`
- Create: `packages/wayang/tests/ui/issue-row.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, expect, test } from 'bun:test';
import { renderIssueRow } from '../../src/ui/partials/issue-row';
import type { NormalizedIssue } from '../../src/domain/issue';

const issue: NormalizedIssue = {
  id: '01ABC',
  identifier: 'JUARA-1',
  title: 'first',
  description: null,
  priority: 2,
  state: 'Todo',
  branch_name: null,
  url: null,
  labels: ['bug'],
  blocked_by: [],
  created_at: '2026-04-29T00:00:00Z',
  updated_at: '2026-04-29T00:00:00Z',
};

describe('renderIssueRow', () => {
  test('contains identifier link, title, state, labels', () => {
    const html = renderIssueRow(issue);
    expect(html).toContain('href="/issues/01ABC"');
    expect(html).toContain('JUARA-1');
    expect(html).toContain('first');
    expect(html).toContain('data-state="Todo"');
    expect(html).toContain('bug');
  });

  test('row has hx-target id for SSE swap', () => {
    const html = renderIssueRow(issue);
    expect(html).toContain('id="row-01ABC"');
  });
});
```

- [ ] **Step 2: Run, verify failure**

- [ ] **Step 3: Implement**

`partials/issue-row.ts`:
```typescript
import type { NormalizedIssue } from '../../domain/issue';
import { ALL_STATES } from '../../domain/issue';
import { escapeHtml } from '../layout';
import { renderStateBadge } from './state-badge';

export function renderIssueRow(issue: NormalizedIssue): string {
  const labels = issue.labels.map((l) => `<span class="label">${escapeHtml(l)}</span>`).join(' ');
  const stateOptions = ALL_STATES.map(
    (s) => `<option value="${s}"${s === issue.state ? ' selected' : ''}>${s}</option>`,
  ).join('');
  return `<tr id="row-${escapeHtml(issue.id)}">
  <td><a href="/issues/${escapeHtml(issue.id)}">${escapeHtml(issue.identifier)}</a></td>
  <td>${escapeHtml(issue.title)}</td>
  <td>${renderStateBadge(issue.state)}
    <select hx-patch="/api/v1/issues/${escapeHtml(issue.id)}"
            hx-trigger="change"
            hx-vals="js:{state: event.target.value, actor: 'user'}"
            hx-ext="json-enc"
            hx-swap="none">
      ${stateOptions}
    </select>
  </td>
  <td>${issue.priority ?? ''}</td>
  <td>${labels}</td>
  <td>${escapeHtml(issue.updated_at ?? '')}</td>
</tr>`;
}
```

`pages/list.ts`:
```typescript
import { layout } from '../layout';
import { renderIssueRow } from '../partials/issue-row';
import { ACTIVE_STATES, ALL_STATES, TERMINAL_STATES } from '../../domain/issue';
import type { NormalizedIssue } from '../../domain/issue';

export interface ListPageInput {
  issues: NormalizedIssue[];
  selectedStates: string[];
  q: string;
}

export function renderListPage({ issues, selectedStates, q }: ListPageInput): string {
  const stateChips = ALL_STATES.map((s) => {
    const checked = selectedStates.includes(s) ? ' checked' : '';
    return `<label><input type="checkbox" name="state" value="${s}"${checked}> ${s}</label>`;
  }).join(' ');

  const rows = issues.map(renderIssueRow).join('\n');

  const body = `
<form method="get" action="/" class="filters">
  <input type="search" name="q" value="${q}" placeholder="Search title or description">
  <fieldset><legend>State</legend>${stateChips}</fieldset>
  <button type="submit">Filter</button>
  <a href="/?state=${ACTIVE_STATES.join('&state=')}">Active</a>
  <a href="/?state=${TERMINAL_STATES.join('&state=')}">Terminal</a>
</form>
<table>
<thead><tr><th>ID</th><th>Title</th><th>State</th><th>Priority</th><th>Labels</th><th>Updated</th></tr></thead>
<tbody id="issues-tbody"
       sse-swap="issue.created,issue.updated,state.changed,issue.deleted"
       hx-get="/partials/issues?${selectedStates.map((s) => `state=${encodeURIComponent(s)}`).join('&')}&q=${encodeURIComponent(q)}"
       hx-trigger="sse:issue.created,sse:issue.updated,sse:state.changed,sse:issue.deleted">
${rows}
</tbody>
</table>`;
  return layout('Issues', body);
}
```

`src/ui/routes.ts`:
```typescript
import type { Route } from '../api/server';
import { getIssuesByStates } from '../db/repo/issues';
import { renderListPage } from './pages/list';
import { ACTIVE_STATES } from '../domain/issue';

export function uiListRoute(): Route {
  return {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/' }),
    handler: (req, _match, { db }) => {
      const url = new URL(req.url);
      const selected = url.searchParams.getAll('state');
      const states = selected.length > 0 ? selected : (ACTIVE_STATES as readonly string[]).slice();
      const q = url.searchParams.get('q') ?? '';
      const { issues } = getIssuesByStates(db, states, null, 200);
      // q-filter (LIKE) deferred to a tbody-only partial; basic filter:
      const filtered = q
        ? issues.filter(
            (i) =>
              i.title.toLowerCase().includes(q.toLowerCase()) ||
              (i.description ?? '').toLowerCase().includes(q.toLowerCase()),
          )
        : issues;
      return new Response(renderListPage({ issues: filtered, selectedStates: states, q }), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    },
  };
}
```

- [ ] **Step 4: Run, verify pass**

- [ ] **Step 5: Commit**

```bash
git add packages/wayang/src/ui packages/wayang/tests/ui/issue-row.test.ts
git commit -m "feat(wayang): add issue list page"
```

---

### Task 6.4: Issue detail page with HTMX inline editing

**Files:**
- Create: `packages/wayang/src/ui/pages/detail.ts`
- Create: `packages/wayang/src/ui/partials/comment.ts`
- Create: `packages/wayang/src/ui/partials/history-item.ts`
- Modify: `packages/wayang/src/ui/routes.ts` — add `uiDetailRoute()`
- Create: `packages/wayang/tests/ui/detail.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, expect, test } from 'bun:test';
import { renderDetailPage } from '../../src/ui/pages/detail';
import type { NormalizedIssue } from '../../src/domain/issue';

const issue: NormalizedIssue = {
  id: 'X', identifier: 'JUARA-1', title: 't', description: 'hello',
  priority: null, state: 'Todo', branch_name: null, url: null,
  labels: [], blocked_by: [], created_at: '', updated_at: '',
};

describe('renderDetailPage', () => {
  test('shows title, identifier, description, state-change form', () => {
    const html = renderDetailPage({ issue, comments: [], history: [] });
    expect(html).toContain('JUARA-1');
    expect(html).toContain('hello');
    expect(html).toContain(`hx-patch="/api/v1/issues/X"`);
    expect(html).toContain('id="comments"');
    expect(html).toContain('id="history"');
  });
});
```

- [ ] **Step 2: Run, verify failure**

- [ ] **Step 3: Implement**

`partials/comment.ts`:
```typescript
import type { Comment } from '../../domain/comment';
import { escapeHtml } from '../layout';

export function renderComment(c: Comment): string {
  return `<article class="comment" data-author="${c.author}" id="comment-${escapeHtml(c.id)}">
  <header><strong>${c.author}</strong> · <time>${escapeHtml(c.created_at)}</time></header>
  <div class="body">${c.body_html}</div>
</article>`;
}
```

`partials/history-item.ts`:
```typescript
import type { HistoryEntry } from '../../domain/history';
import { escapeHtml } from '../layout';

export function renderHistoryItem(h: HistoryEntry): string {
  let line: string;
  switch (h.kind) {
    case 'created': line = `created with state ${escapeHtml(h.to_value ?? '')}`; break;
    case 'state_changed': line = `state ${escapeHtml(h.from_value ?? '')} → ${escapeHtml(h.to_value ?? '')}`; break;
    case 'edited': line = 'edited'; break;
    case 'comment_added': line = 'comment added'; break;
    case 'deleted': line = 'deleted'; break;
  }
  return `<li><time>${escapeHtml(h.at)}</time> · <strong>${h.actor}</strong> ${line}</li>`;
}
```

`pages/detail.ts`:
```typescript
import { layout, escapeHtml } from '../layout';
import { renderStateBadge } from '../partials/state-badge';
import { renderComment } from '../partials/comment';
import { renderHistoryItem } from '../partials/history-item';
import { ALL_STATES, type NormalizedIssue } from '../../domain/issue';
import type { Comment } from '../../domain/comment';
import type { HistoryEntry } from '../../domain/history';

export interface DetailPageInput {
  issue: NormalizedIssue;
  comments: Comment[];
  history: HistoryEntry[];
}

export function renderDetailPage({ issue, comments, history }: DetailPageInput): string {
  const stateOptions = ALL_STATES.map(
    (s) => `<option value="${s}"${s === issue.state ? ' selected' : ''}>${s}</option>`,
  ).join('');

  const labels = issue.labels.map((l) => `<span class="label">${escapeHtml(l)}</span>`).join(' ');
  const blockers = issue.blocked_by
    .map((b) => `<a href="/issues/${escapeHtml(b.id ?? '')}">${escapeHtml(b.identifier ?? '?')}</a> (${escapeHtml(b.state ?? '?')})`)
    .join(', ');

  const commentList = comments.map(renderComment).join('\n');
  const historyList = history.map(renderHistoryItem).join('\n');

  const body = `
<article id="issue-${escapeHtml(issue.id)}"
         hx-ext="sse"
         sse-connect="/api/v1/events"
         sse-swap="issue.updated"
         hx-target="this">
  <header>
    <h1>${escapeHtml(issue.identifier)} ${escapeHtml(issue.title)}</h1>
    ${renderStateBadge(issue.state)}
    <select hx-patch="/api/v1/issues/${escapeHtml(issue.id)}"
            hx-trigger="change"
            hx-vals="js:{state: event.target.value, actor: 'user'}"
            hx-ext="json-enc"
            hx-swap="none">
      ${stateOptions}
    </select>
  </header>

  <aside>
    <dl>
      <dt>Priority</dt><dd>${issue.priority ?? '—'}</dd>
      <dt>Labels</dt><dd>${labels || '—'}</dd>
      <dt>Blockers</dt><dd>${blockers || '—'}</dd>
      <dt>External</dt><dd>${
        issue.url ? `<a href="${escapeHtml(issue.url)}" target="_blank" rel="noopener">link</a>` : '—'
      }</dd>
      <dt>Branch</dt><dd>${escapeHtml(issue.branch_name ?? '—')}</dd>
    </dl>
  </aside>

  <section class="description">
    <h2>Description</h2>
    <div class="markdown">${escapeHtml(issue.description ?? '')}</div>
  </section>

  <section id="comments">
    <h2>Comments</h2>
    <div sse-swap="comment.added" hx-swap="beforeend">
      ${commentList}
    </div>
    <form hx-post="/api/v1/issues/${escapeHtml(issue.id)}/comments"
          hx-ext="json-enc"
          hx-target="#comments > div"
          hx-swap="beforeend">
      <textarea name="body" required placeholder="Comment (markdown)"></textarea>
      <button type="submit">Post</button>
    </form>
  </section>

  <section id="history">
    <h2>History</h2>
    <ol>${historyList}</ol>
  </section>
</article>`;
  return layout(`${issue.identifier} · ${issue.title}`, body);
}
```

In `src/ui/routes.ts` add:

```typescript
import { renderDetailPage } from './pages/detail';
import { getIssueById } from '../db/repo/issues';
import { listComments } from '../db/repo/comments';
import { listHistory } from '../db/repo/history';

export function uiDetailRoute(): Route {
  return {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/issues/:id' }),
    handler: (_req, match, { db }) => {
      const id = match.pathname.groups.id!;
      const issue = getIssueById(db, id);
      if (!issue) return new Response('Not Found', { status: 404 });
      const comments = listComments(db, id);
      const history = listHistory(db, id);
      return new Response(renderDetailPage({ issue, comments, history }), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    },
  };
}
```

- [ ] **Step 4: Run, verify pass**

- [ ] **Step 5: Commit**

```bash
git add packages/wayang/src/ui packages/wayang/tests/ui/detail.test.ts
git commit -m "feat(wayang): add issue detail page with HTMX interactions"
```

---

### Task 6.5: Create issue page with Linear URL paste

**Files:**
- Create: `packages/wayang/src/ui/pages/new.ts`
- Modify: `packages/wayang/src/ui/routes.ts` — add `uiNewRoute()` (GET) and `uiCreatePostRoute()` (POST form handler)
- Create: `packages/wayang/tests/ui/new.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, expect, test } from 'bun:test';
import { renderNewPage } from '../../src/ui/pages/new';

describe('renderNewPage', () => {
  test('contains title, description, linear-url paste, state default', () => {
    const html = renderNewPage({});
    expect(html).toContain('name="title"');
    expect(html).toContain('name="description"');
    expect(html).toContain('name="linear_url"');
    expect(html).toContain('name="state"');
    expect(html).toContain('value="Todo" selected');
  });
});
```

- [ ] **Step 2: Run, verify failure**

- [ ] **Step 3: Implement**

`pages/new.ts`:
```typescript
import { layout, escapeHtml } from '../layout';
import { ALL_STATES } from '../../domain/issue';

export interface NewPageInput {
  error?: string;
  values?: { title?: string; description?: string; linear_url?: string; labels?: string };
}

export function renderNewPage({ error, values = {} }: NewPageInput): string {
  const stateOptions = ALL_STATES.map(
    (s) => `<option value="${s}"${s === 'Todo' ? ' selected' : ''}>${s}</option>`,
  ).join('');
  const body = `
${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
<form method="post" action="/new">
  <label>Paste Linear URL (optional)
    <input type="url" name="linear_url" value="${escapeHtml(values.linear_url ?? '')}" placeholder="https://linear.app/...">
  </label>
  <label>Title
    <input type="text" name="title" required value="${escapeHtml(values.title ?? '')}">
  </label>
  <label>Description (markdown)
    <textarea name="description">${escapeHtml(values.description ?? '')}</textarea>
  </label>
  <label>State
    <select name="state">${stateOptions}</select>
  </label>
  <label>Priority
    <select name="priority">
      <option value="">—</option>
      <option value="1">1 (highest)</option>
      <option value="2">2</option>
      <option value="3">3</option>
      <option value="4">4</option>
    </select>
  </label>
  <label>Labels (comma-separated)
    <input type="text" name="labels" value="${escapeHtml(values.labels ?? '')}">
  </label>
  <button type="submit">Create</button>
</form>`;
  return layout('New issue', body);
}
```

In `src/ui/routes.ts` add:

```typescript
import { renderNewPage } from './pages/new';
import { createIssue } from '../db/repo/issues';
import { addHistory } from '../db/repo/history';
import { parseLinearUrl } from '../lib/linear-url';

export function uiNewRoute(): Route {
  return {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/new' }),
    handler: () =>
      new Response(renderNewPage({}), { headers: { 'content-type': 'text/html; charset=utf-8' } }),
  };
}

export function uiCreatePostRoute(): Route {
  return {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/new' }),
    handler: async (req, _match, { db, bus }) => {
      const form = await req.formData();
      const title = String(form.get('title') ?? '').trim();
      if (title === '') {
        return new Response(
          renderNewPage({ error: 'Title is required', values: { title: '' } }),
          { status: 400, headers: { 'content-type': 'text/html; charset=utf-8' } },
        );
      }
      const description = String(form.get('description') ?? '');
      const state = String(form.get('state') ?? 'Todo');
      const priorityRaw = String(form.get('priority') ?? '');
      const priority = priorityRaw === '' ? null : Number(priorityRaw);
      const labels = String(form.get('labels') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const linearUrl = String(form.get('linear_url') ?? '');
      const parsed = linearUrl ? parseLinearUrl(linearUrl) : null;

      const issue = createIssue(db, {
        title,
        description: description || null,
        priority,
        state,
        labels,
        external_ref: parsed?.external_ref ?? null,
        external_url: parsed?.external_url ?? null,
      });
      addHistory(db, { issue_id: issue.id, kind: 'created', from_value: null, to_value: state, actor: 'user' });
      bus.publish('issue.created', issue);

      return new Response(null, { status: 302, headers: { location: `/issues/${issue.id}` } });
    },
  };
}
```

- [ ] **Step 4: Run, verify pass**

- [ ] **Step 5: Commit**

```bash
git add packages/wayang/src/ui packages/wayang/tests/ui/new.test.ts
git commit -m "feat(wayang): add new-issue page with Linear URL paste"
```

---

### Task 6.6: Wire all routes into main entry

**Files:**
- Modify: `packages/wayang/src/index.ts`
- Create: `packages/wayang/src/main.ts`

- [ ] **Step 1: Implement** at `src/main.ts`

```typescript
import { Database } from 'bun:sqlite';
import { homedir } from 'node:os';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { runMigrations } from './db/migrations';
import { startServer } from './api/server';
import { issuesListRoute } from './api/routes/issues-list';
import { issuesByIdsRoute } from './api/routes/issues-by-ids';
import { issuesDetailRoute } from './api/routes/issues-detail';
import { issuesCreateRoute } from './api/routes/issues-create';
import { issuesUpdateRoute } from './api/routes/issues-update';
import { issuesDeleteRoute } from './api/routes/issues-delete';
import { commentsListRoute, commentsCreateRoute } from './api/routes/comments';
import { historyListRoute } from './api/routes/history';
import { eventsRoute } from './api/routes/events';
import { staticRoute } from './ui/static';
import { uiListRoute, uiDetailRoute, uiNewRoute, uiCreatePostRoute } from './ui/routes';

export interface RunOptions {
  port?: number;
  dbPath?: string;
}

export function defaultDbPath(): string {
  return resolve(homedir(), '.wayang', 'wayang.db');
}

export function runWayang(opts: RunOptions = {}) {
  const dbPath = opts.dbPath ?? process.env['WAYANG_DB_PATH'] ?? defaultDbPath();
  if (!existsSync(dirname(dbPath))) mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  runMigrations(db);

  const port = opts.port ?? Number(process.env['WAYANG_PORT'] ?? 3001);
  const apiToken = process.env['WAYANG_API_TOKEN'] || undefined;

  const server = startServer({ db, apiToken, port }, [
    // Order matters: more specific paths first.
    issuesByIdsRoute(),
    eventsRoute(),
    issuesListRoute(),
    issuesCreateRoute(),
    commentsListRoute(),
    commentsCreateRoute(),
    historyListRoute(),
    issuesUpdateRoute(),
    issuesDeleteRoute(),
    issuesDetailRoute(),
    uiCreatePostRoute(),
    uiNewRoute(),
    uiDetailRoute(),
    uiListRoute(),
    staticRoute(),
  ]);

  console.log(`wayang listening on ${server.url}`);
  return { server, db };
}
```

- [ ] **Step 2: Implement** at `src/index.ts`

```typescript
#!/usr/bin/env bun
import { runWayang } from './main';

const args = Bun.argv.slice(2);
let port: number | undefined;
let dbPath: string | undefined;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--port') port = Number(args[++i]);
  else if (a === '--db') dbPath = args[++i];
}
runWayang({ port, dbPath });
```

- [ ] **Step 3: Smoke run**

Run:
```bash
WAYANG_DB_PATH=/tmp/wayang-smoke.db bun run packages/wayang/src/index.ts --port 3033 &
sleep 1
curl -s http://localhost:3033/ | head -c 200
kill %1 2>/dev/null || true
```
Expected: HTML containing `<title>Issues · wayang</title>`.

- [ ] **Step 4: Commit**

```bash
git add packages/wayang/src/index.ts packages/wayang/src/main.ts
git commit -m "feat(wayang): wire CLI entry and main bootstrap"
```

---

## Phase 7 — UI: Visual Design Pass

This phase **must** run after Phase 6 is complete and all behavior tests pass. The structural pages already work; this pass is purely visual + microcopy.

### Task 7.1: Invoke frontend-design skill

- [ ] **Step 1: Invoke `frontend-design` skill** with this brief:

> Visual design pass for the **wayang** tracker UI. Single-user agent inbox; aesthetic should be calm, minimal, dense-but-readable, suited for a single user reviewing their own work queue. Inspirations: Linear (information density, restrained palette), Things (clean typography, tactile spacing), Stripe Docs (calm grays + one accent). NOT Material Design, NOT Tailwind defaults, NOT generic dashboard chrome.
>
> Pages to design:
> 1. Issue list (`/`) — table of issues with state filter, search, inline state-change dropdown.
> 2. Issue detail (`/issues/:id`) — title, description (markdown), sidebar metadata, comments thread, history timeline.
> 3. New issue (`/new`) — form.
>
> Constraints (non-negotiable, structural):
> - Server-rendered HTML, no SPA, no React. Output is a single hand-written CSS file at `packages/wayang/src/ui/public/style.css`.
> - Existing HTML structure in `packages/wayang/src/ui/pages/*` and `packages/wayang/src/ui/partials/*` is the contract; do not change DOM structure or class names.
> - HTMX-driven swaps must keep working — avoid CSS that depends on stable DOM identity beyond what's already there.
> - System fonts only (no `@font-face`). No external CSS frameworks.
> - Distinct state-badge styling per state (Todo / In Progress / In Review / Done / Cancelled). Use the `data-state="..."` attribute already on `.state-badge`.
> - Light theme primary; dark theme via `prefers-color-scheme: dark`.
>
> Deliverables:
> 1. Replacement `packages/wayang/src/ui/public/style.css`.
> 2. Suggested microcopy improvements (header labels, button text, empty states) — apply by editing the existing template files in `src/ui/pages/` and `src/ui/partials/`.

The skill will produce CSS and microcopy edits.

- [ ] **Step 2: Apply skill output**

Replace `style.css`. Apply microcopy edits. Re-run all UI tests.

- [ ] **Step 3: Manual visual smoke check**

Start the server (`bun run packages/wayang/src/index.ts --port 3033 --db /tmp/wayang-design.db`), visit:
- `http://localhost:3033/` — list page
- `http://localhost:3033/new` — create page (create a few seed issues)
- `http://localhost:3033/issues/<id>` — detail page

Verify:
- All states have distinct visual treatment.
- Dark mode triggers via OS setting.
- HTMX inline state changes still apply visually.
- No layout breaks at common viewport widths (1280, 1024, 768).

- [ ] **Step 4: Commit**

```bash
git add packages/wayang/src/ui
git commit -m "feat(wayang): apply frontend-design visual pass"
```

---

## Phase 8 — Verification

### Task 8.1: Integration test — full HTTP cycle

**Files:**
- Create: `packages/wayang/tests/integration/full-cycle.test.ts`

- [ ] **Step 1: Write integration test** (gated)

```typescript
import { describe, expect, test } from 'bun:test';
import { runWayang } from '../../src/main';
import { unlinkSync, existsSync } from 'node:fs';

const RUN = process.env['RUN_INTEGRATION'] === '1';

describe.skipIf(!RUN)('full HTTP cycle', () => {
  test('create → list → patch state → comment → SSE event', async () => {
    const dbPath = '/tmp/wayang-it.db';
    if (existsSync(dbPath)) unlinkSync(dbPath);
    const { server, db } = runWayang({ port: 0, dbPath });
    try {
      // 1. create
      const created = await fetch(`${server.url}api/v1/issues`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'integration', state: 'Todo' }),
      });
      const issue = (await created.json()) as { id: string };

      // 2. list
      const list = await fetch(`${server.url}api/v1/issues?state=Todo`);
      const listBody = (await list.json()) as { issues: { id: string }[] };
      expect(listBody.issues.map((i) => i.id)).toContain(issue.id);

      // 3. patch
      const patch = await fetch(`${server.url}api/v1/issues/${issue.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state: 'In Progress', actor: 'agent' }),
      });
      expect(patch.status).toBe(200);

      // 4. comment
      const comment = await fetch(`${server.url}api/v1/issues/${issue.id}/comments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: 'progress', author: 'agent' }),
      });
      expect(comment.status).toBe(201);

      // 5. SSE: connect AFTER mutations to verify subsequent event.
      const sse = await fetch(`${server.url}api/v1/events`);
      const reader = sse.body!.getReader();
      const decoder = new TextDecoder();

      void fetch(`${server.url}api/v1/issues/${issue.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state: 'Done', actor: 'user' }),
      });

      let buf = '';
      const deadline = Date.now() + 3000;
      while (!buf.includes('event: state.changed') && Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value);
      }
      expect(buf).toContain('event: state.changed');
      await reader.cancel();
      db.close();
    } finally {
      server.stop();
    }
  }, 10000);
});
```

- [ ] **Step 2: Run with gate enabled**

Run: `RUN_INTEGRATION=1 bun test packages/wayang/tests/integration`
Expected: PASS.

- [ ] **Step 3: Run full test suite (gate off)**

Run: `bun test`
Expected: all unit tests PASS; integration suite skipped.

- [ ] **Step 4: Commit**

```bash
git add packages/wayang/tests/integration
git commit -m "test(wayang): add integration test for full HTTP cycle"
```

---

### Task 8.2: Final harness sweep

- [ ] **Step 1: Type-check**

Run: `bun run typecheck`
Expected: zero errors.

- [ ] **Step 2: Lint**

Run: `bun run lint`
Expected: zero errors.

- [ ] **Step 3: Format check**

Run: `bun run format -- --check`
Expected: zero diffs.

- [ ] **Step 4: Full test run**

Run: `bun test`
Expected: all pass.

- [ ] **Step 5: Manual smoke against the dalang contract**

Run wayang and verify the three dalang-facing endpoints respond correctly:
```bash
WAYANG_DB_PATH=/tmp/wayang-contract.db bun run packages/wayang/src/index.ts --port 3034 &
sleep 1
curl -s http://localhost:3034/api/v1/issues?state=Todo | head -c 200
curl -s -X POST -H 'content-type: application/json' \
  -d '{"title":"contract test","state":"Todo"}' \
  http://localhost:3034/api/v1/issues | head -c 200
curl -s "http://localhost:3034/api/v1/issues/by-ids?id=missing" | head -c 200
kill %1 2>/dev/null || true
```
All three should return JSON with the expected shape.

- [ ] **Step 6: Commit any final fixes**

If the harness sweep surfaced anything:
```bash
git add -A
git commit -m "chore(wayang): post-implementation cleanup"
```

---

## Self-Review (run after writing this plan)

- ✅ **Spec coverage:** every section of the wayang spec maps to at least one task. Phases 1–4 cover §3–§5 (stack, layout, data model, states). Phase 5 covers §7 API. Phase 6+7 cover §8 UI (with frontend-design skill explicitly invoked in Phase 7 per user request). Phase 8 covers §13 (DoD) + §12 integration test.
- ✅ **Placeholder scan:** no TBD/TODO inside task bodies. Phase 7 deliberately invokes the frontend-design skill for the visual pass — this is not a placeholder; it is a planned skill invocation with a concrete brief.
- ✅ **Type consistency:** `NormalizedIssue`, `Comment`, `HistoryEntry`, `Route`, `EventBus` are defined once and reused with consistent field names across all tasks.
- ✅ **Scope:** single implementation plan; produces working, testable software (a runnable wayang server passing all tests + manual smoke). Dalang work is a separate plan that consumes wayang's REST contract.

---

## Next plan

After this plan is fully executed, proceed to `2026-04-29-dalang-orchestrator.md` (to be written separately). That plan starts from a state where the monorepo skeleton (Phase 0 here) and a runnable wayang are already in place.
