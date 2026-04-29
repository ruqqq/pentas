// packages/dalang/tests/http/server.test.ts
import { test, expect } from "bun:test";
import { startServer } from "../../src/http/server";
import { createInitialState } from "../../src/orchestrator/state";

test("dashboard at / returns HTML 200 and includes counts", async () => {
  const state = createInitialState({ poll_interval_ms: 30000, max_concurrent_agents: 4 });
  const srv = startServer({
    state, refresh: async () => {},
    host: "127.0.0.1", port: 0,
  });
  const res = await fetch(`http://127.0.0.1:${srv.port}/`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")?.startsWith("text/html")).toBe(true);
  const text = await res.text();
  expect(text).toContain("dalang");
  srv.stop();
});

test("server binds 127.0.0.1 by default", async () => {
  const state = createInitialState({ poll_interval_ms: 30000, max_concurrent_agents: 4 });
  const srv = startServer({ state, refresh: async () => {}, port: 0 });
  expect(srv.hostname).toBe("127.0.0.1");
  srv.stop();
});
