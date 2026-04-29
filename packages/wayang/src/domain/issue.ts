export type IssueState = "Todo" | "In Progress" | "In Review" | "Done" | "Cancelled";

export const ALL_STATES = [
  "Todo",
  "In Progress",
  "In Review",
  "Done",
  "Cancelled",
] as const satisfies readonly IssueState[];
export const ACTIVE_STATES = ["Todo", "In Progress"] as const satisfies readonly IssueState[];
export const TERMINAL_STATES = ["Done", "Cancelled"] as const satisfies readonly IssueState[];

export function isActive(s: string): boolean {
  return (ACTIVE_STATES as readonly string[]).includes(s);
}
export function isTerminal(s: string): boolean {
  return (TERMINAL_STATES as readonly string[]).includes(s);
}
export function isValidState(s: string): s is IssueState {
  return (ALL_STATES as readonly string[]).includes(s);
}

export interface NormalizedIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  priority: number | null;
  state: string;
  branch_name: string | null;
  url: string | null;
  labels: string[];
  blocked_by: { id: string | null; identifier: string | null; state: string | null }[];
  created_at: string | null;
  updated_at: string | null;
}
