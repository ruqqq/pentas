import { describe, expect, test } from "bun:test";
import { renderNewPage } from "../../src/ui/pages/new";
import { DEFAULT_STATUSES } from "../../src/domain/status";

describe("renderNewPage", () => {
  test("contains title, description, linear-url paste, state default", () => {
    const html = renderNewPage({
      statuses: [...DEFAULT_STATUSES],
      defaultState: "Todo",
    });
    expect(html).toContain('name="title"');
    expect(html).toContain('name="description"');
    expect(html).toContain('name="linear_url"');
    expect(html).toContain('name="state"');
    expect(html).toContain('value="Todo" selected');
  });

  test("posts to project route when project is supplied", () => {
    const html = renderNewPage({
      statuses: [...DEFAULT_STATUSES],
      defaultState: "Todo",
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

  test("uses configured defaultState as the selected option", () => {
    const html = renderNewPage({
      statuses: [
        { name: "Triage", position: 0, kind: "dispatchable" },
        { name: "Doing", position: 1, kind: "dispatchable" },
      ],
      defaultState: "Doing",
    });
    expect(html).toContain('value="Doing" selected');
    expect(html).not.toContain('value="Todo"');
  });
});
