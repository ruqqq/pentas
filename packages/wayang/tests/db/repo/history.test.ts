import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../../../src/db/migrations";
import { createIssue } from "../../../src/db/repo/issues";
import { addHistory, listHistory } from "../../../src/db/repo/history";

function freshDb(): Database {
  const db = new Database(":memory:");
  runMigrations(db);
  return db;
}

describe("history repo", () => {
  test("appends and lists in order", () => {
    const db = freshDb();
    const issue = createIssue(db, { title: "t", state: "Todo" });
    addHistory(db, {
      issue_id: issue.id,
      kind: "created",
      from_value: null,
      to_value: "Todo",
      actor: "user",
    });
    addHistory(db, {
      issue_id: issue.id,
      kind: "state_changed",
      from_value: "Todo",
      to_value: "In Progress",
      actor: "agent",
    });
    const list = listHistory(db, issue.id);
    expect(list.length).toBe(2);
    expect(list[0]!.kind).toBe("created");
    expect(list[1]!.kind).toBe("state_changed");
  });
});
