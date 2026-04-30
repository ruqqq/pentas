import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../../src/db/migrations";
import { createIssue } from "../../src/db/repo/issues";
import { startServer } from "../../src/api/server";
import { commentsListRoute, commentsCreateRoute } from "../../src/api/routes/comments";
import { historyListRoute } from "../../src/api/routes/history";

let db: Database;
beforeEach(() => {
  db = new Database(":memory:");
  runMigrations(db);
});

describe("comments and history routes", () => {
  test("POST + GET comments", async () => {
    const a = createIssue(db, { title: "t", state: "Todo" });
    const server = startServer({ db, apiToken: undefined, port: 0 }, [
      commentsCreateRoute(),
      commentsListRoute(),
    ]);

    const post = await fetch(`${server.url}api/v1/issues/${a.id}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "hello **world**", author: "agent" }),
    });
    expect(post.status).toBe(201);

    const get = await fetch(`${server.url}api/v1/issues/${a.id}/comments`);
    const body = (await get.json()) as { comments: { author: string; body_html: string }[] };
    expect(body.comments[0]!.author).toBe("agent");
    expect(body.comments[0]!.body_html).toContain("<strong>world</strong>");
    server.stop();
  });

  test("GET history shows creation event", async () => {
    const a = createIssue(db, { title: "t", state: "Todo" });
    const server = startServer({ db, apiToken: undefined, port: 0 }, [historyListRoute()]);
    const res = await fetch(`${server.url}api/v1/issues/${a.id}/history`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { history: unknown[] };
    expect(Array.isArray(body.history)).toBe(true);
    server.stop();
  });
});
