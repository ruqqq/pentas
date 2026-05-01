export type StatusKind = "dispatchable" | "waiting" | "terminal";

export const STATUS_KINDS: readonly StatusKind[] = ["dispatchable", "waiting", "terminal"];

export function isStatusKind(s: string): s is StatusKind {
  return (STATUS_KINDS as readonly string[]).includes(s);
}

export interface ProjectStatus {
  name: string;
  position: number;
  kind: StatusKind;
}

export const DEFAULT_STATUSES: readonly ProjectStatus[] = [
  { name: "Todo", position: 0, kind: "dispatchable" },
  { name: "Plan", position: 1, kind: "dispatchable" },
  { name: "Review Plan", position: 2, kind: "dispatchable" },
  { name: "Ready for Dev", position: 3, kind: "dispatchable" },
  { name: "In Dev", position: 4, kind: "dispatchable" },
  { name: "Ready for Review", position: 5, kind: "dispatchable" },
  { name: "Ready for QA", position: 6, kind: "dispatchable" },
  { name: "In QA", position: 7, kind: "dispatchable" },
  { name: "Waiting PR Checks", position: 8, kind: "waiting" },
  { name: "Ready for Human Review", position: 9, kind: "waiting" },
  { name: "Done", position: 10, kind: "terminal" },
  { name: "Cancelled", position: 11, kind: "terminal" },
];

export function isDispatchable(s: ProjectStatus): boolean {
  return s.kind === "dispatchable";
}
export function isWaiting(s: ProjectStatus): boolean {
  return s.kind === "waiting";
}
export function isTerminal(s: ProjectStatus): boolean {
  return s.kind === "terminal";
}
