import type { Database } from "bun:sqlite";
import schema from "./schema.sql" with { type: "text" };

export function runMigrations(db: Database): void {
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
}
