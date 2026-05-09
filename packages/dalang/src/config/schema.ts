// packages/dalang/src/config/schema.ts
import { z } from "zod";
import { SandboxConfigSchema } from "./sandbox-schema";

export const TrackerSchema = z.object({
  kind: z.literal("papan"),
  endpoint: z.string().url(),
  api_key: z.string().nullable().optional(),
  board: z.string().nullable().optional(),
  active_states: z.array(z.string()).min(1),
  terminal_states: z.array(z.string()).min(1),
});

export const OwnershipSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("none"),
    allow_unowned_dispatch: z.boolean().optional(),
  }),
  z.object({
    mode: z.literal("label"),
    value: z.string().min(1),
  }),
  z.object({
    mode: z.literal("assignee"),
    value: z.string().min(1),
  }),
  z.object({
    mode: z.literal("project_field"),
    field: z.string().min(1),
    value: z.string().min(1),
  }),
]);

export const PapanControlPlaneSchema = z.object({
  kind: z.literal("papan"),
  endpoint: z.string().url(),
  api_key: z.string().nullable().optional(),
  board: z.string().nullable().optional(),
  active_states: z.array(z.string()).min(1),
  terminal_states: z.array(z.string()).min(1),
  ownership: OwnershipSchema.default({ mode: "none" }),
});

export const GithubPrChecksSchema = z.object({
  enabled: z.boolean(),
  poll_interval_ms: z.number().int().positive().default(60000),
  failure_budget: z.number().int().positive().default(3),
  rerun_flakes: z.boolean().default(true),
  wait_state: z.string().min(1).default("Waiting PR Checks"),
  pass_state: z.string().min(1).default("Ready for Human Review"),
  fail_state: z.string().min(1).default("In Dev"),
  escalation_state: z.string().min(1).default("Ready for Human Review"),
  mark_pr_ready: z.boolean().default(true),
  gh_executable: z.string().min(1).default("gh"),
  conflict_watch_state: z.string().min(1).default("Ready for Human Review"),
  conflict_target_state: z.string().min(1).default("Ready for Dev"),
});

export const GithubProjectsControlPlaneSchema = z.object({
  kind: z.literal("github-projects"),
  owner_type: z.enum(["organization", "user"]),
  owner: z.string().min(1),
  project_number: z.number().int().positive(),
  repository: z.string().regex(/^[^/]+\/[^/]+$/, "repository must be owner/name"),
  token: z.string().min(1).nullable().optional(),
  status_field: z.string().min(1),
  branch_field: z.string().min(1).nullable().optional(),
  active_states: z.array(z.string()).min(1),
  terminal_states: z.array(z.string()).min(1),
  ownership: OwnershipSchema,
  pr_checks: GithubPrChecksSchema.optional(),
});

export const ControlPlaneSchema = z.discriminatedUnion("kind", [
  PapanControlPlaneSchema,
  GithubProjectsControlPlaneSchema,
]);

export const RepoSchema = z
  .object({
    url: z.string().min(1),
    default_branch: z.string().min(1),
    branch_prefix: z.string().min(0),
  })
  .optional()
  .nullable();

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

export const AgentProvider = z.enum(["claude", "codex", "opencode"]);

const StateOverrideKey = z.string().min(1);

export const CodexSandboxMode = z.enum(["read-only", "workspace-write", "danger-full-access"]);

export const CodexApprovalPolicy = z.enum(["untrusted", "on-failure", "on-request", "never"]);

export const CodexReasoningEffort = z.enum(["minimal", "low", "medium", "high", "xhigh"]);

const CodexStateOverrideSchema = z
  .object({
    model: z.string().min(1).optional(),
    model_reasoning_effort: CodexReasoningEffort.optional(),
  })
  .strict()
  .partial();

export const ClaudePermissionMode = z.enum(["auto", "default", "plan", "bypassPermissions"]);

export const ClaudeEffort = z.enum(["low", "medium", "high", "xhigh", "max"]);

const ClaudeStateOverrideSchema = z
  .object({
    model: z.string().min(1).optional(),
    effort: ClaudeEffort.optional(),
  })
  .strict()
  .partial();

