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
});
