// packages/dalang/tests/agent/sdk-runner.test.ts
import { test, expect } from "bun:test";
import { sdkRunQuery } from "../../src/agent/sdk-runner";

test("sdkRunQuery returns an async iterable (smoke)", () => {
  const it = sdkRunQuery({
    prompt: "noop",
    cwd: "/tmp",
    claude: { permissionMode: "auto" },
    model: "claude-opus-4-7",
    executablePath: "/nonexistent/path/to/claude",
  });
  expect(typeof (it as AsyncIterable<unknown>)[Symbol.asyncIterator]).toBe("function");
});
