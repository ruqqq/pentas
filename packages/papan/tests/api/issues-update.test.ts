import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../../src/db/migrations";
import { createIssue } from "../../src/db/repo/issues";
import { listHistory } from "../../src/db/repo/history";
import { startServer } from "../../src/api/server";
import { issuesUpdateRoute } from "../../src/api/routes/issues-update";
import { issuesDeleteRoute } from "../../src/api/routes/issues-delete";

let db: Database;
beforeEach(() => {
  db = new Database(":memory:");
  runMigrations(db);
});

describe("PATCH/DELETE /api/v1/issues/:id", () => {
  test("PATCH state change appends history with actor", async () => {
    const a = createIssue(db, { title: "t", state: "Todo" });
    const server = startServer({ db, apiToken: undefined, port: 0 }, [issuesUpdateRoute()]);
    const res = await fetch(`${server.url}api/v1/issues/${a.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: "In Dev", actor: "agent" }),
    });
    expect(res.status).toBe(200);
    const history = listHistory(db, a.id);
    const stateChange = history.find((h) => h.kind === "state_changed");
    expect(stateChange?.actor).toBe("agent");
    expect(stateChange?.from_value).toBe("Todo");
    expect(stateChange?.to_value).toBe("In Dev");
    server.stop();
  });

  test("DELETE removes", async () => {
    const a = createIssue(db, { title: "t", state: "Todo" });
    const server = startServer({ db, apiToken: undefined, port: 0 }, [issuesDeleteRoute()]);
    const res = await fetch(`${server.url}api/v1/issues/${a.id}`, { method: "DELETE" });
    expect(res.status).toBe(204);
    server.stop();
  });
});
