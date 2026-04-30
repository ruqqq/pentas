import type { HistoryEntry } from "../../domain/history";
import { escapeHtml } from "../layout";

export function renderHistoryItem(h: HistoryEntry): string {
  let line: string;
  switch (h.kind) {
    case "created":
      line = `created with state ${escapeHtml(h.to_value ?? "")}`;
      break;
    case "state_changed":
      line = `state ${escapeHtml(h.from_value ?? "")} → ${escapeHtml(h.to_value ?? "")}`;
      break;
    case "edited":
      line = "edited";
      break;
    case "comment_added":
      line = "comment added";
      break;
    case "deleted":
      line = "deleted";
      break;
  }
  return `<li><time>${escapeHtml(h.at)}</time> · <strong>${h.actor}</strong> ${line}</li>`;
}
