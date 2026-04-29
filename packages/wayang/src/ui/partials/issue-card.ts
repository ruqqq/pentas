import type { NormalizedIssue } from "../../domain/issue";
import { ALL_STATES } from "../../domain/issue";
import { escapeHtml } from "../layout";

export function renderIssueCard(issue: NormalizedIssue): string {
  const labels = issue.labels
    .map((l) => `<span class="label">${escapeHtml(l)}</span>`)
    .join("");
  const stateOptions = ALL_STATES.map(
    (s) => `<option value="${s}"${s === issue.state ? " selected" : ""}>${s}</option>`,
  ).join("");
  const prio =
    issue.priority != null
      ? `<span class="card-prio" title="Priority ${escapeHtml(String(issue.priority))}">P${escapeHtml(String(issue.priority))}</span>`
      : "";
  const labelStrip = labels ? `<div class="card-labels">${labels}</div>` : "";
  return `<article class="card" id="card-${escapeHtml(issue.id)}" data-state="${escapeHtml(issue.state)}">
  <div class="card-head">
    <a class="card-id" href="/issues/${escapeHtml(issue.id)}">${escapeHtml(issue.identifier)}</a>
    ${prio}
  </div>
  <a class="card-title" href="/issues/${escapeHtml(issue.id)}">${escapeHtml(issue.title)}</a>
  ${labelStrip}
  <div class="card-foot">
    <select aria-label="Move issue"
            hx-patch="/api/v1/issues/${escapeHtml(issue.id)}"
            hx-trigger="change"
            hx-vals='js:{state: event.target.value, actor: "user"}'
            hx-ext="json-enc"
            hx-swap="none">
      ${stateOptions}
    </select>
  </div>
</article>`;
}
