import type { Database } from "bun:sqlite";
import schema from "./schema.sql" with { type: "text" };
import { seedDefaultStatuses } from "./repo/project-statuses";

function hasTable(db: Database, table: string): boolean {
  return (
    db
      .query<{ name: string }, [string]>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      )
      .get(table) !== null
  );
}

function hasColumn(db: Database, table: string, column: string): boolean {
  if (!hasTable(db, table)) return false;
  return (
    db
      .query<{ name: string }, [string, string]>(
        `SELECT name FROM pragma_table_info(?) WHERE name = ?`,
      )
      .get(table, column) !== null
  );
}

function createProjectsTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id          TEXT PRIMARY KEY,
      slug        TEXT NOT NULL UNIQUE,
      name        TEXT NOT NULL,
      description TEXT,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
  `);
  db.query(
    `INSERT OR IGNORE INTO projects
       (id, slug, name, description, created_at, updated_at)
     VALUES
       ('default', 'default', 'Default', NULL, ?, ?)`,
  ).run(new Date().toISOString(), new Date().toISOString());
}

export function runMigrations(db: Database): void {
  db.exec("PRAGMA foreign_keys = ON;");
  if (hasTable(db, "issues") && !hasColumn(db, "issues", "project_id")) {
    createProjectsTable(db);
    db.exec("ALTER TABLE issues ADD COLUMN project_id TEXT;");
    db.query("UPDATE issues SET project_id = ? WHERE project_id IS NULL").run("default");
  }
  db.exec(schema);
  db.exec(`
    CREATE INDEX IF NOT EXISTS issues_project_state_idx ON issues(project_id, state);
    CREATE INDEX IF NOT EXISTS issues_project_updated_at_idx ON issues(project_id, updated_at, id);
    CREATE UNIQUE INDEX IF NOT EXISTS issues_project_identifier_idx ON issues(project_id, identifier);
  `);
  // Backfill: ensure every existing project has the default status set so the system
  // remains usable on upgrade. Idempotent — seedDefaultStatuses no-ops when populated.
  const projects = db.query<{ id: string }, []>("SELECT id FROM projects").all();
  for (const p of projects) seedDefaultStatuses(db, p.id);
}
