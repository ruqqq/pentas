import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../../src/db/migrations";
import { startServer } from "../../src/api/server";
import { eventsRoute } from "../../src/api/routes/events";

let db: Database;
beforeEach(() => {
  db = new Database(":memory:");
  runMigrations(db);
});

describe("GET /api/v1/events", () => {
  test("streams a published event", async () => {
    const server = startServer({ db, apiToken: undefined, port: 0 }, [eventsRoute()]);
    const res = await fetch(`${server.url}api/v1/events`);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    setTimeout(() => server.bus.publish("test.evt", { v: 1 }), 20);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (!buf.includes("event: test.evt")) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value);
    }
    expect(buf).toContain("event: test.evt");
    expect(buf).toContain('data: {"v":1}');
    await reader.cancel();
    server.stop();
  });
});
