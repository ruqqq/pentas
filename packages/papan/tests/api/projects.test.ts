import { beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../../src/db/migrations";
import { startServer } from "../../src/api/server";
import {
  projectsCreateRoute,
  projectsDetailRoute,
  projectsListRoute,
} from "../../src/api/routes/projects";

let db: Database;

beforeEach(() => {
  db = new Database(":memory:");
  runMigrations(db);
});

describe("project routes", () => {
  test("lists default project and creates a new project", async () => {
    const server = startServer({ db, apiToken: undefined, port: 0 }, [
      projectsListRoute(),
      projectsCreateRoute(),
      projectsDetailRoute(),
    ]);

    const created = await fetch(`${server.url}api/v1/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "alpha", name: "Alpha" }),
    });
    expect(created.status).toBe(201);

    const detail = await fetch(`${server.url}api/v1/projects/alpha`);
    expect(detail.status).toBe(200);
    const detailBody = (await detail.json()) as { slug: string };
    expect(detailBody.slug).toBe("alpha");

    const list = await fetch(`${server.url}api/v1/projects`);
    const listBody = (await list.json()) as { projects: { slug: string }[] };
    expect(listBody.projects.map((p) => p.slug)).toEqual(["alpha", "default"]);
    server.stop();
  });
});