const OpencodeStateOverrideSchema = z
  .object({
    model: z.string().min(1).optional(),
  })
  .strict()
  .partial();

export const CodexSchema = z.object({
  executable_path: z.string().min(1),
  model: z.string().min(1),
  model_reasoning_effort: CodexReasoningEffort.optional(),
  sandbox_mode: CodexSandboxMode,
  approval_policy: CodexApprovalPolicy,
  network_access_enabled: z.boolean().default(true),
  turn_timeout_ms: z.number().int().positive(),
  read_timeout_ms: z.number().int().positive(),
  stall_timeout_ms: z.number().int(),
  state_overrides: z.record(StateOverrideKey, CodexStateOverrideSchema).default({}),
});

export const OpencodeSchema = z.object({
  executable_path: z.string().min(1),
  model: z
    .string()
    .min(1)
    .regex(/^[^/]+\/.+$/, "model must be in providerID/modelID form"),
  state_overrides: z.record(StateOverrideKey, OpencodeStateOverrideSchema).default({}),
  turn_timeout_ms: z.number().int().positive(),
  read_timeout_ms: z.number().int().positive(),
  stall_timeout_ms: z.number().int(),
});

export const ClaudeSchema = z.object({
  executable_path: z.string().min(1),
  model: z.string().min(1),
  effort: ClaudeEffort.optional(),
  permission_mode: ClaudePermissionMode,
  state_overrides: z.record(StateOverrideKey, ClaudeStateOverrideSchema).default({}),
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
  mark_pr_ready: z.boolean().default(true),
  wait_state: z.string().min(1).optional(),
  pass_state: z.string().min(1).optional(),
  fail_state: z.string().min(1).optional(),
  escalation_state: z.string().min(1).optional(),
});

const DEFAULT_ACTIVE_STATES = [
  "Todo",
  "Plan",
  "Review Plan",
  "Ready for Dev",
  "In Dev",
  "Ready for Review",
  "Ready for QA",
  "In QA",
];

const DEFAULT_TERMINAL_STATES = ["Done", "Cancelled"];

const DEFAULT_PAPAN_CONTROL_PLANE = {
  kind: "papan" as const,
  endpoint: "http://localhost:3001",
  api_key: null,
  board: null,
  active_states: [...DEFAULT_ACTIVE_STATES],
  terminal_states: [...DEFAULT_TERMINAL_STATES],
  ownership: { mode: "none" as const },
};

const DEFAULT_TRACKER = {
  kind: "papan" as const,
  endpoint: "http://localhost:3001",
  api_key: null,
  board: null,
  active_states: [...DEFAULT_ACTIVE_STATES],
  terminal_states: [...DEFAULT_TERMINAL_STATES],
};

const CONTROL_PLANE_TRACKER_CONFLICT_KEY = "__control_plane_tracker_conflict";
const CONTROL_PLANE_FROM_TRACKER_KEY = "__control_plane_from_tracker";
const TRACKER_FROM_CONTROL_PLANE_KEY = "__tracker_from_control_plane";

interface AliasProvenance {
  controlPlaneFromTracker: boolean;
  trackerFromControlPlane: boolean;
  conflict: string | null;
}

const ALIAS_PROVENANCE = Symbol("dalang.control_plane.alias_provenance");
const aliasProvenance = new WeakMap<object, AliasProvenance>();

export function getAliasProvenance(cfg: object): AliasProvenance {
  return (
    (cfg as { [ALIAS_PROVENANCE]?: AliasProvenance })[ALIAS_PROVENANCE] ??
    aliasProvenance.get(cfg) ?? {
      controlPlaneFromTracker: false,
      trackerFromControlPlane: false,
      conflict: null,
    }
  );
}

function setAliasProvenance(cfg: object, provenance: AliasProvenance): void {
  Object.defineProperty(cfg, ALIAS_PROVENANCE, {
    value: provenance,
    enumerable: true,
    configurable: true,
    writable: false,
  });
  aliasProvenance.set(cfg, provenance);
}

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
  if (override === undefined) return deepClone(base);
  if (override === null) return null as T;
  if (typeof override !== "object" || Array.isArray(override)) return override as T;
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

