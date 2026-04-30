// packages/dalang/tests/config/env-resolver.test.ts
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { resolveEnvValue, resolveGithubToken, expandPath } from "../../src/config/env-resolver";

const originalEnv = { ...process.env };
beforeEach(() => {
  process.env = { ...originalEnv };
});
afterEach(() => {
  process.env = { ...originalEnv };
});

test("resolveEnvValue: literal string is returned as-is", () => {
  expect(resolveEnvValue("hello")).toBe("hello");
});

test("resolveEnvValue: $VAR is replaced with env value", () => {
  process.env.PENTAS_API_KEY = "secret-1";
  expect(resolveEnvValue("$PENTAS_API_KEY")).toBe("secret-1");
});

test("resolveEnvValue: missing env var returns null (treated as missing)", () => {
  delete process.env.UNDEFINED_KEY;
  expect(resolveEnvValue("$UNDEFINED_KEY")).toBeNull();
});

test("resolveEnvValue: empty env var returns null", () => {
  process.env.EMPTY_KEY = "";
  expect(resolveEnvValue("$EMPTY_KEY")).toBeNull();
});

test("resolveEnvValue: null/undefined input returns null", () => {
  expect(resolveEnvValue(null)).toBeNull();
  expect(resolveEnvValue(undefined)).toBeNull();
});

test("resolveGithubToken: explicit literal token wins", () => {
  process.env.GITHUB_TOKEN = "env-token";
  expect(resolveGithubToken("literal-token")).toBe("literal-token");
});

test("resolveGithubToken: explicit env reference wins", () => {
  process.env.DALANG_GITHUB_TOKEN_TEST = "referenced-token";
  process.env.GITHUB_TOKEN = "env-token";
  expect(resolveGithubToken("$DALANG_GITHUB_TOKEN_TEST")).toBe("referenced-token");
});

test("resolveGithubToken: falls back to GITHUB_TOKEN", () => {
  process.env.GITHUB_TOKEN = "env-token";
  expect(resolveGithubToken(undefined)).toBe("env-token");
});

test("resolveGithubToken: falls back to gh auth token", () => {
  delete process.env.GITHUB_TOKEN;
  const dir = mkdtempSync(join(tmpdir(), "gh-token-bin-"));
  const path = join(dir, "gh");
  writeFileSync(
    path,
    "#!/bin/sh\nif [ \"$1\" = auth ] && [ \"$2\" = token ]; then echo gh-token; exit 0; fi\nexit 1\n",
    { mode: 0o755 },
  );
  chmodSync(path, 0o755);
  process.env.PATH = `${dir}${delimiter}${process.env.PATH ?? ""}`;

  expect(resolveGithubToken(undefined)).toBe("gh-token");
});

test("resolveGithubToken: returns null when no token source exists", () => {
  delete process.env.GITHUB_TOKEN;
  const dir = mkdtempSync(join(tmpdir(), "gh-token-bin-"));
  const path = join(dir, "gh");
  writeFileSync(path, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  chmodSync(path, 0o755);
  process.env.PATH = `${dir}${delimiter}${process.env.PATH ?? ""}`;

  expect(resolveGithubToken(undefined)).toBeNull();
});

test("expandPath: ~ expands to HOME", () => {
  process.env.HOME = "/home/user";
  expect(expandPath("~/foo")).toBe("/home/user/foo");
});

test("expandPath: $VAR within path is expanded", () => {
  process.env.WORKSPACE_BASE = "/var/dalang";
  expect(expandPath("$WORKSPACE_BASE/x")).toBe("/var/dalang/x");
});

test("expandPath: relative path is returned unchanged (caller normalizes)", () => {
  expect(expandPath("./foo")).toBe("./foo");
});
