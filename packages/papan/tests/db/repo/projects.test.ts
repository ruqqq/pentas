import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../../../src/db/migrations";
import { createIssue } from "../../../src/db/repo/issues";
import {
  createProject,
  getProjectBySlug,
  listProjectSummaries,
} from "../../../src/db/repo/projects";

function freshDb(): Database {
  const db = new Database(":memory:");
  runMigrations(db);
  return db;
}

describe("projects repo", () => {
  test("creates and fetches projects by slug", () => {
    const db = freshDb();
    const project = createProject(db, { slug: "alpha", name: "Alpha" });
    expect(project.slug).toBe("alpha");
    expect(project.name).toBe("Alpha");
    expect(getProjectBySlug(db, "alpha")?.id).toBe(project.id);
  });

  test("summaries include issue counts per project", () => {
    const db = freshDb();
    const alpha = createProject(db, { slug: "alpha", name: "Alpha" });
    createIssue(db, { project_id: alpha.id, title: "a", state: "Todo" });
    createIssue(db, { title: "d", state: "Done" });

    const summaries = listProjectSummaries(db);
    const alphaSummary = summaries.find((p) => p.slug === "alpha");
    const defaultSummary = summaries.find((p) => p.slug === "default");
    expect(alphaSummary?.issue_count).toBe(1);
    expect(alphaSummary?.active_issue_count).toBe(1);
    expect(defaultSummary?.issue_count).toBe(1);
    expect(defaultSummary?.active_issue_count).toBe(0);
  });
});