interface AliasNormalizationResult {
  raw: unknown;
  controlPlaneFromTracker: boolean;
  trackerFromControlPlane: boolean;
}

function normalizeControlPlaneAliases(raw: unknown): AliasNormalizationResult {
  if (raw === null || typeof raw !== "object") {
    return { raw, controlPlaneFromTracker: false, trackerFromControlPlane: false };
  }
  const priorProvenance =
    (raw as { [ALIAS_PROVENANCE]?: AliasProvenance })[ALIAS_PROVENANCE] ?? aliasProvenance.get(raw);
  const {
    [CONTROL_PLANE_FROM_TRACKER_KEY]: _ignoredControlPlaneFromTracker,
    [TRACKER_FROM_CONTROL_PLANE_KEY]: _ignoredTrackerFromControlPlane,
    [CONTROL_PLANE_TRACKER_CONFLICT_KEY]: _ignoredConflict,
    ...r
  } = raw as Record<string, unknown>;
  if (priorProvenance) {
    return {
      raw: {
        ...r,
        ...(priorProvenance.controlPlaneFromTracker
          ? { [CONTROL_PLANE_FROM_TRACKER_KEY]: true }
          : {}),
        ...(priorProvenance.trackerFromControlPlane
          ? { [TRACKER_FROM_CONTROL_PLANE_KEY]: true }
          : {}),
        ...(priorProvenance.conflict
          ? { [CONTROL_PLANE_TRACKER_CONFLICT_KEY]: priorProvenance.conflict }
          : {}),
      },
      controlPlaneFromTracker: priorProvenance.controlPlaneFromTracker,
      trackerFromControlPlane: priorProvenance.trackerFromControlPlane,
    };
  }
  const unchanged = { raw: r, controlPlaneFromTracker: false, trackerFromControlPlane: false };
  const controlPlane = r.control_plane;
  const tracker = r.tracker;

  if (tracker === undefined && controlPlane !== null && typeof controlPlane === "object") {
    const cp = controlPlane as Record<string, unknown>;
    if (cp.kind === "papan") {
      return {
        raw: {
          ...r,
          tracker: {
            kind: "papan",
            endpoint: cp.endpoint,
            api_key: cp.api_key ?? null,
            board: cp.board ?? null,
            active_states: cp.active_states,
            terminal_states: cp.terminal_states,
          },
          [TRACKER_FROM_CONTROL_PLANE_KEY]: true,
        },
        controlPlaneFromTracker: false,
        trackerFromControlPlane: true,
      };
    }
  }

  if ("control_plane" in r) return unchanged;
  if (tracker === null || typeof tracker !== "object") return unchanged;
  const t = tracker as Record<string, unknown>;
  if (t.kind !== undefined && t.kind !== "papan") return unchanged;
  return {
    raw: {
      ...r,
      control_plane: {
        kind: "papan",
        endpoint: t.endpoint,
        api_key: t.api_key ?? null,
        board: t.board ?? null,
        active_states: t.active_states,
        terminal_states: t.terminal_states,
        ownership: { mode: "none" },
      },
      [CONTROL_PLANE_FROM_TRACKER_KEY]: true,
    },
    controlPlaneFromTracker: true,
    trackerFromControlPlane: false,
  };
}

