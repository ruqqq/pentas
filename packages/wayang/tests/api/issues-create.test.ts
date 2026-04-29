import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../../src/db/migrations";
import { startServer } from "../../src/api/server";
import { issuesCreateRoute } from "../../src/api/routes/issues-create";

let db: Database;
beforeEach(() => {
  db = new Database(":memory:");
  runMigrations(db);
});

describe("POST /api/v1/issues", () => {
  test("creates with defaults", async () => {
    const server = startServer({ db, apiToken: undefined, port: 0 }, [issuesCreateRoute()]);
    const res = await fetch(`${server.url}api/v1/issues`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "new" }),
    });
    expect(res.status).toBe(201);
    const issue = (await res.json()) as { state: string; title: string; identifier: string };
    expect(issue.state).toBe("Todo");
    expect(issue.title).toBe("new");
    expect(issue.identifier).toBe("JUARA-1");
    server.stop();
  });

  test("400 on missing title", async () => {
    const server = startServer({ db, apiToken: undefined, port: 0 }, [issuesCreateRoute()]);
    const res = await fetch(`${server.url}api/v1/issues`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    server.stop();
  });

  test("400 on invalid state", async () => {
    const server = startServer({ db, apiToken: undefined, port: 0 }, [issuesCreateRoute()]);
    const res = await fetch(`${server.url}api/v1/issues`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "t", state: "Bogus" }),
    });
    expect(res.status).toBe(400);
    server.stop();
  });
});
