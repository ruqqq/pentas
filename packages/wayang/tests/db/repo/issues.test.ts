import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../../../src/db/migrations";
import {
  createIssue,
  getIssueById,
  getIssuesByStates,
  getIssuesByIds,
  updateIssue,
  deleteIssue,
} from "../../../src/db/repo/issues";

function freshDb(): Database {
  const db = new Database(":memory:");
  runMigrations(db);
  return db;
}

describe("issues repo", () => {
  test("createIssue assigns identifier and returns NormalizedIssue", () => {
    const db = freshDb();
    const issue = createIssue(db, { title: "first", state: "Todo" });
    expect(issue.identifier).toBe("JUARA-1");
    expect(issue.title).toBe("first");
    expect(issue.state).toBe("Todo");
    expect(issue.labels).toEqual([]);
    expect(issue.blocked_by).toEqual([]);
  });

  test("createIssue normalizes labels to lowercase", () => {
    const db = freshDb();
    const issue = createIssue(db, { title: "t", state: "Todo", labels: ["Bug", "P1", "bug"] });
    expect(issue.labels.sort()).toEqual(["bug", "p1"]);
  });

  test("createIssue persists blockers and hydrates them", () => {
    const db = freshDb();
    const a = createIssue(db, { title: "a", state: "Todo" });
    const b = createIssue(db, { title: "b", state: "Todo", blocker_ids: [a.id] });
    expect(b.blocked_by).toEqual([{ id: a.id, identifier: "JUARA-1", state: "Todo" }]);
  });

  test("getIssueById returns null for unknown id", () => {
    const db = freshDb();
    expect(getIssueById(db, "nope")).toBeNull();
  });

  test("getIssuesByStates filters and paginates", () => {
    const db = freshDb();
    createIssue(db, { title: "a", state: "Todo" });
    createIssue(db, { title: "b", state: "Done" });
    createIssue(db, { title: "c", state: "Todo" });
    const result = getIssuesByStates(db, ["Todo"], null, 50);
    expect(result.issues.length).toBe(2);
    expect(result.next_cursor).toBeNull();
  });

  test("getIssuesByIds returns matching subset", () => {
    const db = freshDb();
    const a = createIssue(db, { title: "a", state: "Todo" });
    const b = createIssue(db, { title: "b", state: "Todo" });
    const result = getIssuesByIds(db, [a.id, "unknown", b.id]);
    expect(result.length).toBe(2);
  });

  test("updateIssue patches and bumps updated_at", async () => {
    const db = freshDb();
    const a = createIssue(db, { title: "a", state: "Todo" });
    const before = a.updated_at;
    await new Promise((r) => setTimeout(r, 5));
    const updated = updateIssue(db, a.id, { state: "In Progress" });
    expect(updated?.state).toBe("In Progress");
    expect(updated?.updated_at).not.toBe(before);
  });

  test("deleteIssue removes the row and cascades", () => {
    const db = freshDb();
    const a = createIssue(db, { title: "a", state: "Todo", labels: ["x"] });
    deleteIssue(db, a.id);
    expect(getIssueById(db, a.id)).toBeNull();
    const labelCount = db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM issue_labels").get();
    expect(labelCount?.n).toBe(0);
  });
});
