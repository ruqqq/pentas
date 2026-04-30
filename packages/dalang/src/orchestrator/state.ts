import type { OrchestratorState, RunningEntry } from "../types";

export interface InitialStateOptions {
  poll_interval_ms: number;
  max_concurrent_agents: number;
}

export function createInitialState(opts: InitialStateOptions): OrchestratorState {
  return {
    poll_interval_ms: opts.poll_interval_ms,
    max_concurrent_agents: opts.max_concurrent_agents,
    running: new Map(),
    claimed: new Set(),
    retry_attempts: new Map(),
    completed: new Set(),
    claude_totals: { input_tokens: 0, output_tokens: 0, total_tokens: 0, seconds_running: 0 },
    rate_limits: null,
    workflow_mtime: null,
    pr_checks_polls: new Map(),
  };
}

export function addRunning(state: OrchestratorState, issueId: string, entry: RunningEntry): void {
  state.running.set(issueId, entry);
  state.claimed.add(issueId);
}

export function removeRunning(state: OrchestratorState, issueId: string): RunningEntry | undefined {
  const entry = state.running.get(issueId);
  state.running.delete(issueId);
  state.claimed.delete(issueId);
  return entry;
}

export function availableSlots(state: OrchestratorState): number {
  return Math.max(state.max_concurrent_agents - state.running.size, 0);
}

export function accumulateTokens(
  state: OrchestratorState,
  usage: { input_tokens?: number; output_tokens?: number; total_tokens?: number },
): void {
  state.claude_totals.input_tokens += usage.input_tokens ?? 0;
  state.claude_totals.output_tokens += usage.output_tokens ?? 0;
  state.claude_totals.total_tokens += usage.total_tokens ?? 0;
}

export function countByState(state: OrchestratorState): Map<string, number> {
  const out = new Map<string, number>();
  for (const entry of state.running.values()) {
    const key = entry.issue.state.toLowerCase();
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}
