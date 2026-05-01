// packages/dalang/tests/http/routes.test.ts
import { test, expect } from "bun:test";
import { handleRequest, createRouteDeps } from "../../src/http/routes";
import { createInitialState } from "../../src/orchestrator/state";

const baseDeps = () => {
  const state = createInitialState({ poll_interval_ms: 30000, max_concurrent_agents: 4 });
  return createRouteDeps(state, async () => {});
};

test("GET /api/v1/state returns running, retrying, claude_totals", async () => {
  const deps = baseDeps();
  const res = await handleRequest(new Request("http://x/api/v1/state"), deps);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toHaveProperty("running");
  expect(body).toHaveProperty("retrying");
  expect(body).toHaveProperty("codex_totals"); // backward-compat alias
  expect(body).toHaveProperty("claude_totals");
});

test("GET /api/v1/:identifier returns 404 with envelope when unknown", async () => {
  const deps = baseDeps();
  const res = await handleRequest(new Request("http://x/api/v1/UNKNOWN-1"), deps);
  expect(res.status).toBe(404);
  const body = (await res.json()) as { error: { code: string } };
  expect(body.error.code).toBe("issue_not_found");
});

test("POST /api/v1/refresh returns 202", async () => {
  const deps = baseDeps();
  const res = await handleRequest(new Request("http://x/api/v1/refresh", { method: "POST" }), deps);
  expect(res.status).toBe(202);
  const body = (await res.json()) as { queued: boolean };
  expect(body.queued).toBe(true);
});

test("PUT /api/v1/state returns 405 with JSON envelope", async () => {
  const deps = baseDeps();
  const res = await handleRequest(new Request("http://x/api/v1/state", { method: "PUT" }), deps);
  expect(res.status).toBe(405);
  const body = (await res.json()) as { error: { code: string } };
  expect(body.error.code).toBe("method_not_allowed");
});

test("POST /api/v1/refresh coalesces concurrent requests", async () => {
  let calls = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const refresh = async () => {
    calls += 1;
    await gate;
  };
  const state = createInitialState({ poll_interval_ms: 30000, max_concurrent_agents: 4 });
  const deps = createRouteDeps(state, refresh);
  const [r1, r2] = await Promise.all([
    handleRequest(new Request("http://x/api/v1/refresh", { method: "POST" }), deps),
    handleRequest(new Request("http://x/api/v1/refresh", { method: "POST" }), deps),
  ]);
  release();
  const b1 = (await r1.json()) as { coalesced: boolean };
  const b2 = (await r2.json()) as { coalesced: boolean };
  expect(calls).toBe(1);
  expect([b1.coalesced, b2.coalesced].sort()).toEqual([false, true]);
});

test("unknown route returns 404 with envelope", async () => {
  const deps = baseDeps();
  const res = await handleRequest(new Request("http://x/api/v1/nonsense/path"), deps);
  expect(res.status).toBe(404);
  const body = (await res.json()) as { error: { code: string } };
  expect(body.error.code).toBe("not_found");
});
