import type { Database } from "bun:sqlite";
import { formatIdentifier } from "../lib/ids";

export function allocateIdentifier(db: Database): string {
  const row = db
    .query<{ value: number }, []>(
      "UPDATE seq SET value = value + 1 WHERE name = 'issue_identifier' RETURNING value",
    )
    .get();
  if (!row) throw new Error("issue_identifier sequence missing");
  return formatIdentifier(row.value);
}
