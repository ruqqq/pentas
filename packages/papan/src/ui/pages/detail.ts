import { layout, escapeHtml } from "../layout";
import { renderStateBadge } from "../partials/state-badge";
import { renderComment } from "../partials/comment";
import { renderHistoryItem } from "../partials/history-item";
import { ALL_STATES, type NormalizedIssue } from "../../domain/issue";
import type { Project } from "../../domain/project";
import { DEFAULT_PROJECT_SLUG } from "../../domain/project";
import type { Comment } from "../../domain/comment";
import type { HistoryEntry } from "../../domain/history";

export interface DetailPageInput {
  issue: NormalizedIssue;
  comments: Comment[];
  history: HistoryEntry[];
  project?: Project;
  projects?: Project[];
}

export function renderDetailPage({
  issue,
  comments,
  history,
  project,
  projects = [],
}: DetailPageInput): string {
  const stateOptions = ALL_STATES.map(
    (s) => `<option value="${s}"${s === issue.state ? " selected" : ""}>${s}</option>`,
  ).join("");

  const labels = issue.labels.map((l) => `<span class="label">${escapeHtml(l)}</span>`).join(" ");
  const blockers = issue.blocked_by
    .map(
      (b) =>
        `<a href="${issuePath(b.id ?? "", project?.slug)}">${escapeHtml(b.identifier ?? "?")}</a> (${escapeHtml(b.state ?? "?")})`,
    )
    .join(", ");

  const commentList = comments.map(renderComment).join("\n");
  const historyList = history.map(renderHistoryItem).join("\n");

  const detailUrl = issuePath(issue.id, project?.slug);
  const apiProject = project ? `?project=${escapeHtml(project.slug)}` : "";
  const articleSelector = `#issue-${escapeHtml(issue.id)}`;
  const body = `
<article id="issue-${escapeHtml(issue.id)}"
         hx-get="${detailUrl}"
         data-project-scope="${escapeHtml(project?.slug ?? DEFAULT_PROJECT_SLUG)}"
         hx-trigger="sse:issue.updated"
         hx-select="${articleSelector}"
         hx-swap="outerHTML">
  <header>
    <h1>${escapeHtml(issue.identifier)} ${escapeHtml(issue.title)}</h1>
    ${
      issue.internal_ref && issue.internal_ref !== issue.identifier
        ? `<span class="card-internal" title="Internal ID">${escapeHtml(issue.internal_ref)}</span>`
        : ""
    }
    ${renderStateBadge(issue.state)}
    <select hx-patch="/api/v1/issues/${escapeHtml(issue.id)}${apiProject}"
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
    <div id="comments-list"
         hx-get="${detailUrl}"
         hx-trigger="sse:comment.added"
         hx-select="#comments-list"
         hx-swap="outerHTML">
      ${commentList}
    </div>
    <form hx-post="/api/v1/issues/${escapeHtml(issue.id)}/comments${apiProject}"
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
  return layout(`${issue.identifier} · ${issue.title}`, body, {
    projects,
    activeProject: project ?? null,
  });
}

function issuePath(id: string, projectSlug?: string): string {
  return projectSlug && projectSlug !== DEFAULT_PROJECT_SLUG
    ? `/projects/${escapeHtml(projectSlug)}/issues/${escapeHtml(id)}`
    : `/issues/${escapeHtml(id)}`;
}
