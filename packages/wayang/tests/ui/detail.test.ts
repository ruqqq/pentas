import { describe, expect, test } from "bun:test";
import { renderDetailPage } from "../../src/ui/pages/detail";
import type { NormalizedIssue } from "../../src/domain/issue";

const issue: NormalizedIssue = {
  id: "X",
  identifier: "JUARA-1",
  title: "t",
  description: "hello",
  priority: null,
  state: "Todo",
  branch_name: null,
  url: null,
  external_ref: null,
  labels: [],
  blocked_by: [],
  created_at: "",
  updated_at: "",
};

describe("renderDetailPage", () => {
  test("shows title, identifier, description, state-change form", () => {
    const html = renderDetailPage({ issue, comments: [], history: [] });
    expect(html).toContain("JUARA-1");
    expect(html).toContain("hello");
    expect(html).toContain(`hx-patch="/api/v1/issues/X"`);
    expect(html).toContain('id="comments"');
    expect(html).toContain('id="history"');
  });
});
