// packages/dalang/tests/config/schema.test.ts
import { test, expect, describe } from "bun:test";
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
    pr_checks: { enabled: false, poll_interval_ms: 60000, failure_budget: 3, rerun_flakes: true, gh_executable: "gh" },
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
  expect(result.claude!.permission_mode).toBe("auto");
  expect(result.claude!.model).toBe("claude-opus-4-7");
  expect(result.tracker.active_states).toEqual([
    "Todo",
    "Plan",
    "Review Plan",
    "Ready for Dev",
    "In Dev",
    "Ready for Review",
  ]);
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

describe("pr_checks config", () => {
  test("defaults to enabled=false with sensible values", () => {
    const cfg = applyDefaults({});
    expect(cfg.pr_checks).toEqual({
      enabled: false,
      poll_interval_ms: 60000,
      failure_budget: 3,
      rerun_flakes: true,
      gh_executable: "gh",
    });
  });
  test("user override is shallow-merged into defaults", () => {
    const cfg = applyDefaults({ pr_checks: { enabled: true, failure_budget: 5 } });
    expect(cfg.pr_checks.enabled).toBe(true);
    expect(cfg.pr_checks.failure_budget).toBe(5);
    expect(cfg.pr_checks.poll_interval_ms).toBe(60000);
    expect(cfg.pr_checks.rerun_flakes).toBe(true);
    expect(cfg.pr_checks.gh_executable).toBe("gh");
  });
});

test("applyDefaults defaults agent_provider to claude and omits inactive codex block", () => {
  const result = applyDefaults({});
  expect(result.agent_provider).toBe("claude");
  expect(result.codex).toBeUndefined();
});

test("applyDefaults fills codex block when agent_provider=codex and omits claude block", () => {
  const result = applyDefaults({ agent_provider: "codex" });
  expect(result.agent_provider).toBe("codex");
  expect(result.claude).toBeUndefined();
  expect(result.codex?.executable_path).toBe("codex");
  expect(result.codex?.model).toBe("gpt-5.5");
  expect(result.codex?.sandbox_mode).toBe("workspace-write");
  expect(result.codex?.approval_policy).toBe("never");
});

test("accepts agent_provider=codex with a codex block", () => {
  const cfg = applyDefaults({ agent_provider: "codex" });
  const parsed = WorkflowFrontMatterSchema.parse(cfg);
  expect(parsed.agent_provider).toBe("codex");
  expect(parsed.codex?.model).toBe("gpt-5.5");
});

test("rejects unknown codex.sandbox_mode", () => {
  const bad = applyDefaults({ agent_provider: "codex" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (bad.codex as any).sandbox_mode = "kitchen-sink";
  expect(() => WorkflowFrontMatterSchema.parse(bad)).toThrow();
});

test("rejects agent_provider=codex without a codex block", () => {
  const cfg = applyDefaults({ agent_provider: "codex" }) as Record<string, unknown>;
  delete cfg.codex;
  expect(() => WorkflowFrontMatterSchema.parse(cfg)).toThrow(/codex/i);
});

test("rejects agent_provider=claude without a claude block", () => {
  const cfg = applyDefaults({}) as Record<string, unknown>;
  delete cfg.claude;
  expect(() => WorkflowFrontMatterSchema.parse(cfg)).toThrow(/claude/i);
});
