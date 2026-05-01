import { describe, expect, test } from "bun:test";
import { renderBoardGrid } from "../../src/ui/pages/board";

describe("renderBoardGrid", () => {
  test("uses project-scoped refresh path and SSE project scope", () => {
    const html = renderBoardGrid({
      issues: [],
      q: "bug",
      project: {
        id: "p1",
        slug: "alpha",
        name: "Alpha",
        description: null,
        created_at: "",
        updated_at: "",
      },
    });
    expect(html).toContain('data-project-scope="alpha"');
    expect(html).toContain('hx-get="/projects/alpha/partials/board?q=bug"');
  });
});
