// packages/dalang/tests/cli/args.test.ts
import { test, expect } from "bun:test";
import { parseArgs } from "../../src/cli/args";

test("default workflow path is ./WORKFLOW.md", () => {
  expect(parseArgs([])).toEqual({ workflowPath: "./WORKFLOW.md", port: null });
});

test("positional arg sets workflowPath", () => {
  expect(parseArgs(["custom/WF.md"])).toEqual({ workflowPath: "custom/WF.md", port: null });
});

test("--port overrides", () => {
  expect(parseArgs(["--port", "8080"])).toEqual({ workflowPath: "./WORKFLOW.md", port: 8080 });
});

test("positional + --port together", () => {
  expect(parseArgs(["./x.md", "--port", "0"])).toEqual({ workflowPath: "./x.md", port: 0 });
});

test("rejects unknown flag", () => {
  expect(() => parseArgs(["--unknown"])).toThrow();
});

test("rejects --port without value", () => {
  expect(() => parseArgs(["--port"])).toThrow();
});
