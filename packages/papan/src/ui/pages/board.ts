import { layout, escapeHtml } from "../layout";
import { renderIssueCard } from "../partials/issue-card";
import type { NormalizedIssue } from "../../domain/issue";
import type { Project } from "../../domain/project";
import { DEFAULT_PROJECT_SLUG } from "../../domain/project";
import type { ProjectStatus } from "../../domain/status";

export interface BoardPageInput {
  issues: NormalizedIssue[];
  q: string;
  statuses: ProjectStatus[];
  project?: Project;
  projects?: Project[];
}

const UNKNOWN_COLUMN = "Unknown";

export function renderBoardPage({
  issues,
  q,
  statuses,
  project,
  projects = [],
}: BoardPageInput): string {
  const heading = project
    ? `<header class="page-title"><h1>${escapeHtml(project.name)}</h1><code>${escapeHtml(project.slug)}</code></header>`
    : "";
  return layout(
    "Board",
    heading +
      boardChrome(q, project?.slug ?? DEFAULT_PROJECT_SLUG) +
      renderBoardGrid({ issues, q, statuses, project }),
    { projects, activeProject: project ?? null },
  );
}

export function renderBoardGrid({ issues, q, statuses, project }: BoardPageInput): string {
  const buckets = new Map<string, NormalizedIssue[]>();
  for (const s of statuses) buckets.set(s.name, []);
  const unknownBucket: NormalizedIssue[] = [];
  for (const i of issues) {
    const arr = buckets.get(i.state);
    if (arr) arr.push(i);
    else unknownBucket.push(i);
  }

  const statusNames = statuses.map((s) => s.name);
  const projectSlugForLinks = project?.slug ?? issues[0]?.project?.slug ?? DEFAULT_PROJECT_SLUG;
  const statusesHref = `/projects/${encodeURIComponent(projectSlugForLinks)}/statuses`;
  const renderCol = (
    name: string,
    list: NormalizedIssue[],
    opts: { extraClass?: string; headerHref?: string } = {},
  ): string => {
    const cards =
      list.length === 0
        ? `<p class="kempty">No issues</p>`
        : list
            .map((issue) => renderIssueCard(issue, issue.project?.slug, statusNames))
            .join("\n");
    const badge = `<span class="state-badge" data-state="${escapeHtml(name)}">${escapeHtml(name)}</span>`;
    const header = opts.headerHref
      ? `<a class="kunknown-link" href="${escapeAttr(opts.headerHref)}" title="Configure statuses">${badge}</a>`
      : badge;
    return `<section class="kcol${opts.extraClass ?? ""}" data-state="${escapeHtml(name)}">
  <header class="khead">
    ${header}
    <span class="kcount">${list.length}</span>
  </header>
  <div class="kbody">
${cards}
  </div>
</section>`;
  };

  const cols = statuses.map((s) => renderCol(s.name, buckets.get(s.name) ?? [])).join("\n");
  const unknownCol =
    unknownBucket.length > 0
      ? renderCol(UNKNOWN_COLUMN, unknownBucket, {
          extraClass: " kcol-unknown",
          headerHref: statusesHref,
        })
      : "";

  const projectSlug = project?.slug ?? issues[0]?.project?.slug ?? DEFAULT_PROJECT_SLUG;
  const refreshUrl =
    projectSlug === DEFAULT_PROJECT_SLUG
      ? `/partials/board?q=${encodeURIComponent(q)}`
      : `/projects/${encodeURIComponent(projectSlug)}/partials/board?q=${encodeURIComponent(q)}`;
  return `<div id="board" class="board"
       hx-get="${escapeAttr(refreshUrl)}"
       data-project-scope="${escapeAttr(projectSlug)}"
       hx-trigger="sse:issue.created,sse:issue.updated,sse:state.changed,sse:issue.deleted"
       hx-swap="outerHTML">
${cols}
${unknownCol}
</div>`;
}

function boardChrome(q: string, projectSlug: string): string {
  const action =
    projectSlug === DEFAULT_PROJECT_SLUG ? "/" : `/projects/${encodeURIComponent(projectSlug)}`;
  const statusesHref =
    projectSlug === DEFAULT_PROJECT_SLUG
      ? `/projects/${encodeURIComponent(DEFAULT_PROJECT_SLUG)}/statuses`
      : `/projects/${encodeURIComponent(projectSlug)}/statuses`;
  return `
<form method="get" action="${escapeAttr(action)}" class="filters board-filters">
  <input type="search" name="q" value="${escapeAttr(q)}" placeholder="Search issues">
  <button type="submit">Filter</button>
  <a class="board-manage" href="${escapeAttr(statusesHref)}">Manage statuses</a>
</form>`;
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
