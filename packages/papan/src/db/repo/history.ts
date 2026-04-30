import type { Database } from "bun:sqlite";
import { ulid } from "../../lib/ids";
import type { HistoryEntry, HistoryKind } from "../../domain/history";

export interface AddHistoryInput {
  issue_id: string;
  kind: HistoryKind;
  from_value: string | null;
  to_value: string | null;
  actor: "user" | "agent";
}

interface HistoryRow {
  id: string;
  issue_id: string;
  kind: HistoryKind;
  from_value: string | null;
  to_value: string | null;
  actor: "user" | "agent";
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
    .query<HistoryRow, [string]>("SELECT * FROM history WHERE issue_id = ? ORDER BY at ASC, id ASC")
    .all(issueId);
}
