import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "../../src/lib/markdown";

describe("renderMarkdown", () => {
  test("renders basic markdown", () => {
    const html = renderMarkdown("# Hello\n\n**bold**");
    expect(html).toContain("<h1");
    expect(html).toContain("<strong>bold</strong>");
  });

  test("strips inline scripts", () => {
    const html = renderMarkdown("<script>alert(1)</script>safe");
    expect(html).not.toContain("<script");
    expect(html).toContain("safe");
  });

  test("strips javascript: URLs", () => {
    const html = renderMarkdown("[click](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
  });

  test("preserves http(s) and relative links", () => {
    expect(renderMarkdown("[a](https://example.com)")).toContain('href="https://example.com"');
    expect(renderMarkdown("[a](/issues/1)")).toContain('href="/issues/1"');
  });
});