const RawWorkflowFrontMatterSchema = z.preprocess(
  (raw) => normalizeControlPlaneAliases(raw).raw,
  z
    .object({
      [CONTROL_PLANE_TRACKER_CONFLICT_KEY]: z.string().optional(),
      [CONTROL_PLANE_FROM_TRACKER_KEY]: z.boolean().optional(),
      [TRACKER_FROM_CONTROL_PLANE_KEY]: z.boolean().optional(),
      control_plane: ControlPlaneSchema.default(DEFAULT_PAPAN_CONTROL_PLANE),
      tracker: TrackerSchema.default(DEFAULT_TRACKER),
      repo: RepoSchema,
      polling: PollingSchema,
      workspace: WorkspaceSchema,
      hooks: HooksSchema,
      agent: AgentSchema,
      agent_provider: AgentProvider.default("claude"),
      claude: ClaudeSchema.optional(),
      codex: CodexSchema.optional(),
      opencode: OpencodeSchema.optional(),
      sandbox: SandboxConfigSchema.optional(),
      server: ServerSchema,
      pr_checks: PrChecksSchema,
    })
    .transform((cfg) => {
      const {
        [CONTROL_PLANE_TRACKER_CONFLICT_KEY]: conflict,
        [CONTROL_PLANE_FROM_TRACKER_KEY]: controlPlaneFromTracker,
        [TRACKER_FROM_CONTROL_PLANE_KEY]: trackerFromControlPlane,
        ...clean
      } = cfg;
      setAliasProvenance(clean, {
        controlPlaneFromTracker: controlPlaneFromTracker === true,
        trackerFromControlPlane: trackerFromControlPlane === true,
        conflict: conflict ?? null,
      });
      return clean;
    }),
);

export const WorkflowFrontMatterSchema = RawWorkflowFrontMatterSchema.superRefine((cfg, ctx) => {
  if (cfg.agent_provider === "claude" && !cfg.claude) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["claude"],
      message: 'claude block is required when agent_provider is "claude"',
    });
  }
  if (cfg.agent_provider === "codex" && !cfg.codex) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["codex"],
      message: 'codex block is required when agent_provider is "codex"',
    });
  }
  if (cfg.agent_provider === "opencode" && !cfg.opencode) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["opencode"],
      message: 'opencode block is required when agent_provider is "opencode"',
    });
  }
});

type ParsedWorkflowFrontMatter = z.infer<typeof WorkflowFrontMatterSchema>;
export type WorkflowFrontMatter = ParsedWorkflowFrontMatter & {
  control_plane: z.infer<typeof ControlPlaneSchema>;
  tracker: z.infer<typeof TrackerSchema>;
};

const DEFAULTS = {
  control_plane: DEFAULT_PAPAN_CONTROL_PLANE,
  tracker: DEFAULT_TRACKER,
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
    effort: undefined,
    permission_mode: "auto",
    state_overrides: {},
    turn_timeout_ms: 3600000,
    read_timeout_ms: 5000,
    stall_timeout_ms: 300000,
  },
  codex: {
    executable_path: "codex",
    model: "gpt-5.5",
    model_reasoning_effort: undefined,
    sandbox_mode: "workspace-write",
    approval_policy: "never",
    network_access_enabled: true,
    turn_timeout_ms: 3600000,
    read_timeout_ms: 5000,
    stall_timeout_ms: 300000,
    state_overrides: {},
  },
  opencode: {
    executable_path: "opencode",
    state_overrides: {},
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
    mark_pr_ready: true,
  },
};

// Contract: applyDefaults fills the ACTIVE provider's block from defaults
// (resolving `agent_provider` from the raw input, falling back to "claude").
// The inactive providers' blocks are omitted, so `superRefine`'s active-block
// presence rule fires for genuinely malformed inputs through the loader path
// rather than being shadowed by always-present defaults.
// Supported providers: "claude", "codex", "opencode".
export function applyDefaults(raw: unknown): WorkflowFrontMatter {
  const normalized = normalizeControlPlaneAliases(raw);
  const normalizedRaw = normalized.raw;
  const provider = ((normalizedRaw as { agent_provider?: string } | null | undefined)
    ?.agent_provider ?? DEFAULTS.agent_provider) as "claude" | "codex" | "opencode";
  const base = deepClone(DEFAULTS) as Record<string, unknown>;
  if (provider === "codex") {
    delete base.claude;
    delete base.opencode;
  } else if (provider === "opencode") {
    delete base.claude;
    delete base.codex;
  } else {
    delete base.codex;
    delete base.opencode;
  }
  const merged = deepMerge(base as typeof DEFAULTS, normalizedRaw ?? {}) as WorkflowFrontMatter;
  setAliasProvenance(merged, {
    controlPlaneFromTracker: normalized.controlPlaneFromTracker,
    trackerFromControlPlane: normalized.trackerFromControlPlane,
    conflict: null,
  });
  return merged;
}
