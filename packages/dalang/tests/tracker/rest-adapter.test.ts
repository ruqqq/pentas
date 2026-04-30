// packages/dalang/tests/tracker/rest-adapter.test.ts
import { test, expect, beforeEach, afterEach } from "bun:test";
import { RestTrackerAdapter } from "../../src/tracker/rest-adapter";

let server: ReturnType<typeof Bun.serve> | null = null;
let lastRequest: { method: string; url: string; auth: string | null } | null = null;
let lastBody: unknown = null;
let nextResponse: { status: number; body: unknown } = { status: 200, body: { issues: [], next_cursor: null } };

beforeEach(() => {
  server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      lastRequest = { method: req.method, url: new URL(req.url).pathname + new URL(req.url).search,
        auth: req.headers.get("authorization") };
      if (req.method !== "GET") {
        const text = await req.text();
        try { lastBody = JSON.parse(text); } catch { lastBody = text; }
      }
      return new Response(JSON.stringify(nextResponse.body), {
        status: nextResponse.status,
        headers: { "content-type": "application/json" },
      });
    },
  });
});

afterEach(() => { server?.stop(); server = null; lastRequest = null; lastBody = null; });

const baseURL = () => `http://localhost:${server!.port}`;

test("fetchCandidateIssues encodes states and paginates", async () => {
  nextResponse = { status: 200, body: {
    issues: [
      { id: "i1", identifier: "X-1", title: "t1", state: "Todo", labels: [], blocked_by: [] },
    ],
    next_cursor: null,
  }};
  const adapter = new RestTrackerAdapter({ endpoint: baseURL(), apiKey: null });
  const issues = await adapter.fetchCandidateIssues(["Todo", "In Progress"]);
  expect(issues).toHaveLength(1);
  expect(lastRequest!.url).toContain("state=Todo");
  expect(lastRequest!.url).toContain("state=In+Progress");
});

test("sends Authorization header when api_key is set", async () => {
  nextResponse = { status: 200, body: { issues: [], next_cursor: null } };
  const adapter = new RestTrackerAdapter({ endpoint: baseURL(), apiKey: "secret-1" });
  await adapter.fetchCandidateIssues(["Todo"]);
  expect(lastRequest!.auth).toBe("Bearer secret-1");
});

test("fetchIssuesByStates short-circuits on empty array (no HTTP call)", async () => {
  const adapter = new RestTrackerAdapter({ endpoint: baseURL(), apiKey: null });
  lastRequest = null;
  const out = await adapter.fetchIssuesByStates([]);
  expect(out).toEqual([]);
  expect(lastRequest).toBeNull();
});

test("fetchIssueStatesByIds builds correct URL", async () => {
  nextResponse = { status: 200, body: { issues: [] } };
  const adapter = new RestTrackerAdapter({ endpoint: baseURL(), apiKey: null });
  await adapter.fetchIssueStatesByIds(["i1", "i2"]);
  expect(lastRequest!.url).toContain("/api/v1/issues/by-ids?id=i1&id=i2");
});

test("non-200 throws TrackerError tracker_status_error", async () => {
  nextResponse = { status: 500, body: { error: "boom" } };
  const adapter = new RestTrackerAdapter({ endpoint: baseURL(), apiKey: null });
  await expect(adapter.fetchCandidateIssues(["Todo"])).rejects.toMatchObject({
    code: "tracker_status_error",
  });
});

test("malformed payload throws tracker_malformed_payload", async () => {
  nextResponse = { status: 200, body: { not_issues: [] } };
  const adapter = new RestTrackerAdapter({ endpoint: baseURL(), apiKey: null });
  await expect(adapter.fetchCandidateIssues(["Todo"])).rejects.toMatchObject({
    code: "tracker_malformed_payload",
  });
});

test("paginates across multiple pages preserving order", async () => {
  let call = 0;
  server!.stop();
  server = Bun.serve({
    port: 0,
    fetch: () => {
      call += 1;
      if (call === 1) return new Response(JSON.stringify({
        issues: [{ id: "i1", identifier: "X-1", title: "t", state: "Todo", labels: [], blocked_by: [] }],
        next_cursor: "cur2",
      }));
      return new Response(JSON.stringify({
        issues: [{ id: "i2", identifier: "X-2", title: "t", state: "Todo", labels: [], blocked_by: [] }],
        next_cursor: null,
      }));
    },
  });
  const adapter = new RestTrackerAdapter({ endpoint: `http://localhost:${server.port}`, apiKey: null });
  const out = await adapter.fetchCandidateIssues(["Todo"]);
  expect(out.map((i) => i.id)).toEqual(["i1", "i2"]);
});

test("listComments parses { comments: [...] }", async () => {
  nextResponse = { status: 200, body: { comments: [
    { id: "c1", author: "user", body: "hi", created_at: "2026-01-01T00:00:00Z" },
  ]}};
  const adapter = new RestTrackerAdapter({ endpoint: baseURL(), apiKey: null });
  const got = await adapter.listComments("issue-1");
  expect(got).toEqual([{ id: "c1", author: "user", body: "hi", created_at: "2026-01-01T00:00:00Z" }]);
  expect(lastRequest!.method).toBe("GET");
  expect(lastRequest!.url).toBe("/api/v1/issues/issue-1/comments");
});

