import { describe, expect, test } from "bun:test";
import { renderIssueRow } from "../../src/ui/partials/issue-row";
import type { NormalizedIssue } from "../../src/domain/issue";

const issue: NormalizedIssue = {
  id: "01ABC",
  identifier: "JUARA-1",
  title: "first",
  description: null,
  priority: 2,
  state: "Todo",
  branch_name: null,
  url: null,
  labels: ["bug"],
  blocked_by: [],
  created_at: "2026-04-29T00:00:00Z",
  updated_at: "2026-04-29T00:00:00Z",
};

describe("renderIssueRow", () => {
  test("contains identifier link, title, state, labels", () => {
    const html = renderIssueRow(issue);
    expect(html).toContain('href="/issues/01ABC"');
    expect(html).toContain("JUARA-1");
    expect(html).toContain("first");
    expect(html).toContain('data-state="Todo"');
    expect(html).toContain("bug");
  });

  test("row has hx-target id for SSE swap", () => {
    const html = renderIssueRow(issue);
    expect(html).toContain('id="row-01ABC"');
  });
});
