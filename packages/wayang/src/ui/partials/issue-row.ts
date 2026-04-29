import type { NormalizedIssue } from "../../domain/issue";
import { ALL_STATES } from "../../domain/issue";
import { escapeHtml } from "../layout";
import { renderStateBadge } from "./state-badge";

export function renderIssueRow(issue: NormalizedIssue): string {
  const labels = issue.labels.map((l) => `<span class="label">${escapeHtml(l)}</span>`).join(" ");
  const stateOptions = ALL_STATES.map(
    (s) => `<option value="${s}"${s === issue.state ? " selected" : ""}>${s}</option>`,
  ).join("");
  return `<tr id="row-${escapeHtml(issue.id)}">
  <td><a href="/issues/${escapeHtml(issue.id)}">${escapeHtml(issue.identifier)}</a></td>
  <td>${escapeHtml(issue.title)}</td>
  <td>${renderStateBadge(issue.state)}
    <select hx-patch="/api/v1/issues/${escapeHtml(issue.id)}"
            hx-trigger="change"
            hx-vals="js:{state: event.target.value, actor: 'user'}"
            hx-ext="json-enc"
            hx-swap="none">
      ${stateOptions}
    </select>
  </td>
  <td>${issue.priority ?? ""}</td>
  <td>${labels}</td>
  <td>${escapeHtml(issue.updated_at ?? "")}</td>
</tr>`;
}
