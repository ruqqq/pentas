import type { Database } from "bun:sqlite";
import { DEFAULT_STATUSES, type ProjectStatus, type StatusKind } from "../../domain/status";

export class StatusExistsError extends Error {
  constructor(name: string) {
    super(`status_exists: ${name}`);
    this.name = "StatusExistsError";
  }
}
export class StatusNotFoundError extends Error {
  constructor(name: string) {
    super(`status_not_found: ${name}`);
    this.name = "StatusNotFoundError";
  }
}
export class StatusInUseError extends Error {
  constructor(name: string) {
    super(`status_in_use: ${name}`);
    this.name = "StatusInUseError";
  }
}
export class StatusReorderMismatchError extends Error {
  constructor(message = "reorder must list every existing status exactly once") {
    super(message);
    this.name = "StatusReorderMismatchError";
  }
}

interface Row {
  name: string;
  position: number;
  kind: StatusKind;
}

export function listStatuses(db: Database, projectId: string): ProjectStatus[] {
  return db
    .query<Row, [string]>(
      "SELECT name, position, kind FROM project_statuses WHERE project_id = ? ORDER BY position ASC",
    )
    .all(projectId);
}

export function getStatus(db: Database, projectId: string, name: string): ProjectStatus | null {
  return db
    .query<Row, [string, string]>(
      "SELECT name, position, kind FROM project_statuses WHERE project_id = ? AND name = ?",
    )
    .get(projectId, name);
}

function nextPosition(db: Database, projectId: string): number {
  const r = db
    .query<{ max: number | null }, [string]>(
      "SELECT MAX(position) AS max FROM project_statuses WHERE project_id = ?",
    )
    .get(projectId);
  return (r?.max ?? -1) + 1;
}

export interface AddStatusInput {
  name: string;
  kind: StatusKind;
  position?: number;
}

function isUniqueOrPkError(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed|PRIMARY KEY/i.test(err.message);
}

export function addStatus(db: Database, projectId: string, input: AddStatusInput): ProjectStatus {
  let pos = 0;
  const tx = db.transaction(() => {
    pos = input.position ?? nextPosition(db, projectId);
    db.query(
      "INSERT INTO project_statuses (project_id, name, position, kind) VALUES (?, ?, ?, ?)",
    ).run(projectId, input.name, pos, input.kind);
  });
  try {
    tx();
  } catch (err) {
    if (isUniqueOrPkError(err)) throw new StatusExistsError(input.name);
    throw err;
  }
  return { name: input.name, position: pos, kind: input.kind };
}

export function renameStatus(
  db: Database,
  projectId: string,
  oldName: string,
  newName: string,
): ProjectStatus {
  if (oldName === newName) {
    const cur = getStatus(db, projectId, oldName);
    if (!cur) throw new StatusNotFoundError(oldName);
    return cur;
  }
  let result: ProjectStatus | null = null;
  const tx = db.transaction(() => {
    const existing = getStatus(db, projectId, oldName);
    if (!existing) throw new StatusNotFoundError(oldName);
    db.query("UPDATE project_statuses SET name = ? WHERE project_id = ? AND name = ?").run(
      newName,
      projectId,
      oldName,
    );
    db.query("UPDATE issues SET state = ? WHERE project_id = ? AND state = ?").run(
      newName,
      projectId,
      oldName,
    );
    result = { ...existing, name: newName };
  });
  try {
    tx();
  } catch (err) {
    if (isUniqueOrPkError(err)) throw new StatusExistsError(newName);
    throw err;
  }
  return result!;
}

export function updateStatusKind(
  db: Database,
  projectId: string,
  name: string,
  kind: StatusKind,
): ProjectStatus {
  const existing = getStatus(db, projectId, name);
  if (!existing) throw new StatusNotFoundError(name);
  db.query("UPDATE project_statuses SET kind = ? WHERE project_id = ? AND name = ?").run(
    kind,
    projectId,
    name,
  );
  return { ...existing, kind };
}

export function reorderStatuses(db: Database, projectId: string, names: string[]): ProjectStatus[] {
  const current = listStatuses(db, projectId);
  if (current.length !== names.length) throw new StatusReorderMismatchError();
  const currentSet = new Set(current.map((s) => s.name));
  const newSet = new Set(names);
  if (newSet.size !== names.length) throw new StatusReorderMismatchError();
  for (const n of names) if (!currentSet.has(n)) throw new StatusReorderMismatchError();
  const tx = db.transaction(() => {
    names.forEach((n, i) => {
      db.query("UPDATE project_statuses SET position = ? WHERE project_id = ? AND name = ?").run(
        i,
        projectId,
        n,
      );
    });
  });
  tx();
  return listStatuses(db, projectId);
}

export function deleteStatus(db: Database, projectId: string, name: string): void {
  const existing = getStatus(db, projectId, name);
  if (!existing) throw new StatusNotFoundError(name);
  const inUse = db
    .query<{ n: number }, [string, string]>(
      "SELECT COUNT(*) AS n FROM issues WHERE project_id = ? AND state = ?",
    )
    .get(projectId, name);
  if ((inUse?.n ?? 0) > 0) throw new StatusInUseError(name);
  db.query("DELETE FROM project_statuses WHERE project_id = ? AND name = ?").run(projectId, name);
}

export function seedDefaultStatuses(db: Database, projectId: string): void {
  const existing = listStatuses(db, projectId);
  if (existing.length > 0) return;
  const tx = db.transaction(() => {
    for (const s of DEFAULT_STATUSES) {
      db.query(
        "INSERT INTO project_statuses (project_id, name, position, kind) VALUES (?, ?, ?, ?)",
      ).run(projectId, s.name, s.position, s.kind);
    }
  });
  tx();
}

export function isValidStateForProject(db: Database, projectId: string, state: string): boolean {
  return getStatus(db, projectId, state) !== null;
}

export function firstDispatchableStatus(db: Database, projectId: string): ProjectStatus | null {
  return listStatuses(db, projectId).find((s) => s.kind === "dispatchable") ?? null;
}

export function firstStatus(db: Database, projectId: string): ProjectStatus | null {
  return listStatuses(db, projectId)[0] ?? null;
}
