// packages/dalang/tests/tracker/rest-adapter.test.ts
import { test, expect, beforeEach, afterEach } from "bun:test";
import { RestTrackerAdapter } from "../../src/tracker/rest-adapter";

let server: ReturnType<typeof Bun.serve> | null = null;
let lastRequest: { method: string; url: string; auth: string | null } | null = null;
let nextResponse: { status: number; body: unknown } = { status: 200, body: { issues: [], next_cursor: null } };

beforeEach(() => {
  server = Bun.serve({
    port: 0,
    fetch: (req) => {
      lastRequest = { method: req.method, url: new URL(req.url).pathname + new URL(req.url).search,
        auth: req.headers.get("authorization") };
      return new Response(JSON.stringify(nextResponse.body), {
        status: nextResponse.status,
        headers: { "content-type": "application/json" },
      });
    },
  });
});

afterEach(() => { server?.stop(); server = null; lastRequest = null; });

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