test("addComment posts to /api/v1/issues/:id/comments with body+author", async () => {
  nextResponse = { status: 201, body: { id: "c1", author: "agent", body: "hi", created_at: "2026-01-01T00:00:00Z" }};
  const adapter = new RestTrackerAdapter({ endpoint: baseURL(), apiKey: null });
  await adapter.addComment("issue-1", "hello world", "agent");
  expect(lastRequest!.method).toBe("POST");
  expect(lastRequest!.url).toBe("/api/v1/issues/issue-1/comments");
  expect(lastBody).toEqual({ body: "hello world", author: "agent" });
});

test("addComment defaults author to 'agent'", async () => {
  nextResponse = { status: 201, body: { id: "c1", author: "agent", body: "hi", created_at: "2026-01-01T00:00:00Z" }};
  const adapter = new RestTrackerAdapter({ endpoint: baseURL(), apiKey: null });
  await adapter.addComment("issue-1", "x");
  expect((lastBody as { author: string }).author).toBe("agent");
});

test("addComment throws TrackerError(tracker_write_error) on non-2xx", async () => {
  nextResponse = { status: 500, body: { error: "nope" }};
  const adapter = new RestTrackerAdapter({ endpoint: baseURL(), apiKey: null });
  await expect(adapter.addComment("issue-1", "x")).rejects.toMatchObject({ code: "tracker_write_error" });
});

test("updateState patches /api/v1/issues/:id with { state }", async () => {
  nextResponse = { status: 200, body: { ok: true }};
  const adapter = new RestTrackerAdapter({ endpoint: baseURL(), apiKey: null });
  await adapter.updateState("issue-1", "In Dev");
  expect(lastRequest!.method).toBe("PATCH");
  expect(lastRequest!.url).toBe("/api/v1/issues/issue-1");
  expect(lastBody).toEqual({ state: "In Dev" });
});

test("updateState throws TrackerError(tracker_write_error) on non-2xx", async () => {
  nextResponse = { status: 422, body: { error: "bad" }};
  const adapter = new RestTrackerAdapter({ endpoint: baseURL(), apiKey: null });
  await expect(adapter.updateState("issue-1", "Bad")).rejects.toMatchObject({ code: "tracker_write_error" });
});

test("listComments throws TrackerError(tracker_status_error) on non-2xx", async () => {
  nextResponse = { status: 500, body: { error: "x" }};
  const adapter = new RestTrackerAdapter({ endpoint: baseURL(), apiKey: null });
  await expect(adapter.listComments("issue-1")).rejects.toMatchObject({ code: "tracker_status_error" });
});

test("listComments throws TrackerError(tracker_malformed_payload) when comments is not array", async () => {
  nextResponse = { status: 200, body: { comments: "not-array" }};
  const adapter = new RestTrackerAdapter({ endpoint: baseURL(), apiKey: null });
  await expect(adapter.listComments("issue-1")).rejects.toMatchObject({ code: "tracker_malformed_payload" });
});

test("listComments throws tracker_malformed_payload when JSON is null", async () => {
  nextResponse = { status: 200, body: null };
  const adapter = new RestTrackerAdapter({ endpoint: baseURL(), apiKey: null });
  await expect(adapter.listComments("issue-1")).rejects.toMatchObject({ code: "tracker_malformed_payload" });
});

test("listHistory parses { history: [...] }", async () => {
  nextResponse = { status: 200, body: { history: [
    { id: "h1", issue_id: "issue-1", kind: "state_changed", from_value: "Todo", to_value: "Plan", actor: "agent", at: "2026-01-02T00:00:00Z" },
    { id: "h2", issue_id: "issue-1", kind: "comment_added", from_value: null, to_value: null, actor: "user", at: "2026-01-02T00:01:00Z" },
  ]}};
  const adapter = new RestTrackerAdapter({ endpoint: baseURL(), apiKey: null });
  const got = await adapter.listHistory("issue-1");
  expect(got).toHaveLength(2);
  expect(got[0]).toMatchObject({ id: "h1", kind: "state_changed", from_value: "Todo", to_value: "Plan" });
  expect(lastRequest!.method).toBe("GET");
  expect(lastRequest!.url).toBe("/api/v1/issues/issue-1/history");
});

test("listHistory throws tracker_status_error on non-2xx", async () => {
  nextResponse = { status: 500, body: { error: "x" }};
  const adapter = new RestTrackerAdapter({ endpoint: baseURL(), apiKey: null });
  await expect(adapter.listHistory("issue-1")).rejects.toMatchObject({ code: "tracker_status_error" });
});

test("listHistory throws tracker_malformed_payload when history is not array", async () => {
  nextResponse = { status: 200, body: { history: "nope" }};
  const adapter = new RestTrackerAdapter({ endpoint: baseURL(), apiKey: null });
  await expect(adapter.listHistory("issue-1")).rejects.toMatchObject({ code: "tracker_malformed_payload" });
});
