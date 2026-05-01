// packages/dalang/src/orchestrator/retry.ts
import type { OrchestratorState } from "../types";

export function computeBackoffMs(attempt: number, capMs: number): number {
  const raw = 10000 * Math.pow(2, Math.max(attempt - 1, 0));
  return Math.min(raw, capMs);
}

export const CONTINUATION_RETRY_MS = 1000;

export interface ScheduleRetryOptions {
  issue_id: string;
  identifier: string;
  attempt: number;
  delayMs: number;
  error: string | null;
  onFire: () => void;
}

export function scheduleRetry(state: OrchestratorState, opts: ScheduleRetryOptions): void {
  cancelRetry(state, opts.issue_id);
  const handle = setTimeout(() => {
    state.retry_attempts.delete(opts.issue_id);
    opts.onFire();
  }, opts.delayMs);
  state.retry_attempts.set(opts.issue_id, {
    issue_id: opts.issue_id,
    identifier: opts.identifier,
    attempt: opts.attempt,
    due_at_ms: Date.now() + opts.delayMs,
    timer_handle: handle,
    error: opts.error,
  });
  state.claimed.add(opts.issue_id);
}

export function cancelRetry(state: OrchestratorState, issueId: string): void {
  const existing = state.retry_attempts.get(issueId);
  if (existing && existing.timer_handle) clearTimeout(existing.timer_handle);
  state.retry_attempts.delete(issueId);
}

export function releaseClaim(state: OrchestratorState, issueId: string): void {
  cancelRetry(state, issueId);
  state.claimed.delete(issueId);
}
