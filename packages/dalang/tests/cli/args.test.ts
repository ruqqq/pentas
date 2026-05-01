// packages/dalang/tests/cli/args.test.ts
import { test, expect } from "bun:test";
import { DALANG_HELP, parseArgs } from "../../src/cli/args";

test("default workflow path is ./WORKFLOW.md", () => {
  expect(parseArgs([])).toEqual({ workflowPath: "./WORKFLOW.md", port: null, help: false });
});

test("positional arg sets workflowPath", () => {
  expect(parseArgs(["custom/WF.md"])).toEqual({
    workflowPath: "custom/WF.md",
    port: null,
    help: false,
  });
});

test("--port overrides", () => {
  expect(parseArgs(["--port", "8080"])).toEqual({
    workflowPath: "./WORKFLOW.md",
    port: 8080,
    help: false,
  });
});

test("positional + --port together", () => {
  expect(parseArgs(["./x.md", "--port", "0"])).toEqual({
    workflowPath: "./x.md",
    port: 0,
    help: false,
  });
});

test("--help requests help", () => {
  expect(parseArgs(["--help"])).toEqual({
    workflowPath: "./WORKFLOW.md",
    port: null,
    help: true,
  });
});

test("-h requests help", () => {
  expect(parseArgs(["-h"])).toEqual({
    workflowPath: "./WORKFLOW.md",
    port: null,
    help: true,
  });
});

test("help wins over invalid args", () => {
  expect(parseArgs(["--help", "--bad", "./one.md", "./two.md"])).toEqual({
    workflowPath: "./WORKFLOW.md",
    port: null,
    help: true,
  });
});

test("help text documents supported flags", () => {
  expect(DALANG_HELP).toContain("Usage: dalang [WORKFLOW.md] [--port <port>]");
  expect(DALANG_HELP).toContain("--help");
  expect(DALANG_HELP).toContain("-h");
});

test("rejects unknown flag", () => {
  expect(() => parseArgs(["--unknown"])).toThrow();
});

test("rejects --port without value", () => {
  expect(() => parseArgs(["--port"])).toThrow();
});

test("rejects empty or blank --port values", () => {
  expect(() => parseArgs(["--port", ""])).toThrow("invalid --port value");
  expect(() => parseArgs(["--port", "   "])).toThrow("invalid --port value");
});
