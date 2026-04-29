// packages/dalang/tests/config/schema.test.ts
import { test, expect } from "bun:test";
import { WorkflowFrontMatterSchema, applyDefaults } from "../../src/config/schema";

test("accepts a complete valid front matter", () => {
  const raw = {
    tracker: { kind: "tok-juara", endpoint: "http://localhost:3001", project: null,
      active_states: ["Todo", "In Progress"], terminal_states: ["Done"] },
    polling: { interval_ms: 5000 },
    workspace: { root: "/tmp/dalang" },
    hooks: { timeout_ms: 60000 },
    agent: { max_concurrent_agents: 2, max_turns: 5, max_retry_backoff_ms: 60000,
      max_concurrent_agents_by_state: {} },
    claude: { executable_path: "claude", model: "claude-opus-4-7",
      permission_mode: "auto", turn_timeout_ms: 60000, read_timeout_ms: 5000, stall_timeout_ms: 30000 },
    server: { port: 0 },
  };
  const parsed = WorkflowFrontMatterSchema.parse(raw);
  expect(parsed.tracker.kind).toBe("tok-juara");
});

test("rejects acceptEdits permission_mode in v1", () => {
  const bad = applyDefaults({});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (bad.claude as any).permission_mode = "acceptEdits";
  expect(() => WorkflowFrontMatterSchema.parse(bad)).toThrow();
});

test("rejects unknown tracker kind", () => {
  const bad = applyDefaults({ tracker: { kind: "linear" } });
  expect(() => WorkflowFrontMatterSchema.parse(bad)).toThrow();
});

test("applyDefaults fills empty input with all defaults", () => {
  const result = applyDefaults({});
  expect(result.polling.interval_ms).toBe(30000);
  expect(result.agent.max_concurrent_agents).toBe(4);
  expect(result.agent.max_turns).toBe(20);
  expect(result.claude.permission_mode).toBe("auto");
  expect(result.claude.model).toBe("claude-opus-4-7");
  expect(result.tracker.active_states).toEqual(["Todo", "In Progress"]);
  expect(result.server.port).toBe(0);
});

test("applyDefaults preserves user-supplied values", () => {
  const result = applyDefaults({ polling: { interval_ms: 1000 } });
  expect(result.polling.interval_ms).toBe(1000);
});

test("rejects negative agent.max_turns", () => {
  const bad = applyDefaults({});
  bad.agent.max_turns = 0;
  expect(() => WorkflowFrontMatterSchema.parse(bad)).toThrow();
});
