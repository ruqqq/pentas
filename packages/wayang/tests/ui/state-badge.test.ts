import { describe, expect, test } from "bun:test";
import { renderStateBadge } from "../../src/ui/partials/state-badge";

describe("renderStateBadge", () => {
  test("renders state label inside data-state attribute", () => {
    const html = renderStateBadge("In Dev");
    expect(html).toContain('data-state="In Dev"');
    expect(html).toContain("In Dev");
  });

  test("escapes user-provided values", () => {
    const html = renderStateBadge("<script>x</script>");
    expect(html).not.toContain("<script>");
  });
});
