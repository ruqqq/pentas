// Domain types — match Symphony §4 with dalang renames (spec §5).

export interface BlockerRef {
  id: string | null;
  identifier: string | null;
  state: string | null;
}

export interface WorkItem {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  priority: number | null;
  state: string;
  branch_name: string | null;
  url: string | null;
  external_ref: string | null;
  internal_ref: string | null;
  labels: string[];
  blocked_by: BlockerRef[];
  created_at: string | null;
  updated_at: string | null;
}

export type NormalizedIssue = WorkItem;

export interface ControlPlaneComment {
  id: string;
  author: string | null;
  body: string;
  created_at: string;
}

export type TrackerComment = ControlPlaneComment;

export type ControlPlaneHistoryKind =
  | "created"
  | "state_changed"
  | "edited"
  | "comment_added"
  | "deleted";

export type TrackerHistoryKind = ControlPlaneHistoryKind;

export interface ControlPlaneHistoryEntry {
  id: string;
  issue_id: string;
  kind: ControlPlaneHistoryKind;
  from_value: string | null;
  to_value: string | null;
  actor: "user" | "agent";
  at: string;
}

export type TrackerHistoryEntry = ControlPlaneHistoryEntry;

export interface WorkspaceMeta {
  path: string;
  workspace_key: string;
  created_now: boolean;
}

export type RunAttemptStatus =
  | "PreparingWorkspace"
  | "BuildingPrompt"
  | "LaunchingAgent"
  | "InitializingSession"
  | "StreamingTurn"
  | "Finishing"
  | "Succeeded"
  | "Failed"
  | "TimedOut"
  | "Stalled"
  | "CanceledByReconciliation";

export interface RunAttempt {
  issue_id: string;
  issue_identifier: string;
  attempt: number | null;
  workspace_path: string;
  started_at: string;
  status: RunAttemptStatus;
  error?: string | null;
}

export interface LiveSession {
  session_id: string;
  thread_id: string;
  turn_id: string;
  claude_session_pid: string | null;
  last_event: string | null;
  last_event_at: string | null;
  last_message: string | null;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  last_reported_input_tokens: number;
  last_reported_output_tokens: number;
  last_reported_total_tokens: number;
  turn_count: number;
}

export interface RetryEntry {
  issue_id: string;
  identifier: string;
  attempt: number;
  due_at_ms: number;
  timer_handle: ReturnType<typeof setTimeout> | null;
  error: string | null;
}

export interface RunningEntry {
  issue: NormalizedIssue;
  identifier: string;
  workspace_path: string;
  started_at: string;
  abort_controller: AbortController;
  retry_attempt: number | null;
  session: LiveSession | null;
}

export interface ClaudeTotals {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  seconds_running: number;
}

export interface RateLimitsSnapshot {
  // SDK-shaped payload; left loose for v1
  [key: string]: unknown;
}

export interface OrchestratorState {
  poll_interval_ms: number;
  max_concurrent_agents: number;
  running: Map<string, RunningEntry>;
  claimed: Set<string>;
  retry_attempts: Map<string, RetryEntry>;
  completed: Set<string>;
  claude_totals: ClaudeTotals;
  rate_limits: RateLimitsSnapshot | null;
  workflow_mtime: number | null;
  pr_checks_polls: Map<
    string,
    {
      last_polled_at: string;
      last_seen_sha: string | null;
      last_action: "pending" | "rerun" | "failed" | "passed" | "escalated" | "no_pr" | null;
    }
  >;
}

export type RuntimeEventKind =
  | "session_started"
  | "startup_failed"
  | "turn_completed"
  | "turn_ended_with_error"
  | "turn_failed"
  | "turn_cancelled"
  | "turn_input_required"
  | "approval_auto_approved"
  | "approval_auto_denied"
  | "unsupported_tool_call"
  | "notification"
  | "other_message"
  | "malformed"
  | "pr_checks_observed";

export interface RuntimeEvent {
  event: RuntimeEventKind;
  timestamp: string;
  claude_session_pid?: string | null;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  message?: string;
  reason?: string;
  thread_id?: string;
  turn_id?: string;
}
