import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../../src/db/migrations";
import { createIssue } from "../../src/db/repo/issues";
import { startServer } from "../../src/api/server";
import { issuesByIdsRoute } from "../../src/api/routes/issues-by-ids";
import { issuesDetailRoute } from "../../src/api/routes/issues-detail";

let db: Database;
beforeEach(() => {
  db = new Database(":memory:");
  runMigrations(db);
});

describe("issue lookups", () => {
  test("GET /api/v1/issues/by-ids", async () => {
    const a = createIssue(db, { title: "a", state: "Todo" });
    const server = startServer({ db, apiToken: undefined, port: 0 }, [issuesByIdsRoute()]);
    const res = await fetch(`${server.url}api/v1/issues/by-ids?id=${a.id}&id=missing`);
    const body = (await res.json()) as { issues: { id: string }[] };
    expect(body.issues.map((i) => i.id)).toEqual([a.id]);
    server.stop();
  });

  test("GET /api/v1/issues/:id 404", async () => {
    const server = startServer({ db, apiToken: undefined, port: 0 }, [issuesDetailRoute()]);
    const res = await fetch(`${server.url}api/v1/issues/missing`);
    expect(res.status).toBe(404);
    server.stop();
  });

  test("GET /api/v1/issues/:id 200", async () => {
    const a = createIssue(db, { title: "a", state: "Todo" });
    const server = startServer({ db, apiToken: undefined, port: 0 }, [issuesDetailRoute()]);
    const res = await fetch(`${server.url}api/v1/issues/${a.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe(a.id);
    server.stop();
  });
});
