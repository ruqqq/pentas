import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../../src/db/migrations";

describe("runMigrations", () => {
  test("creates all tables idempotently", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    runMigrations(db); // idempotent

    const tables = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all()
      .map((r) => r.name);

    expect(tables).toContain("issues");
    expect(tables).toContain("projects");
    expect(tables).toContain("issue_labels");
    expect(tables).toContain("issue_blockers");
    expect(tables).toContain("comments");
    expect(tables).toContain("history");
    expect(tables).toContain("seq");
  });

  test("initializes issue_identifier sequence to 0", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    const row = db
      .query<{ value: number }, []>("SELECT value FROM seq WHERE name='issue_identifier'")
      .get();
    expect(row?.value).toBe(0);
  });

  test("backfills existing single-project databases into default project", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE issues (
        id TEXT PRIMARY KEY,
        identifier TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        description TEXT,
        priority INTEGER,
        state TEXT NOT NULL,
        parent_issue_id TEXT REFERENCES issues(id) ON DELETE SET NULL,
        external_ref TEXT,
        external_url TEXT,
        branch_name TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE seq (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
      INSERT INTO issues
        (id, identifier, title, description, priority, state, parent_issue_id,
         external_ref, external_url, branch_name, created_at, updated_at)
      VALUES
        ('i1', 'PENTAS-1', 'old', NULL, NULL, 'Todo', NULL, NULL, NULL, NULL,
         '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    `);

    runMigrations(db);

    const project = db.query<{ slug: string }, []>("SELECT slug FROM projects").get();
    const issue = db.query<{ project_id: string }, []>("SELECT project_id FROM issues").get();
    expect(project?.slug).toBe("default");
    expect(issue?.project_id).toBe("default");
  });
});
