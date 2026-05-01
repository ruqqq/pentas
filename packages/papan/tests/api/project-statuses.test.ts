import { beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../../src/db/migrations";
import { startServer } from "../../src/api/server";
import {
  projectStatusesCreateRoute,
  projectStatusesDeleteRoute,
  projectStatusesListRoute,
  projectStatusesReorderRoute,
  projectStatusesUpdateRoute,
} from "../../src/api/routes/project-statuses";
import { createIssue } from "../../src/db/repo/issues";
import type { ProjectStatus } from "../../src/domain/status";

let db: Database;

beforeEach(() => {
  db = new Database(":memory:");
  runMigrations(db);
});

function start() {
  return startServer({ db, apiToken: undefined, port: 0 }, [
    projectStatusesReorderRoute(),
    projectStatusesUpdateRoute(),
    projectStatusesDeleteRoute(),
    projectStatusesCreateRoute(),
    projectStatusesListRoute(),
  ]);
}

describe("project-statuses routes", () => {
  test("GET lists seeded statuses", async () => {
    const server = start();
    const res = await fetch(`${server.url}api/v1/projects/default/statuses`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { statuses: ProjectStatus[] };
    expect(body.statuses.map((s) => s.name)).toContain("Todo");
    expect(body.statuses).toHaveLength(10);
    server.stop();
  });

  test("GET returns 404 for unknown project", async () => {
    const server = start();
    const res = await fetch(`${server.url}api/v1/projects/nope/statuses`);
    expect(res.status).toBe(404);
    server.stop();
  });

  test("POST adds a status; rejects duplicates with 409", async () => {
    const server = start();
    const ok = await fetch(`${server.url}api/v1/projects/default/statuses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Blocked", kind: "waiting" }),
    });
    expect(ok.status).toBe(201);
    const dup = await fetch(`${server.url}api/v1/projects/default/statuses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Blocked", kind: "waiting" }),
    });
    expect(dup.status).toBe(409);
    server.stop();
  });

  test("POST validates kind", async () => {
    const server = start();
    const res = await fetch(`${server.url}api/v1/projects/default/statuses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Custom", kind: "garbage" }),
    });
    expect(res.status).toBe(400);
    server.stop();
  });

  test("PATCH renames + cascades to issues.state", async () => {
    const issue = createIssue(db, { title: "x", state: "Todo" });
    const server = start();
    const res = await fetch(`${server.url}api/v1/projects/default/statuses/Todo`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Backlog" }),
    });
    expect(res.status).toBe(200);
    const after = db
      .query<{ state: string }, [string]>("SELECT state FROM issues WHERE id = ?")
      .get(issue.id);
    expect(after?.state).toBe("Backlog");
    server.stop();
  });

  test("PATCH changes kind", async () => {
    const server = start();
    const res = await fetch(`${server.url}api/v1/projects/default/statuses/Plan`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "waiting" }),
    });
    expect(res.status).toBe(200);
    const list = await fetch(`${server.url}api/v1/projects/default/statuses`);
    const body = (await list.json()) as { statuses: ProjectStatus[] };
    expect(body.statuses.find((s) => s.name === "Plan")?.kind).toBe("waiting");
    server.stop();
  });

  test("PATCH 409 when renaming to existing name", async () => {
    const server = start();
    const res = await fetch(`${server.url}api/v1/projects/default/statuses/Todo`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Plan" }),
    });
    expect(res.status).toBe(409);
    server.stop();
  });

  test("DELETE 409 when in use; 204 when not", async () => {
    createIssue(db, { title: "x", state: "Todo" });
    const server = start();
    const blocked = await fetch(`${server.url}api/v1/projects/default/statuses/Todo`, {
      method: "DELETE",
    });
    expect(blocked.status).toBe(409);
    const ok = await fetch(`${server.url}api/v1/projects/default/statuses/Plan`, {
      method: "DELETE",
    });
    expect(ok.status).toBe(204);
    server.stop();
  });

  test("POST reorder updates positions", async () => {
    const server = start();
    const list1 = await fetch(`${server.url}api/v1/projects/default/statuses`);
    const before = ((await list1.json()) as { statuses: ProjectStatus[] }).statuses.map(
      (s) => s.name,
    );
    const reversed = [...before].reverse();
    const res = await fetch(`${server.url}api/v1/projects/default/statuses/reorder`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ order: reversed }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { statuses: ProjectStatus[] };
    expect(body.statuses.map((s) => s.name)).toEqual(reversed);
    server.stop();
  });

  test("POST reorder 400 on mismatch", async () => {
    const server = start();
    const res = await fetch(`${server.url}api/v1/projects/default/statuses/reorder`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ order: ["Todo"] }),
    });
    expect(res.status).toBe(400);
    server.stop();
  });
});
