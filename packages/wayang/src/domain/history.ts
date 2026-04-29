export type HistoryKind = "created" | "state_changed" | "edited" | "comment_added" | "deleted";

export interface HistoryEntry {
  id: string;
  issue_id: string;
  kind: HistoryKind;
  from_value: string | null;
  to_value: string | null;
  actor: "user" | "agent";
  at: string;
}
