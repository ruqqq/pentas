import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../../src/db/migrations";
import { createIssue } from "../../src/db/repo/issues";
import { startServer } from "../../src/api/server";
import { issuesListRoute } from "../../src/api/routes/issues-list";

let db: Database;
let server: ReturnType<typeof startServer>;

beforeEach(() => {
  db = new Database(":memory:");
  runMigrations(db);
});

function start() {
  server = startServer({ db, apiToken: undefined, port: 0 }, [issuesListRoute()]);
}

describe("GET /api/v1/issues", () => {
  test("filters by state", async () => {
    createIssue(db, { title: "a", state: "Todo" });
    createIssue(db, { title: "b", state: "Done" });
    start();
    const res = await fetch(`${server.url}api/v1/issues?state=Todo`);
    const body = (await res.json()) as { issues: { title: string }[]; next_cursor: string | null };
    expect(body.issues.map((i) => i.title)).toEqual(["a"]);
    expect(body.next_cursor).toBeNull();
    server.stop();
  });

  test("returns 400 on missing state param", async () => {
    start();
    const res = await fetch(`${server.url}api/v1/issues`);
    expect(res.status).toBe(400);
    server.stop();
  });
});
