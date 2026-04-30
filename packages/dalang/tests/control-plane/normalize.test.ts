import { test, expect } from "bun:test";
import { normalizeIssue, normalizeWorkItem } from "../../src/control-plane/normalize";

test("normalizeWorkItem accepts a complete work item", () => {
  const got = normalizeWorkItem({
    id: "PVTI_1",
    identifier: "org/repo#12",
    title: "Fix checkout",
    description: "body",
    priority: 2,
    state: "In Dev",
    branch_name: "dalang/12-fix-checkout",
    url: "https://github.com/org/repo/issues/12",
    external_ref: "I_kwDO",
    internal_ref: "org/repo#12",
    labels: ["Dalang", "Bug"],
    blocked_by: [{ id: "i1", identifier: "JUARA-1", state: "Done" }],
    created_at: "2026-04-30T01:02:03.000Z",
    updated_at: "2026-04-30T02:03:04.000Z",
  });

  expect(got).toEqual({
    id: "PVTI_1",
    identifier: "org/repo#12",
    title: "Fix checkout",
    description: "body",
    priority: 2,
    state: "In Dev",
    branch_name: "dalang/12-fix-checkout",
    url: "https://github.com/org/repo/issues/12",
    external_ref: "I_kwDO",
    internal_ref: "org/repo#12",
    labels: ["dalang", "bug"],
    blocked_by: [{ id: "i1", identifier: "JUARA-1", state: "Done" }],
    created_at: "2026-04-30T01:02:03.000Z",
    updated_at: "2026-04-30T02:03:04.000Z",
  });
});

test("normalizeWorkItem rejects malformed required fields", () => {
  expect(normalizeWorkItem({ id: "x", title: "missing identifier", state: "Todo" })).toBeNull();
  expect(normalizeWorkItem(null)).toBeNull();
});

test("normalizeIssue migration alias is normalizeWorkItem", () => {
  expect(normalizeIssue).toBe(normalizeWorkItem);
});
