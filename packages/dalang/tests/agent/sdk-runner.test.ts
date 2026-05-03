// packages/dalang/tests/agent/sdk-runner.test.ts
import { test, expect } from "bun:test";
import { buildClaudeQueryOptions, sdkRunQuery } from "../../src/agent/sdk-runner";

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

test("buildClaudeQueryOptions disables inherited settings and claude.ai MCP servers", () => {
  const opts = buildClaudeQueryOptions({
    prompt: "noop",
    cwd: "/tmp",
    claude: { permissionMode: "auto" },
    model: "claude-opus-4-7",
    executablePath: "/nonexistent/path/to/claude",
  });

  expect(opts.options).toBeDefined();
  const options = opts.options!;
  expect(options.settingSources).toEqual([]);
  expect(options.mcpServers).toEqual({});
  expect(options.env).toMatchObject({
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    ENABLE_CLAUDEAI_MCP_SERVERS: "false",
  });
});
