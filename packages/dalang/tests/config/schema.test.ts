// packages/dalang/tests/config/schema.test.ts
import { test, expect, describe } from "bun:test";
import { WorkflowFrontMatterSchema, applyDefaults } from "../../src/config/schema";

test("accepts a complete valid front matter", () => {
  const raw = {
    tracker: {
      kind: "papan",
      endpoint: "http://localhost:3001",
      project: null,
      active_states: ["Todo", "In Progress"],
      terminal_states: ["Done"],
    },
    polling: { interval_ms: 5000 },
    workspace: { root: "/tmp/dalang" },
    hooks: { timeout_ms: 60000 },
    agent: {
      max_concurrent_agents: 2,
      max_turns: 5,
      max_retry_backoff_ms: 60000,
      max_concurrent_agents_by_state: {},
    },
    claude: {
      executable_path: "claude",
      model: "claude-opus-4-7",
      permission_mode: "auto",
      turn_timeout_ms: 60000,
      read_timeout_ms: 5000,
      stall_timeout_ms: 30000,
    },
    server: { port: 0 },
    pr_checks: {
      enabled: false,
      poll_interval_ms: 60000,
      failure_budget: 3,
      rerun_flakes: true,
      gh_executable: "gh",
    },
  };
  const parsed = WorkflowFrontMatterSchema.parse(raw);
  expect(parsed.tracker.kind).toBe("papan");
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
      mark_pr_ready: true,
    });
  });
  test("user override is shallow-merged into defaults", () => {
    const cfg = applyDefaults({ pr_checks: { enabled: true, failure_budget: 5 } });
    expect(cfg.pr_checks.enabled).toBe(true);
    expect(cfg.pr_checks.failure_budget).toBe(5);
    expect(cfg.pr_checks.poll_interval_ms).toBe(60000);
    expect(cfg.pr_checks.rerun_flakes).toBe(true);
    expect(cfg.pr_checks.gh_executable).toBe("gh");
    expect(cfg.pr_checks.mark_pr_ready).toBe(true);
  });
  test("mark_pr_ready can be disabled", () => {
    const cfg = applyDefaults({ pr_checks: { mark_pr_ready: false } });
    expect(cfg.pr_checks.mark_pr_ready).toBe(false);
  });
  test("optional state fields are accepted", () => {
    const cfg = applyDefaults({
      pr_checks: {
        wait_state: "Waiting CI",
        pass_state: "Ready for Human Review",
        fail_state: "In Dev",
        escalation_state: "Escalated",
      },
    });
    expect(cfg.pr_checks.wait_state).toBe("Waiting CI");
    expect(cfg.pr_checks.pass_state).toBe("Ready for Human Review");
    expect(cfg.pr_checks.fail_state).toBe("In Dev");
    expect(cfg.pr_checks.escalation_state).toBe("Escalated");
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

test("applyDefaults fills opencode block when agent_provider=opencode and omits claude/codex blocks", () => {
  const result = applyDefaults({
    agent_provider: "opencode",
    opencode: { model: "google/gemini-2.5-pro" },
  });
  expect(result.claude).toBeUndefined();
  expect(result.codex).toBeUndefined();
  expect(result.opencode?.executable_path).toBe("opencode");
  expect(result.opencode?.turn_timeout_ms).toBe(3600000);
  expect(result.opencode?.model).toBe("google/gemini-2.5-pro");
});

test('agent_provider accepts "opencode"', () => {
  const cfg = applyDefaults({
    agent_provider: "opencode",
    opencode: { model: "anthropic/claude-sonnet-4-6" },
  });
  const parsed = WorkflowFrontMatterSchema.safeParse(cfg);
  expect(parsed.success).toBe(true);
});

test('agent_provider="opencode" without opencode block fails superRefine', () => {
  const cfg = applyDefaults({ agent_provider: "opencode" });
  delete (cfg as Record<string, unknown>).opencode;
  const parsed = WorkflowFrontMatterSchema.safeParse(cfg);
  expect(parsed.success).toBe(false);
  if (!parsed.success) {
    expect(parsed.error.issues.some((i) => i.path[0] === "opencode")).toBe(true);
  }
});

test("opencode.model must be in provider/model form", () => {
  const cfg = applyDefaults({ agent_provider: "opencode", opencode: { model: "no-slash" } });
  const parsed = WorkflowFrontMatterSchema.safeParse(cfg);
  expect(parsed.success).toBe(false);
});

test("applyDefaults exposes control_plane and tracker compatibility alias", () => {
  const cfg = applyDefaults({});
  expect(cfg.control_plane.kind).toBe("papan");
  expect(cfg.control_plane.active_states).toContain("In Dev");
  expect(cfg.control_plane.ownership).toEqual({ mode: "none" });
  expect(cfg.tracker.kind).toBe("papan");
});

test("accepts github-projects control plane with label ownership", () => {
  const cfg = applyDefaults({
    control_plane: {
      kind: "github-projects",
      owner_type: "organization",
      owner: "acme",
      project_number: 7,
      repository: "acme/app",
      token: "$GITHUB_TOKEN",
      status_field: "Status",
      active_states: ["Todo", "In Dev"],
      terminal_states: ["Done"],
      ownership: { mode: "label", value: "dalang" },
      branch_field: "Branch",
      pr_checks: {
        enabled: true,
        poll_interval_ms: 60000,
        failure_budget: 3,
        rerun_flakes: true,
        wait_state: "Waiting PR Checks",
        pass_state: "Ready for Human Review",
        fail_state: "In Dev",
        escalation_state: "Ready for Human Review",
      },
    },
  });
  const parsed = WorkflowFrontMatterSchema.parse(cfg);
  expect(parsed.control_plane.kind).toBe("github-projects");
});

test("accepts github-projects control plane with omitted token", () => {
  const cfg = applyDefaults({
    control_plane: {
      kind: "github-projects",
      owner_type: "organization",
      owner: "acme",
      project_number: 7,
      repository: "acme/app",
      status_field: "Status",
      active_states: ["Todo", "In Dev"],
      terminal_states: ["Done"],
      ownership: { mode: "label", value: "dalang" },
    },
  });
  const parsed = WorkflowFrontMatterSchema.parse(cfg);
  expect(parsed.control_plane.kind).toBe("github-projects");
  if (parsed.control_plane.kind !== "github-projects")
    throw new Error("expected github-projects control plane");
  expect(parsed.control_plane.token).toBeUndefined();
});

test("defaults omitted github-projects pr_checks fields", () => {
  const cfg = applyDefaults({
    control_plane: {
      kind: "github-projects",
      owner_type: "organization",
      owner: "acme",
      project_number: 7,
      repository: "acme/app",
      token: "$GITHUB_TOKEN",
      status_field: "Status",
      active_states: ["Todo", "In Dev"],
      terminal_states: ["Done"],
      ownership: { mode: "label", value: "dalang" },
      pr_checks: {
        enabled: true,
        wait_state: "Waiting PR Checks",
        pass_state: "Ready for Human Review",
        fail_state: "In Dev",
        escalation_state: "Ready for Human Review",
        failure_budget: 3,
        rerun_flakes: true,
      },
    },
  });

  const parsed = WorkflowFrontMatterSchema.parse(cfg);
  expect(parsed.control_plane.kind).toBe("github-projects");
  if (parsed.control_plane.kind !== "github-projects")
    throw new Error("expected github-projects control plane");
  expect(parsed.control_plane.pr_checks?.poll_interval_ms).toBe(60000);
});

test("maps legacy tracker input to papan control_plane", () => {
  const cfg = applyDefaults({
    tracker: {
      kind: "papan",
      endpoint: "http://localhost:3009",
      api_key: null,
      active_states: ["Todo"],
      terminal_states: ["Done"],
    },
  });
  expect(cfg.control_plane).toMatchObject({
    kind: "papan",
    endpoint: "http://localhost:3009",
    active_states: ["Todo"],
    terminal_states: ["Done"],
  });
});

test("direct schema parse maps legacy tracker input to papan control_plane", () => {
  const parsed = WorkflowFrontMatterSchema.parse({
    tracker: {
      kind: "papan",
      endpoint: "http://localhost:3010",
      api_key: null,
      active_states: ["Doing"],
      terminal_states: ["Done"],
    },
    polling: { interval_ms: 5000 },
    workspace: { root: "/tmp/dalang" },
    hooks: { timeout_ms: 60000 },
    agent: {
      max_concurrent_agents: 2,
      max_turns: 5,
      max_retry_backoff_ms: 60000,
      max_concurrent_agents_by_state: {},
    },
    claude: {
      executable_path: "claude",
      model: "claude-opus-4-7",
      permission_mode: "auto",
      turn_timeout_ms: 60000,
      read_timeout_ms: 5000,
      stall_timeout_ms: 30000,
    },
    server: { port: 0 },
    pr_checks: {
      enabled: false,
      poll_interval_ms: 60000,
      failure_budget: 3,
      rerun_flakes: true,
      gh_executable: "gh",
    },
  });

  expect(parsed.control_plane).toMatchObject({
    kind: "papan",
    endpoint: "http://localhost:3010",
    active_states: ["Doing"],
    terminal_states: ["Done"],
  });
});

test("rejects explicit invalid control_plane instead of treating it as absent", () => {
  for (const controlPlane of [null, false, 0, "", []]) {
    const cfg = applyDefaults({
      control_plane: controlPlane,
      tracker: {
        kind: "papan",
        endpoint: "http://localhost:3010",
        api_key: null,
        active_states: ["Todo"],
        terminal_states: ["Done"],
      },
    });

    expect(() => WorkflowFrontMatterSchema.parse(cfg)).toThrow();
  }
});

test("rejects explicit invalid tracker instead of treating it as absent", () => {
  for (const tracker of [null, false, 0, "", []]) {
    const cfg = applyDefaults({ tracker });

    expect(() => WorkflowFrontMatterSchema.parse(cfg)).toThrow();
  }
});

test("maps papan control_plane input to tracker compatibility alias when tracker omitted", () => {
  const cfg = applyDefaults({
    control_plane: {
      kind: "papan",
      endpoint: "http://localhost:3011",
      api_key: "papan-key",
      board: "ops",
      active_states: ["Queued", "Building"],
      terminal_states: ["Shipped", "Dropped"],
      ownership: { mode: "none" },
    },
  });

  expect(cfg.tracker).toEqual({
    kind: "papan",
    endpoint: "http://localhost:3011",
    api_key: "papan-key",
    board: "ops",
    active_states: ["Queued", "Building"],
    terminal_states: ["Shipped", "Dropped"],
  });
});
