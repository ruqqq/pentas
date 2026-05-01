import { describe, expect, test } from "bun:test";
import { renderDetailPage } from "../../src/ui/pages/detail";
import type { NormalizedIssue } from "../../src/domain/issue";
import { DEFAULT_STATUSES } from "../../src/domain/status";

const issue: NormalizedIssue = {
  id: "X",
  identifier: "PENTAS-1",
  title: "t",
  description: "hello",
  priority: null,
  state: "Todo",
  branch_name: null,
  url: null,
  external_ref: null,
  internal_ref: "PENTAS-1",
  labels: [],
  blocked_by: [],
  created_at: "",
  updated_at: "",
};

describe("renderDetailPage", () => {
  test("shows title, identifier, description, state-change form", () => {
    const html = renderDetailPage({
      issue,
      comments: [],
      history: [],
      statuses: [...DEFAULT_STATUSES],
    });
    expect(html).toContain("PENTAS-1");
    expect(html).toContain("hello");
    expect(html).toContain(`hx-patch="/api/v1/issues/X"`);
    expect(html).toContain('id="comments"');
    expect(html).toContain('id="history"');
  });

  test("uses project-scoped API paths when project is supplied", () => {
    const html = renderDetailPage({
      issue,
      comments: [],
      history: [],
      statuses: [...DEFAULT_STATUSES],
      project: {
        id: "p1",
        slug: "alpha",
        name: "Alpha",
        description: null,
        created_at: "",
        updated_at: "",
      },
    });
    expect(html).toContain(`hx-patch="/api/v1/issues/X?project=alpha"`);
    expect(html).toContain(`hx-post="/api/v1/issues/X/comments?project=alpha"`);
    expect(html).toContain(`data-project-scope="alpha"`);
  });

  test("includes the current state even when not in the configured statuses", () => {
    const html = renderDetailPage({
      issue: { ...issue, state: "Mystery" },
      comments: [],
      history: [],
      statuses: [{ name: "Other", position: 0, kind: "dispatchable" }],
    });
    expect(html).toContain('value="Mystery" selected');
  });
});
