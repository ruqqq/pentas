import { describe, expect, test } from "bun:test";
import { parseLinearUrl } from "../../src/lib/linear-url";

describe("parseLinearUrl", () => {
  test("extracts org and key from canonical URL", () => {
    expect(parseLinearUrl("https://linear.app/acme/issue/ABC-123/some-title")).toEqual({
      external_ref: "ABC-123",
      external_url: "https://linear.app/acme/issue/ABC-123/some-title",
    });
  });

  test("extracts when slug is omitted", () => {
    expect(parseLinearUrl("https://linear.app/acme/issue/ABC-123")).toEqual({
      external_ref: "ABC-123",
      external_url: "https://linear.app/acme/issue/ABC-123",
    });
  });

  test("returns null for non-Linear URLs", () => {
    expect(parseLinearUrl("https://github.com/foo/bar/issues/1")).toBeNull();
    expect(parseLinearUrl("not-a-url")).toBeNull();
    expect(parseLinearUrl("")).toBeNull();
  });
});
