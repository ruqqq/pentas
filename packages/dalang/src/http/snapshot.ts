// packages/dalang/src/http/snapshot.ts
import type { OrchestratorState } from "../types";

export function buildStateSnapshot(state: OrchestratorState): unknown {
  const running = Array.from(state.running.values()).map((entry) => ({
    issue_id: entry.issue.id,
    issue_identifier: entry.issue.identifier,
    state: entry.issue.state,
    session_id: entry.session?.session_id ?? null,
    turn_count: entry.session?.turn_count ?? 0,
    last_event: entry.session?.last_event ?? null,
    last_message: entry.session?.last_message ?? "",
    started_at: entry.started_at,
    last_event_at: entry.session?.last_event_at ?? null,
    tokens: {
      input_tokens: entry.session?.input_tokens ?? 0,
      output_tokens: entry.session?.output_tokens ?? 0,
      total_tokens: entry.session?.total_tokens ?? 0,
    },
  }));
  const retrying = Array.from(state.retry_attempts.values()).map((r) => ({
    issue_id: r.issue_id,
    issue_identifier: r.identifier,
    attempt: r.attempt,
    due_at: new Date(r.due_at_ms).toISOString(),
    error: r.error,
  }));
  return {
    generated_at: new Date().toISOString(),
    counts: { running: running.length, retrying: retrying.length },
    running,
    retrying,
    claude_totals: state.claude_totals,
    codex_totals: state.claude_totals, // alias for Symphony API compatibility
    rate_limits: state.rate_limits,
  };
}

export function buildIssueSnapshot(state: OrchestratorState, identifier: string): unknown | null {
  for (const entry of state.running.values()) {
    if (entry.issue.identifier === identifier) {
      return {
        issue_identifier: entry.issue.identifier,
        issue_id: entry.issue.id,
        status: "running",
        workspace: { path: entry.workspace_path },
        attempts: { current_retry_attempt: entry.retry_attempt ?? 0 },
        running: {
          session_id: entry.session?.session_id ?? null,
          turn_count: entry.session?.turn_count ?? 0,
          state: entry.issue.state,
          started_at: entry.started_at,
          last_event: entry.session?.last_event ?? null,
          last_message: entry.session?.last_message ?? "",
          last_event_at: entry.session?.last_event_at ?? null,
          tokens: {
            input_tokens: entry.session?.input_tokens ?? 0,
            output_tokens: entry.session?.output_tokens ?? 0,
            total_tokens: entry.session?.total_tokens ?? 0,
          },
        },
        retry: null,
        last_error: null,
        recent_events: [],
        tracked: {},
      };
    }
  }
  for (const r of state.retry_attempts.values()) {
    if (r.identifier === identifier) {
      return {
        issue_identifier: r.identifier,
        issue_id: r.issue_id,
        status: "retrying",
        workspace: null,
        attempts: { current_retry_attempt: r.attempt },
        running: null,
        retry: { attempt: r.attempt, due_at: new Date(r.due_at_ms).toISOString(), error: r.error },
        last_error: r.error,
        recent_events: [],
        tracked: {},
      };
    }
  }
  return null;
}
