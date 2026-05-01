import { describe, expect, test } from "bun:test";
import { renderBoardGrid } from "../../src/ui/pages/board";
import { DEFAULT_STATUSES } from "../../src/domain/status";
import type { NormalizedIssue } from "../../src/domain/issue";

const project = {
  id: "p1",
  slug: "alpha",
  name: "Alpha",
  description: null,
  created_at: "",
  updated_at: "",
};

describe("renderBoardGrid", () => {
  test("uses project-scoped refresh path and SSE project scope", () => {
    const html = renderBoardGrid({
      issues: [],
      q: "bug",
      statuses: [...DEFAULT_STATUSES],
      project,
    });
    expect(html).toContain('data-project-scope="alpha"');
    expect(html).toContain('hx-get="/projects/alpha/partials/board?q=bug"');
  });

  test("renders columns from configured statuses in order", () => {
    const customStatuses = [
      { name: "Triage", position: 0, kind: "dispatchable" as const },
      { name: "Doing", position: 1, kind: "dispatchable" as const },
      { name: "Shipped", position: 2, kind: "terminal" as const },
    ];
    const html = renderBoardGrid({ issues: [], q: "", statuses: customStatuses, project });
    const triageIdx = html.indexOf('data-state="Triage"');
    const doingIdx = html.indexOf('data-state="Doing"');
    const shippedIdx = html.indexOf('data-state="Shipped"');
    expect(triageIdx).toBeGreaterThan(-1);
    expect(doingIdx).toBeGreaterThan(triageIdx);
    expect(shippedIdx).toBeGreaterThan(doingIdx);
    expect(html).not.toContain('data-state="Todo"');
  });

  test("renders Unknown column when an issue has an unconfigured state", () => {
    const issue: NormalizedIssue = {
      id: "X",
      identifier: "PENTAS-1",
      title: "t",
      description: null,
      priority: null,
      state: "Mystery",
      branch_name: null,
      url: null,
      external_ref: null,
      internal_ref: "PENTAS-1",
      labels: [],
      blocked_by: [],
      project: { id: project.id, slug: project.slug, name: project.name },
      created_at: "",
      updated_at: "",
    };
    const html = renderBoardGrid({
      issues: [issue],
      q: "",
      statuses: [{ name: "Backlog", position: 0, kind: "dispatchable" }],
      project,
    });
    expect(html).toContain('data-state="Unknown"');
    expect(html).toContain("Mystery"); // option value or data-state on card
    expect(html).toContain('href="/projects/alpha/statuses"');
  });
});
