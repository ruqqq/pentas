// packages/dalang/tests/tracker/normalize.test.ts
import { test, expect } from "bun:test";
import { normalizeIssue } from "../../src/tracker/normalize";

test("passes through a clean issue", () => {
  const out = normalizeIssue({
    id: "i1", identifier: "JUARA-1", title: "t", description: "d",
    priority: 2, state: "Todo", branch_name: null, url: null,
    labels: ["BUG", "p1"], blocked_by: [],
    created_at: "2026-04-29T00:00:00Z", updated_at: null,
  });
  expect(out).not.toBeNull();
  expect(out!.labels).toEqual(["bug", "p1"]);
});

test("priority non-integer becomes null", () => {
  const out = normalizeIssue({
    id: "i1", identifier: "X-1", title: "t", state: "Todo",
    priority: 2.5, labels: [], blocked_by: [],
  });
  expect(out!.priority).toBeNull();
});

test("priority non-numeric becomes null", () => {
  const out = normalizeIssue({
    id: "i1", identifier: "X-1", title: "t", state: "Todo",
    priority: "high", labels: [], blocked_by: [],
  });
  expect(out!.priority).toBeNull();
});

test("non-string labels are dropped, strings lowercased", () => {
  const out = normalizeIssue({
    id: "i1", identifier: "X-1", title: "t", state: "Todo",
    labels: ["FOO", 42, null, "Bar"], blocked_by: [],
  });
  expect(out!.labels).toEqual(["foo", "bar"]);
});

test("blocker without id and identifier is dropped", () => {
  const out = normalizeIssue({
    id: "i1", identifier: "X-1", title: "t", state: "Todo",
    labels: [],
    blocked_by: [
      { id: null, identifier: null, state: "Done" },
      { id: "i2", identifier: null, state: "Todo" },
    ],
  });
  expect(out!.blocked_by).toHaveLength(1);
  expect(out!.blocked_by[0]?.id).toBe("i2");
});

test("missing required field returns null", () => {
  const out = normalizeIssue({ identifier: "X-1", title: "t", state: "Todo" });
  expect(out).toBeNull();
});

test("unparseable timestamps become null", () => {
  const out = normalizeIssue({
    id: "i1", identifier: "X-1", title: "t", state: "Todo",
    labels: [], blocked_by: [],
    created_at: "not-a-date",
  });
  expect(out!.created_at).toBeNull();
});
