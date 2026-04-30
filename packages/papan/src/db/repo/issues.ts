import type { Database } from "bun:sqlite";
import { ulid } from "../../lib/ids";
import { allocateIdentifier } from "../seq";
import type { NormalizedIssue } from "../../domain/issue";

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
    .query<{ label: string }, [string]>("SELECT label FROM issue_labels WHERE issue_id = ?")
    .all(issueId)
    .map((r) => r.label);
}

function hydrateBlockers(db: Database, issueId: string): NormalizedIssue["blocked_by"] {
  return db
    .query<{ id: string; identifier: string; state: string }, [string]>(
      `SELECT i.id,
              COALESCE(NULLIF(i.external_ref, ''), i.identifier) AS identifier,
              i.state
         FROM issue_blockers b
         JOIN issues i ON i.id = b.blocker_id
        WHERE b.issue_id = ?
        ORDER BY identifier`,
    )
    .all(issueId)
    .map((r) => ({ id: r.id, identifier: r.identifier, state: r.state }));
}

function rowToNormalized(db: Database, row: IssueRow): NormalizedIssue {
  // Public identifier prefers the upstream tracker ref (e.g. "ENG-123" from Linear).
  // The auto-allocated papan sequence ("PENTAS-N") is demoted to internal_ref.
  const publicIdentifier =
    row.external_ref && row.external_ref.trim() !== "" ? row.external_ref : row.identifier;
  return {
    id: row.id,
    identifier: publicIdentifier,
    title: row.title,
    description: row.description,
    priority: row.priority,
    state: row.state,
    branch_name: row.branch_name,
    url: row.external_url,
    external_ref: row.external_ref,
    internal_ref: row.identifier,
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
        db.query("INSERT INTO issue_labels (issue_id, label) VALUES (?, ?)").run(id, lbl);
      }
    }

    if (input.blocker_ids?.length) {
      for (const blockerId of input.blocker_ids) {
        if (blockerId === id) continue;
        db.query("INSERT OR IGNORE INTO issue_blockers (issue_id, blocker_id) VALUES (?, ?)").run(
          id,
          blockerId,
        );
      }
    }
  });
  tx();

  const row = db.query<IssueRow, [string]>("SELECT * FROM issues WHERE id = ?").get(id);
  if (!row) throw new Error("createIssue: row vanished");
  return rowToNormalized(db, row);
}

export function getIssueById(db: Database, id: string): NormalizedIssue | null {
  const row = db.query<IssueRow, [string]>("SELECT * FROM issues WHERE id = ?").get(id);
  return row ? rowToNormalized(db, row) : null;
}

function encodeCursor(updated_at: string, id: string): string {
  return Buffer.from(`${updated_at}|${id}`).toString("base64url");
}
function decodeCursor(c: string): { updated_at: string; id: string } | null {
  try {
    const [u, i] = Buffer.from(c, "base64url").toString("utf8").split("|");
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

  const placeholders = states.map(() => "?").join(",");
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
  const next =
    hasMore && slice.length
      ? encodeCursor(slice[slice.length - 1]!.updated_at, slice[slice.length - 1]!.id)
      : null;

  return { issues: slice.map((r) => rowToNormalized(db, r)), next_cursor: next };
}

export function getIssuesByIds(db: Database, ids: string[]): NormalizedIssue[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
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
  const existing = db.query<IssueRow, [string]>("SELECT * FROM issues WHERE id = ?").get(id);
  if (!existing) return null;

  const now = nowIso();
  const tx = db.transaction(() => {
    const fields: string[] = ["updated_at = ?"];
    const params: (string | number | null)[] = [now];
    const setIfDefined = <K extends keyof CreateIssueInput>(key: K, col: string) => {
      if (input[key] === undefined) return;
      fields.push(`${col} = ?`);
      params.push((input[key] ?? null) as string | number | null);
    };
    setIfDefined("title", "title");
    setIfDefined("description", "description");
    setIfDefined("priority", "priority");
    setIfDefined("state", "state");
    setIfDefined("parent_issue_id", "parent_issue_id");
    setIfDefined("external_ref", "external_ref");
    setIfDefined("external_url", "external_url");
    setIfDefined("branch_name", "branch_name");

    params.push(id);
    db.query(`UPDATE issues SET ${fields.join(", ")} WHERE id = ?`).run(...params);

    if (input.labels !== undefined) {
      db.query("DELETE FROM issue_labels WHERE issue_id = ?").run(id);
      const seen = new Set<string>();
      for (const raw of input.labels ?? []) {
        const lbl = raw.toLowerCase().trim();
        if (!lbl || seen.has(lbl)) continue;
        seen.add(lbl);
        db.query("INSERT INTO issue_labels (issue_id, label) VALUES (?, ?)").run(id, lbl);
      }
    }

    if (input.blocker_ids !== undefined) {
      db.query("DELETE FROM issue_blockers WHERE issue_id = ?").run(id);
      for (const blockerId of input.blocker_ids ?? []) {
        if (blockerId === id) continue;
        db.query("INSERT OR IGNORE INTO issue_blockers (issue_id, blocker_id) VALUES (?, ?)").run(
          id,
          blockerId,
        );
      }
    }
  });
  tx();

  const row = db.query<IssueRow, [string]>("SELECT * FROM issues WHERE id = ?").get(id);
  return row ? rowToNormalized(db, row) : null;
}

export function deleteIssue(db: Database, id: string): boolean {
  const result = db.query("DELETE FROM issues WHERE id = ?").run(id);
  return result.changes > 0;
}
