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

  test("backfills missing QA statuses into existing project status rows", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE projects (
        id          TEXT PRIMARY KEY,
        slug        TEXT NOT NULL UNIQUE,
        name        TEXT NOT NULL,
        description TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE TABLE project_statuses (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name       TEXT NOT NULL,
        position   INTEGER NOT NULL,
        kind       TEXT NOT NULL CHECK (kind IN ('dispatchable','waiting','terminal')),
        PRIMARY KEY (project_id, name)
      );
      INSERT INTO projects
        (id, slug, name, description, created_at, updated_at)
      VALUES
        ('default', 'default', 'Default', NULL,
         '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z');
      INSERT INTO project_statuses (project_id, name, position, kind)
      VALUES
        ('default', 'Todo', 0, 'dispatchable'),
        ('default', 'Plan', 1, 'dispatchable'),
        ('default', 'Review Plan', 2, 'dispatchable'),
        ('default', 'Ready for Dev', 3, 'dispatchable'),
        ('default', 'In Dev', 4, 'dispatchable'),
        ('default', 'Ready for Review', 5, 'dispatchable'),
        ('default', 'Waiting PR Checks', 6, 'waiting'),
        ('default', 'Ready for Human Review', 7, 'waiting'),
        ('default', 'Done', 8, 'terminal'),
        ('default', 'Cancelled', 9, 'terminal');
    `);

    runMigrations(db);

    const statuses = db
      .query<{ name: string; position: number; kind: string }, []>(
        "SELECT name, position, kind FROM project_statuses WHERE project_id = 'default' ORDER BY position",
      )
      .all();
    expect(statuses.map((s) => s.name)).toEqual([
      "Todo",
      "Plan",
      "Review Plan",
      "Ready for Dev",
      "In Dev",
      "Ready for Review",
      "Waiting PR Checks",
      "Ready for Human Review",
      "Done",
      "Cancelled",
      "Ready for QA",
      "In QA",
    ]);
    expect(statuses.at(-2)).toEqual({
      name: "Ready for QA",
      position: 10,
      kind: "dispatchable",
    });
    expect(statuses.at(-1)).toEqual({
      name: "In QA",
      position: 11,
      kind: "dispatchable",
    });
  });
});
