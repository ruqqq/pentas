// packages/papan/tests/cli/args.test.ts
import { expect, test } from "bun:test";
import { PAPAN_HELP, parseArgs } from "../../src/cli/args";

test("defaults to runtime environment fallbacks", () => {
  expect(parseArgs([])).toEqual({ port: undefined, dbPath: undefined, help: false });
});

test("--port overrides", () => {
  expect(parseArgs(["--port", "8080"])).toEqual({ port: 8080, dbPath: undefined, help: false });
});

test("--db overrides", () => {
  expect(parseArgs(["--db", "/tmp/papan.db"])).toEqual({
    port: undefined,
    dbPath: "/tmp/papan.db",
    help: false,
  });
});

test("--help requests help", () => {
  expect(parseArgs(["--help"])).toEqual({ port: undefined, dbPath: undefined, help: true });
});

test("-h requests help", () => {
  expect(parseArgs(["-h"])).toEqual({ port: undefined, dbPath: undefined, help: true });
});

test("help wins over invalid args", () => {
  expect(parseArgs(["--help", "--bad", "positional"])).toEqual({
    port: undefined,
    dbPath: undefined,
    help: true,
  });
});

test("help text documents supported flags", () => {
  expect(PAPAN_HELP).toContain("Usage: papan [--port <port>] [--db <path>]");
  expect(PAPAN_HELP).toContain("--help");
  expect(PAPAN_HELP).toContain("-h");
});

test("rejects unknown flag", () => {
  expect(() => parseArgs(["--unknown"])).toThrow("unknown flag: --unknown");
});

test("rejects unexpected positional args", () => {
  expect(() => parseArgs(["extra"])).toThrow("unexpected positional argument: extra");
});

test("rejects --port without value", () => {
  expect(() => parseArgs(["--port"])).toThrow("--port requires a value");
});

test("rejects invalid --port values", () => {
  expect(() => parseArgs(["--port", "abc"])).toThrow("invalid --port value: abc");
  expect(() => parseArgs(["--port", "-1"])).toThrow("invalid --port value: -1");
  expect(() => parseArgs(["--port", "1.5"])).toThrow("invalid --port value: 1.5");
});

test("rejects empty or blank --port values", () => {
  expect(() => parseArgs(["--port", ""])).toThrow("invalid --port value");
  expect(() => parseArgs(["--port", "   "])).toThrow("invalid --port value");
});

test("rejects --db without value", () => {
  expect(() => parseArgs(["--db"])).toThrow("--db requires a value");
});

test("rejects empty --db value", () => {
  expect(() => parseArgs(["--db", ""])).toThrow("invalid --db value");
});
