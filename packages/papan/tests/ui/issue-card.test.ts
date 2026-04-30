import { describe, expect, test } from "bun:test";
import { renderIssueCard } from "../../src/ui/partials/issue-card";
import type { NormalizedIssue } from "../../src/domain/issue";

const issue: NormalizedIssue = {
  id: "01ABC",
  identifier: "PENTAS-1",
  title: "first",
  description: null,
  priority: 2,
  state: "In Dev",
  branch_name: null,
  url: null,
  external_ref: null,
  internal_ref: "PENTAS-1",
  labels: ["bug"],
  blocked_by: [],
  created_at: "2026-04-29T00:00:00Z",
  updated_at: "2026-04-29T00:00:00Z",
};

describe("renderIssueCard", () => {
  test("renders identifier link, title, state-data, labels, priority", () => {
    const html = renderIssueCard(issue);
    expect(html).toContain('href="/issues/01ABC"');
    expect(html).toContain("PENTAS-1");
    expect(html).toContain("first");
    expect(html).toContain('data-state="In Dev"');
    expect(html).toContain("bug");
    expect(html).toContain("P2");
  });

  test("uses card- id prefix for SSE addressing", () => {
    const html = renderIssueCard(issue);
    expect(html).toContain('id="card-01ABC"');
  });

  test("omits priority chip when priority is null", () => {
    const html = renderIssueCard({ ...issue, priority: null });
    expect(html).not.toContain("card-prio");
  });

  test("state select includes pipeline states with current selected", () => {
    const html = renderIssueCard(issue);
    expect(html).toContain('<option value="Todo">Todo</option>');
    expect(html).toContain('<option value="Plan">Plan</option>');
    expect(html).toContain('<option value="Review Plan">Review Plan</option>');
    expect(html).toContain('<option value="Ready for Dev">Ready for Dev</option>');
    expect(html).toContain('<option value="In Dev" selected>In Dev</option>');
    expect(html).toContain('<option value="Ready for Review">Ready for Review</option>');
    expect(html).toContain(
      '<option value="Ready for Human Review">Ready for Human Review</option>',
    );
    expect(html).toContain('<option value="Done">Done</option>');
    expect(html).toContain('<option value="Cancelled">Cancelled</option>');
  });
});
