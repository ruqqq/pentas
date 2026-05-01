import { describe, expect, test } from "bun:test";
import { renderProjectsPage } from "../../src/ui/pages/projects";

describe("renderProjectsPage", () => {
  test("renders project links and counts", () => {
    const html = renderProjectsPage([
      {
        id: "p1",
        slug: "alpha",
        name: "Alpha",
        description: null,
        created_at: "",
        updated_at: "",
        issue_count: 2,
        active_issue_count: 1,
        last_issue_updated_at: "2026-05-01T00:00:00.000Z",
      },
    ]);
    expect(html).toContain('href="/projects/alpha"');
    expect(html).toContain("<td>2</td>");
    expect(html).toContain("<td>1</td>");
  });
});
