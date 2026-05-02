// packages/dalang/src/orchestrator/eligibility.ts
import type { NormalizedIssue, OrchestratorState } from "../types";
import { availableSlots, countByState } from "./state";

export interface EligibilityRules {
  active: string[];
  terminal: string[];
  byState: Record<string, number>;
}

export function sortForDispatch(issues: NormalizedIssue[]): NormalizedIssue[] {
  const arr = [...issues];
  arr.sort((a, b) => {
    const pa = a.priority;
    const pb = b.priority;
    if (pa === null && pb !== null) return 1;
    if (pa !== null && pb === null) return -1;
    if (pa !== null && pb !== null && pa !== pb) return pa - pb;
    const ca = a.created_at ?? "";
    const cb = b.created_at ?? "";
    if (ca !== cb) return ca < cb ? -1 : 1;
    return a.identifier < b.identifier ? -1 : a.identifier > b.identifier ? 1 : 0;
  });
  return arr;
}

function inSet(s: string[], v: string): boolean {
  const lv = v.toLowerCase();
  return s.some((x) => x.toLowerCase() === lv);
}

export function isEligible(
  issue: NormalizedIssue,
  state: OrchestratorState,
  rules: EligibilityRules,
): boolean {
  if (!issue.id || !issue.identifier || !issue.title || !issue.state) return false;
  if (!inSet(rules.active, issue.state)) return false;
  if (inSet(rules.terminal, issue.state)) return false;
  if (state.completed.has(issue.id)) return false;
  if (state.running.has(issue.id) || state.claimed.has(issue.id)) return false;
  if (availableSlots(state) <= 0) return false;
  if (issue.state.toLowerCase() === "todo") {
    for (const b of issue.blocked_by) {
      if (b.state === null || !inSet(rules.terminal, b.state)) return false;
    }
  }
  const stateKey = issue.state.toLowerCase();
  const cap = rules.byState[stateKey];
  if (cap !== undefined) {
    const counts = countByState(state);
    if ((counts.get(stateKey) ?? 0) >= cap) return false;
  }
  return true;
}
