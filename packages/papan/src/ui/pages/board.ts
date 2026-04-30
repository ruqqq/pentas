import { layout, escapeHtml } from "../layout";
import { renderIssueCard } from "../partials/issue-card";
import { ALL_STATES } from "../../domain/issue";
import type { NormalizedIssue } from "../../domain/issue";

export interface BoardPageInput {
  issues: NormalizedIssue[];
  q: string;
}

export function renderBoardPage({ issues, q }: BoardPageInput): string {
  return layout("Board", boardChrome(q) + renderBoardGrid({ issues, q }));
}

export function renderBoardGrid({ issues, q }: BoardPageInput): string {
  const buckets = new Map<string, NormalizedIssue[]>();
  for (const s of ALL_STATES) buckets.set(s, []);
  for (const i of issues) {
    const arr = buckets.get(i.state);
    if (arr) arr.push(i);
  }

  const cols = ALL_STATES.map((s) => {
    const list = buckets.get(s) ?? [];
    const cards =
      list.length === 0 ? `<p class="kempty">No issues</p>` : list.map(renderIssueCard).join("\n");
    return `<section class="kcol" data-state="${s}">
  <header class="khead">
    <span class="state-badge" data-state="${s}">${s}</span>
    <span class="kcount">${list.length}</span>
  </header>
  <div class="kbody">
${cards}
  </div>
</section>`;
  }).join("\n");

  const refreshUrl = `/partials/board?q=${encodeURIComponent(q)}`;
  return `<div id="board" class="board"
       hx-get="${escapeAttr(refreshUrl)}"
       hx-trigger="sse:issue.created,sse:issue.updated,sse:state.changed,sse:issue.deleted"
       hx-swap="outerHTML">
${cols}
</div>`;
}

function boardChrome(q: string): string {
  return `
<form method="get" action="/" class="filters board-filters">
  <input type="search" name="q" value="${escapeAttr(q)}" placeholder="Search issues">
  <button type="submit">Filter</button>
</form>`;
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
