import { describe, expect, test } from "bun:test";
import { renderStateBadge } from "../../src/ui/partials/state-badge";

describe("renderStateBadge", () => {
  test("renders state label inside data-state attribute", () => {
    const html = renderStateBadge("In Progress");
    expect(html).toContain('data-state="In Progress"');
    expect(html).toContain("In Progress");
  });

  test("escapes user-provided values", () => {
    const html = renderStateBadge("<script>x</script>");
    expect(html).not.toContain("<script>");
  });
});
