import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../../../src/db/migrations";
import { createIssue } from "../../../src/db/repo/issues";
import { createProject } from "../../../src/db/repo/projects";
import {
  StatusExistsError,
  StatusInUseError,
  StatusNotFoundError,
  StatusReorderMismatchError,
  addStatus,
  deleteStatus,
  firstDispatchableStatus,
  isValidStateForProject,
  listStatuses,
  renameStatus,
  reorderStatuses,
  seedDefaultStatuses,
  updateStatusKind,
} from "../../../src/db/repo/project-statuses";

function freshDb(): Database {
  const db = new Database(":memory:");
  runMigrations(db);
  return db;
}

describe("project-statuses repo", () => {
  test("default project is seeded with the legacy 10 statuses on migration", () => {
    const db = freshDb();
    const statuses = listStatuses(db, "default");
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
    ]);
    expect(statuses[0]?.kind).toBe("dispatchable");
    expect(statuses[6]?.kind).toBe("waiting");
    expect(statuses[8]?.kind).toBe("terminal");
  });

  test("createProject seeds the default statuses for the new project", () => {
    const db = freshDb();
    const p = createProject(db, { slug: "alpha", name: "Alpha" });
    expect(listStatuses(db, p.id)).toHaveLength(10);
  });

  test("seedDefaultStatuses is idempotent", () => {
    const db = freshDb();
    seedDefaultStatuses(db, "default");
    expect(listStatuses(db, "default")).toHaveLength(10);
  });

  test("addStatus appends with auto-position; rejects duplicates", () => {
    const db = freshDb();
    const p = createProject(db, { slug: "alpha", name: "Alpha" });
    const s = addStatus(db, p.id, { name: "Custom", kind: "waiting" });
    expect(s.position).toBe(10);
    expect(s.kind).toBe("waiting");
    expect(() => addStatus(db, p.id, { name: "Custom", kind: "waiting" })).toThrow(
      StatusExistsError,
    );
  });

  test("renameStatus cascades to issues.state in a transaction", () => {
    const db = freshDb();
    const issue = createIssue(db, { title: "x", state: "Todo" });
    renameStatus(db, "default", "Todo", "Backlog");
    const after = db
      .query<{ state: string }, [string]>("SELECT state FROM issues WHERE id = ?")
      .get(issue.id);
    expect(after?.state).toBe("Backlog");
    expect(listStatuses(db, "default").find((s) => s.name === "Backlog")?.kind).toBe(
      "dispatchable",
    );
  });

  test("renameStatus rejects unknown source and existing target", () => {
    const db = freshDb();
    expect(() => renameStatus(db, "default", "Nope", "Other")).toThrow(StatusNotFoundError);
    expect(() => renameStatus(db, "default", "Todo", "Plan")).toThrow(StatusExistsError);
  });

  test("updateStatusKind updates kind", () => {
    const db = freshDb();
    const s = updateStatusKind(db, "default", "Plan", "waiting");
    expect(s.kind).toBe("waiting");
  });

  test("reorderStatuses rewrites positions", () => {
    const db = freshDb();
    const original = listStatuses(db, "default").map((s) => s.name);
    const reversed = [...original].reverse();
    const after = reorderStatuses(db, "default", reversed);
    expect(after.map((s) => s.name)).toEqual(reversed);
    expect(after[0]?.position).toBe(0);
    expect(after[9]?.position).toBe(9);
  });

  test("reorderStatuses rejects mismatched lists", () => {
    const db = freshDb();
    expect(() => reorderStatuses(db, "default", ["Todo"])).toThrow(StatusReorderMismatchError);
    const dupes = listStatuses(db, "default").map((s) => s.name);
    dupes[0] = dupes[1]!;
    expect(() => reorderStatuses(db, "default", dupes)).toThrow(StatusReorderMismatchError);
  });

  test("deleteStatus blocks when issues reference it", () => {
    const db = freshDb();
    createIssue(db, { title: "x", state: "Todo" });
    expect(() => deleteStatus(db, "default", "Todo")).toThrow(StatusInUseError);
  });

  test("deleteStatus succeeds when unused", () => {
    const db = freshDb();
    deleteStatus(db, "default", "Plan");
    expect(listStatuses(db, "default").find((s) => s.name === "Plan")).toBeUndefined();
  });

  test("isValidStateForProject and firstDispatchableStatus", () => {
    const db = freshDb();
    expect(isValidStateForProject(db, "default", "Todo")).toBe(true);
    expect(isValidStateForProject(db, "default", "Nope")).toBe(false);
    expect(firstDispatchableStatus(db, "default")?.name).toBe("Todo");
  });
});
