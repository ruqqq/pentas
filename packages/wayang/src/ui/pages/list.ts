import { layout } from "../layout";
import { renderIssueRow } from "../partials/issue-row";
import { ACTIVE_STATES, ALL_STATES, TERMINAL_STATES } from "../../domain/issue";
import type { NormalizedIssue } from "../../domain/issue";

export interface ListPageInput {
  issues: NormalizedIssue[];
  selectedStates: string[];
  q: string;
}

export function renderListPage({ issues, selectedStates, q }: ListPageInput): string {
  const stateChips = ALL_STATES.map((s) => {
    const checked = selectedStates.includes(s) ? " checked" : "";
    return `<label><input type="checkbox" name="state" value="${s}"${checked}> ${s}</label>`;
  }).join(" ");

  const rows = issues.map(renderIssueRow).join("\n");

  const body = `
<form method="get" action="/" class="filters">
  <input type="search" name="q" value="${q}" placeholder="Search issues">
  <fieldset><legend>State</legend>${stateChips}</fieldset>
  <button type="submit">Filter</button>
  <a href="/?state=${ACTIVE_STATES.join("&state=")}">Active</a>
  <a href="/?state=${TERMINAL_STATES.join("&state=")}">Terminal</a>
</form>
<table>
<thead><tr><th>ID</th><th>Title</th><th>State</th><th>Priority</th><th>Labels</th><th>Updated</th></tr></thead>
<tbody id="issues-tbody"
       sse-swap="issue.created,issue.updated,state.changed,issue.deleted"
       hx-get="/partials/issues?${selectedStates.map((s) => `state=${encodeURIComponent(s)}`).join("&")}&q=${encodeURIComponent(q)}"
       hx-trigger="sse:issue.created,sse:issue.updated,sse:state.changed,sse:issue.deleted">
${rows}
</tbody>
</table>`;
  return layout("Issues", body);
}
