import type { ControlPlaneComment, ControlPlaneHistoryEntry, WorkItem } from "../types";

export type OwnershipRule =
  | { mode: "none"; allow_unowned_dispatch?: boolean | undefined }
  | { mode: "label"; value: string }
  | { mode: "assignee"; value: string }
  | { mode: "project_field"; field: string; value: string };

export interface DispatchQuery {
  activeStates: string[];
  ownership: OwnershipRule;
}

export interface ControlPlaneCapabilities {
  history?: true;
  prChecks?: true;
}

export interface PrChecksReconcileArgs {
  work: WorkItem[];
  polls: Map<string, PrChecksPollEntry>;
  config: {
    enabled: boolean;
    poll_interval_ms: number;
    failure_budget: number;
    rerun_flakes: boolean;
    gh_executable?: string | undefined;
    wait_state?: string | undefined;
    pass_state?: string | undefined;
    fail_state?: string | undefined;
    escalation_state?: string | undefined;
  };
  repoCwd: string;
  now: () => Date;
}

export interface PrChecksPollEntry {
  last_polled_at: string;
  last_seen_sha: string | null;
  last_action: "pending" | "rerun" | "failed" | "passed" | "escalated" | "no_pr" | null;
}

export interface ControlPlaneAdapter {
  capabilities: ControlPlaneCapabilities;
  validateConnection?(): Promise<void>;
  fetchDispatchableWork(query: DispatchQuery): Promise<WorkItem[]>;
  fetchWorkByStates(states: string[]): Promise<WorkItem[]>;
  refreshWork(ids: string[]): Promise<WorkItem[]>;
  fetchWorkItem(id: string): Promise<WorkItem | null>;
  listComments(workItemId: string): Promise<ControlPlaneComment[]>;
  listHistory?(workItemId: string): Promise<ControlPlaneHistoryEntry[]>;
  addComment(workItemId: string, body: string, author?: "user" | "agent"): Promise<void>;
  updateState(workItemId: string, state: string): Promise<void>;
  reconcilePrChecks?(args: PrChecksReconcileArgs): Promise<void>;
}

export type ControlPlaneErrorCode =
  | "control_plane_request_error"
  | "control_plane_status_error"
  | "control_plane_malformed_payload"
  | "control_plane_missing_pagination_cursor"
  | "control_plane_write_error"
  | "control_plane_validation_error";

export class ControlPlaneError extends Error {
  code: ControlPlaneErrorCode;
  constructor(code: ControlPlaneErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
