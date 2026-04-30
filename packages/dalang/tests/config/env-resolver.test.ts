// packages/dalang/tests/config/env-resolver.test.ts
import { test, expect, beforeEach, afterEach } from "bun:test";
import { resolveEnvValue, expandPath } from "../../src/config/env-resolver";

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
