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

export const WorkflowFrontMatterSchema = z.object({
  tracker: TrackerSchema,
  repo: RepoSchema,
  polling: PollingSchema,
  workspace: WorkspaceSchema,
  hooks: HooksSchema,
  agent: AgentSchema,
  claude: ClaudeSchema,
  server: ServerSchema,
});

export type WorkflowFrontMatter = z.infer<typeof WorkflowFrontMatterSchema>;

const DEFAULTS = {
  tracker: {
    kind: "tok-juara",
    endpoint: "http://localhost:3001",
    api_key: null,
    board: null,
    active_states: ["Todo", "In Progress"],
    terminal_states: ["Done", "Cancelled", "Duplicate"],
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
  claude: {
    executable_path: "claude",
    model: "claude-opus-4-7",
    permission_mode: "auto",
    turn_timeout_ms: 3600000,
    read_timeout_ms: 5000,
    stall_timeout_ms: 300000,
  },
  server: { port: 0 },
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

export function applyDefaults(raw: unknown): WorkflowFrontMatter {
  const merged = deepMerge(DEFAULTS, raw ?? {}) as WorkflowFrontMatter;
  return merged;
}
