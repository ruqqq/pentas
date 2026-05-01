import { describe, expect, test } from "bun:test";
import { renderNewPage } from "../../src/ui/pages/new";

describe("renderNewPage", () => {
  test("contains title, description, linear-url paste, state default", () => {
    const html = renderNewPage({});
    expect(html).toContain('name="title"');
    expect(html).toContain('name="description"');
    expect(html).toContain('name="linear_url"');
    expect(html).toContain('name="state"');
    expect(html).toContain('value="Todo" selected');
  });

  test("posts to project route when project is supplied", () => {
    const html = renderNewPage({
      project: {
        id: "p1",
        slug: "alpha",
        name: "Alpha",
        description: null,
        created_at: "",
        updated_at: "",
      },
    });
    expect(html).toContain('action="/projects/alpha/new"');
  });
});
