import { layout, escapeHtml } from "../layout";
import { renderStateBadge } from "../partials/state-badge";
import { renderComment } from "../partials/comment";
import { renderHistoryItem } from "../partials/history-item";
import { ALL_STATES, type NormalizedIssue } from "../../domain/issue";
import type { Comment } from "../../domain/comment";
import type { HistoryEntry } from "../../domain/history";

export interface DetailPageInput {
  issue: NormalizedIssue;
  comments: Comment[];
  history: HistoryEntry[];
}

export function renderDetailPage({ issue, comments, history }: DetailPageInput): string {
  const stateOptions = ALL_STATES.map(
    (s) => `<option value="${s}"${s === issue.state ? " selected" : ""}>${s}</option>`,
  ).join("");

  const labels = issue.labels.map((l) => `<span class="label">${escapeHtml(l)}</span>`).join(" ");
  const blockers = issue.blocked_by
    .map(
      (b) =>
        `<a href="/issues/${escapeHtml(b.id ?? "")}">${escapeHtml(b.identifier ?? "?")}</a> (${escapeHtml(b.state ?? "?")})`,
    )
    .join(", ");

  const commentList = comments.map(renderComment).join("\n");
  const historyList = history.map(renderHistoryItem).join("\n");

  const body = `
<article id="issue-${escapeHtml(issue.id)}"
         hx-ext="sse"
         sse-connect="/api/v1/events"
         sse-swap="issue.updated"
         hx-target="this">
  <header>
    <h1>${escapeHtml(issue.identifier)} ${escapeHtml(issue.title)}</h1>
    ${renderStateBadge(issue.state)}
    <select hx-patch="/api/v1/issues/${escapeHtml(issue.id)}"
            hx-trigger="change"
            hx-vals="js:{state: event.target.value, actor: 'user'}"
            hx-ext="json-enc"
            hx-swap="none">
      ${stateOptions}
    </select>
  </header>

  <aside>
    <dl>
      <dt>Priority</dt><dd>${issue.priority ?? "—"}</dd>
      <dt>Labels</dt><dd>${labels || "—"}</dd>
      <dt>Blockers</dt><dd>${blockers || "—"}</dd>
      <dt>External</dt><dd>${
        issue.url
          ? `<a href="${escapeHtml(issue.url)}" target="_blank" rel="noopener">link</a>`
          : "—"
      }</dd>
      <dt>Branch</dt><dd>${escapeHtml(issue.branch_name ?? "—")}</dd>
    </dl>
  </aside>

  <section class="description">
    <h2>Description</h2>
    <div class="markdown">${escapeHtml(issue.description ?? "")}</div>
  </section>

  <section id="comments">
    <h2>Comments</h2>
    <div sse-swap="comment.added" hx-swap="beforeend">
      ${commentList}
    </div>
    <form hx-post="/api/v1/issues/${escapeHtml(issue.id)}/comments"
          hx-ext="json-enc"
          hx-target="#comments > div"
          hx-swap="beforeend">
      <textarea name="body" required placeholder="Add a comment — markdown supported"></textarea>
      <button type="submit">Add comment</button>
    </form>
  </section>

  <section id="history">
    <h2>History</h2>
    <ol>${historyList}</ol>
  </section>
</article>`;
  return layout(`${issue.identifier} · ${issue.title}`, body);
}
