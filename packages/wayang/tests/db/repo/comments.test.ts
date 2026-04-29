import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../../../src/db/migrations";
import { createIssue } from "../../../src/db/repo/issues";
import { addComment, listComments } from "../../../src/db/repo/comments";

function freshDb(): Database {
  const db = new Database(":memory:");
  runMigrations(db);
  return db;
}

describe("comments repo", () => {
  test("addComment + listComments roundtrip", () => {
    const db = freshDb();
    const issue = createIssue(db, { title: "t", state: "Todo" });
    const c1 = addComment(db, issue.id, { body: "first", author: "user" });
    const c2 = addComment(db, issue.id, { body: "second", author: "agent" });
    const list = listComments(db, issue.id);
    expect(list.map((c) => c.id)).toEqual([c1.id, c2.id]);
    expect(list[0]!.author).toBe("user");
    expect(list[1]!.author).toBe("agent");
    expect(list[0]!.body_html).toContain("first");
  });
});
