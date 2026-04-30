// packages/dalang/src/config/schema.ts
import { z } from "zod";

export const TrackerSchema = z.object({
  kind: z.literal("tok-juara"),
  endpoint: z.string().url(),
  api_key: z.string().nullable().optional(),
  board: z.string().nullable().optional(),
  active_states: z.array(z.string()).min(1),
  terminal_states: z.array(z.string()).min(1),
});

export const RepoSchema = z.object({
  url: z.string().min(1),
  default_branch: z.string().min(1),
  branch_prefix: z.string().min(0),
}).optional().nullable();

export const PollingSchema = z.object({
  interval_ms: z.number().int().positive(),
});

export const WorkspaceSchema = z.object({
  root: z.string().min(1),
});

export const HooksSchema = z.object({
  after_create: z.string().nullable().optional(),
  before_run: z.string().nullable().optional(),
  after_run: z.string().nullable().optional(),
  before_remove: z.string().nullable().optional(),
  timeout_ms: z.number().int().positive(),
});

export const AgentSchema = z.object({
  max_concurrent_agents: z.number().int().positive(),
  max_turns: z.number().int().positive(),
  max_retry_backoff_ms: z.number().int().positive(),
  max_concurrent_agents_by_state: z.record(z.string(), z.number().int().positive()),
});

export const AgentProvider = z.enum(["claude", "codex"]);

export const CodexSandboxMode = z.enum([
  "read-only",
  "workspace-write",
  "danger-full-access",
]);

export const CodexApprovalPolicy = z.enum([
  "untrusted",
  "on-failure",
  "on-request",
  "never",
]);

export const CodexSchema = z.object({
  executable_path: z.string().min(1),
  model: z.string().min(1),
  sandbox_mode: CodexSandboxMode,
  approval_policy: CodexApprovalPolicy,
  turn_timeout_ms: z.number().int().positive(),
  read_timeout_ms: z.number().int().positive(),
  stall_timeout_ms: z.number().int(),
});

export const ClaudePermissionMode = z.enum(["auto", "default", "plan", "bypassPermissions"]);

export const ClaudeSchema = z.object({
  executable_path: z.string().min(1),
  model: z.string().min(1),
  permission_mode: ClaudePermissionMode,
  turn_timeout_ms: z.number().int().positive(),
  read_timeout_ms: z.number().int().positive(),
  stall_timeout_ms: z.number().int(),
});

export const ServerSchema = z.object({
  port: z.number().int().min(0),
});

export const PrChecksSchema = z.object({
  enabled: z.boolean(),
  poll_interval_ms: z.number().int().positive(),
  failure_budget: z.number().int().positive(),
  rerun_flakes: z.boolean(),
  gh_executable: z.string().min(1),
});

const RawWorkflowFrontMatterSchema = z.object({
  tracker: TrackerSchema,
  repo: RepoSchema,
  polling: PollingSchema,
  workspace: WorkspaceSchema,
  hooks: HooksSchema,
  agent: AgentSchema,
  agent_provider: AgentProvider.default("claude"),
  claude: ClaudeSchema.optional(),
  codex: CodexSchema.optional(),
  server: ServerSchema,
  pr_checks: PrChecksSchema,
});

export const WorkflowFrontMatterSchema = RawWorkflowFrontMatterSchema.superRefine((cfg, ctx) => {
  if (cfg.agent_provider === "claude" && !cfg.claude) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["claude"],
      message: "claude block is required when agent_provider is \"claude\"",
    });
  }
  if (cfg.agent_provider === "codex" && !cfg.codex) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["codex"],
      message: "codex block is required when agent_provider is \"codex\"",
    });
  }
});

export type WorkflowFrontMatter = z.infer<typeof WorkflowFrontMatterSchema>;

const DEFAULTS = {
  tracker: {
    kind: "tok-juara",
    endpoint: "http://localhost:3001",
    api_key: null,
    board: null,
    active_states: [
      "Todo",
      "Plan",
      "Review Plan",
      "Ready for Dev",
      "In Dev",
      "Ready for Review",
    ],
    terminal_states: ["Done", "Cancelled"],
  },
  repo: null,
  polling: { interval_ms: 30000 },
  workspace: { root: "~/.dalang/workspaces" },
  hooks: {
    after_create: null,
    before_run: null,
    after_run: null,
    before_remove: null,
    timeout_ms: 60000,
  },
  agent: {
    max_concurrent_agents: 4,
    max_turns: 20,
    max_retry_backoff_ms: 300000,
    max_concurrent_agents_by_state: {},
  },
  agent_provider: "claude",
  claude: {
    executable_path: "claude",
    model: "claude-opus-4-7",
    permission_mode: "auto",
    turn_timeout_ms: 3600000,
    read_timeout_ms: 5000,
    stall_timeout_ms: 300000,
  },
  codex: {
    executable_path: "codex",
    model: "gpt-5.5",
    sandbox_mode: "workspace-write",
    approval_policy: "never",
    turn_timeout_ms: 3600000,
    read_timeout_ms: 5000,
    stall_timeout_ms: 300000,
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

function deepClone<T>(val: T): T {
  if (val === null || val === undefined) return val;
  if (typeof val !== "object" || Array.isArray(val)) return val;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
    out[k] = deepClone(v);
  }
  return out as T;
}

function deepMerge<T>(base: T, override: unknown): T {
  if (override === null || override === undefined) return deepClone(base);
  if (typeof base !== "object" || base === null || Array.isArray(base)) {
    return override as T;
  }
  const baseObj = base as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(baseObj)) {
    out[k] = deepClone(v);
  }
  for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
    out[k] = deepMerge(baseObj[k], v);
  }
  return out as T;
}

// Contract: applyDefaults fills the ACTIVE provider's block from defaults
// (resolving `agent_provider` from the raw input, falling back to "claude").
// The inactive provider's block is omitted, so `superRefine`'s active-block
// presence rule fires for genuinely malformed inputs through the loader path
// rather than being shadowed by always-present defaults.
export function applyDefaults(raw: unknown): WorkflowFrontMatter {
  const provider = ((raw as { agent_provider?: string } | null | undefined)?.agent_provider
    ?? DEFAULTS.agent_provider) as "claude" | "codex";
  const base = deepClone(DEFAULTS) as Record<string, unknown>;
  if (provider === "codex") {
    delete base.claude;
  } else {
    delete base.codex;
  }
  const merged = deepMerge(base as typeof DEFAULTS, raw ?? {}) as WorkflowFrontMatter;
  return merged;
}
