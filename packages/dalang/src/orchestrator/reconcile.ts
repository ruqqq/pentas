import type { NormalizedIssue, OrchestratorState } from "../types";

export function detectStalls(state: OrchestratorState, stallTimeoutMs: number): string[] {
  if (stallTimeoutMs <= 0) return [];
  const now = Date.now();
  const out: string[] = [];
  for (const [id, entry] of state.running.entries()) {
    const last = entry.session?.last_event_at ?? entry.started_at;
    const ts = Date.parse(last);
    if (Number.isNaN(ts)) continue;
    if (now - ts > stallTimeoutMs) out.push(id);
  }
  return out;
}

export type RefreshClassification =
  | { kind: "terminate_with_cleanup" }
  | { kind: "terminate_no_cleanup" }
  | { kind: "update_snapshot" };

export interface RefreshRules {
  active: string[];
  terminal: string[];
}

function inSet(set: string[], v: string): boolean {
  const lv = v.toLowerCase();
  return set.some((x) => x.toLowerCase() === lv);
}

export function classifyTrackerRefresh(
  issue: NormalizedIssue,
  rules: RefreshRules,
): RefreshClassification {
  if (inSet(rules.terminal, issue.state)) return { kind: "terminate_with_cleanup" };
  if (inSet(rules.active, issue.state)) return { kind: "update_snapshot" };
  return { kind: "terminate_no_cleanup" };
}
