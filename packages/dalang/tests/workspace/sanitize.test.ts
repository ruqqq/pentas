// packages/dalang/tests/workspace/sanitize.test.ts
import { test, expect } from "bun:test";
import { sanitizeWorkspaceKey } from "../../src/workspace/sanitize";

test("preserves allowed characters", () => {
  expect(sanitizeWorkspaceKey("JUARA-12.3_a")).toBe("JUARA-12.3_a");
});

test("replaces disallowed characters with _", () => {
  expect(sanitizeWorkspaceKey("foo/bar")).toBe("foo_bar");
  expect(sanitizeWorkspaceKey("a b/c?d")).toBe("a_b_c_d");
});

test("collapses unicode and spaces", () => {
  expect(sanitizeWorkspaceKey("café 🦊")).toBe("caf___");
});

test("rejects empty input", () => {
  expect(() => sanitizeWorkspaceKey("")).toThrow();
});
