// packages/dalang/tests/cli/args.test.ts
import { test, expect } from "bun:test";
import { DALANG_HELP, parseArgs } from "../../src/cli/args";

test("default workflow path is ./WORKFLOW.md", () => {
  expect(parseArgs([])).toEqual({
    command: "serve",
    workflowPath: "./WORKFLOW.md",
    port: null,
    help: false,
  });
});

test("positional arg sets workflowPath", () => {
  expect(parseArgs(["custom/WF.md"])).toEqual({
    command: "serve",
    workflowPath: "custom/WF.md",
    port: null,
    help: false,
  });
});

test("--port overrides", () => {
  expect(parseArgs(["--port", "8080"])).toEqual({
    command: "serve",
    workflowPath: "./WORKFLOW.md",
    port: 8080,
    help: false,
  });
});

test("positional + --port together", () => {
  expect(parseArgs(["./x.md", "--port", "0"])).toEqual({
    command: "serve",
    workflowPath: "./x.md",
    port: 0,
    help: false,
  });
});

test("parses lint subcommand with explicit workflow path", () => {
  expect(parseArgs(["lint", "custom/WORKFLOW.md"])).toEqual({
    command: "lint",
    workflowPath: "custom/WORKFLOW.md",
    port: null,
    help: false,
  });
});

test("parses lint subcommand with default workflow path", () => {
  expect(parseArgs(["lint"])).toEqual({
    command: "lint",
    workflowPath: "./WORKFLOW.md",
    port: null,
    help: false,
  });
});

test("rejects --port for lint", () => {
  expect(() => parseArgs(["lint", "--port", "3000"])).toThrow(
    "--port is only valid for serve mode",
  );
});

test("--help requests help", () => {
  expect(parseArgs(["--help"])).toEqual({
    command: "serve",
    workflowPath: "./WORKFLOW.md",
    port: null,
    help: true,
  });
});

test("-h requests help", () => {
  expect(parseArgs(["-h"])).toEqual({
    command: "serve",
    workflowPath: "./WORKFLOW.md",
    port: null,
    help: true,
  });
});

test("help wins over invalid args", () => {
  expect(parseArgs(["--help", "--bad", "./one.md", "./two.md"])).toEqual({
    command: "serve",
    workflowPath: "./WORKFLOW.md",
    port: null,
    help: true,
  });
});

test("help text documents supported flags and subcommands", () => {
  expect(DALANG_HELP).toContain("Usage: dalang [WORKFLOW.md] [--port <port>]");
  expect(DALANG_HELP).toContain("dalang lint [WORKFLOW.md]");
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
