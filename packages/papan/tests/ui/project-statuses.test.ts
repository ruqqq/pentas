import { beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../../src/db/migrations";
import { startServer } from "../../src/api/server";
import { createIssue } from "../../src/db/repo/issues";
import {
  uiProjectStatusesAddRoute,
  uiProjectStatusesDeleteRoute,
  uiProjectStatusesKindRoute,
  uiProjectStatusesMoveRoute,
  uiProjectStatusesRenameRoute,
  uiProjectStatusesRoute,
} from "../../src/ui/routes";
import { listStatuses } from "../../src/db/repo/project-statuses";

let db: Database;

beforeEach(() => {
  db = new Database(":memory:");
  runMigrations(db);
});

function start() {
  return startServer({ db, apiToken: undefined, port: 0 }, [
    uiProjectStatusesAddRoute(),
    uiProjectStatusesRenameRoute(),
    uiProjectStatusesKindRoute(),
    uiProjectStatusesMoveRoute(),
    uiProjectStatusesDeleteRoute(),
    uiProjectStatusesRoute(),
  ]);
}

describe("project-statuses UI", () => {
  test("GET renders the page with all default statuses", async () => {
    const server = start();
    const res = await fetch(`${server.url}projects/default/statuses`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Default · Statuses");
    expect(body).toContain("Todo");
    expect(body).toContain("Done");
    server.stop();
  });

  test("POST add appends a status and returns refreshed table partial", async () => {
    const server = start();
    const res = await fetch(`${server.url}ui/projects/default/statuses`, {
      method: "POST",
      body: new URLSearchParams({ name: "Blocked Custom", kind: "waiting" }),
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('id="statuses-table"');
    expect(body).toContain("Blocked Custom");
    server.stop();
  });

  test("POST rename cascades to issues.state and returns table", async () => {
    const issue = createIssue(db, { title: "x", state: "Todo" });
    const server = start();
    const res = await fetch(`${server.url}ui/projects/default/statuses/Todo/rename`, {
      method: "POST",
      body: new URLSearchParams({ name: "Backlog" }),
    });
    expect(res.status).toBe(200);
    const after = db
      .query<{ state: string }, [string]>("SELECT state FROM issues WHERE id = ?")
      .get(issue.id);
    expect(after?.state).toBe("Backlog");
    server.stop();
  });

  test("POST kind updates kind", async () => {
    const server = start();
    const res = await fetch(`${server.url}ui/projects/default/statuses/Plan/kind`, {
      method: "POST",
      body: new URLSearchParams({ kind: "waiting" }),
    });
    expect(res.status).toBe(200);
    expect(listStatuses(db, "default").find((s) => s.name === "Plan")?.kind).toBe("waiting");
    server.stop();
  });

  test("POST move swaps positions", async () => {
    const server = start();
    const res = await fetch(`${server.url}ui/projects/default/statuses/Plan/move?dir=up`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const names = listStatuses(db, "default").map((s) => s.name);
    expect(names[0]).toBe("Plan");
    expect(names[1]).toBe("Todo");
    server.stop();
  });

  test("DELETE removes when not in use; rejects when in use", async () => {
    createIssue(db, { title: "x", state: "Todo" });
    const server = start();
    const blocked = await fetch(`${server.url}ui/projects/default/statuses/Todo`, {
      method: "DELETE",
    });
    expect(blocked.status).toBe(409);
    const ok = await fetch(`${server.url}ui/projects/default/statuses/Plan`, {
      method: "DELETE",
    });
    expect(ok.status).toBe(200);
    server.stop();
  });
});
