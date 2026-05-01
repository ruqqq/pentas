import { describe, expect, test } from "bun:test";
import { renderIssueCard } from "../../src/ui/partials/issue-card";
import type { NormalizedIssue } from "../../src/domain/issue";
import { DEFAULT_STATUSES } from "../../src/domain/status";

const defaultNames = DEFAULT_STATUSES.map((s) => s.name);

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
    const html = renderIssueCard(issue, undefined, defaultNames);
    expect(html).toContain('href="/issues/01ABC"');
    expect(html).toContain("PENTAS-1");
    expect(html).toContain("first");
    expect(html).toContain('data-state="In Dev"');
    expect(html).toContain("bug");
    expect(html).toContain("P2");
  });

  test("renders project-scoped links and patch URLs", () => {
    const html = renderIssueCard(issue, "alpha", defaultNames);
    expect(html).toContain('href="/projects/alpha/issues/01ABC"');
    expect(html).toContain('hx-patch="/api/v1/issues/01ABC?project=alpha"');
  });

  test("uses card- id prefix for SSE addressing", () => {
    const html = renderIssueCard(issue, undefined, defaultNames);
    expect(html).toContain('id="card-01ABC"');
  });

  test("omits priority chip when priority is null", () => {
    const html = renderIssueCard({ ...issue, priority: null }, undefined, defaultNames);
    expect(html).not.toContain("card-prio");
  });

  test("state select emits options for the supplied statuses", () => {
    const html = renderIssueCard(issue, undefined, defaultNames);
    expect(html).toContain('<option value="Todo">Todo</option>');
    expect(html).toContain('<option value="In Dev" selected>In Dev</option>');
    expect(html).toContain('<option value="Done">Done</option>');
  });

  test("appends current state to options when not in the supplied list", () => {
    const html = renderIssueCard({ ...issue, state: "Mystery" }, undefined, ["Backlog"]);
    expect(html).toContain('<option value="Backlog">Backlog</option>');
    expect(html).toContain('<option value="Mystery" selected>Mystery</option>');
  });
});
