import type { ProjectSummary } from "../../db/repo/projects";
import type { Project } from "../../domain/project";
import { layout, escapeHtml } from "../layout";

export function renderProjectsPage(projects: ProjectSummary[]): string {
  const rows = projects
    .map(
      (p) => `<tr>
  <td><a href="/projects/${escapeHtml(p.slug)}">${escapeHtml(p.name)}</a></td>
  <td><code>${escapeHtml(p.slug)}</code></td>
  <td>${p.issue_count}</td>
  <td>${p.active_issue_count}</td>
  <td>${escapeHtml(p.last_issue_updated_at ?? "-")}</td>
  <td><a href="/projects/${escapeHtml(p.slug)}/statuses">Statuses</a></td>
</tr>`,
    )
    .join("\n");
  return layout(
    "Projects",
    `<section class="projects-index">
  <header class="page-title">
    <h1>Projects</h1>
    <a href="/projects/new">New project</a>
  </header>
  <table>
    <thead><tr><th>Name</th><th>Slug</th><th>Issues</th><th>Active</th><th>Last updated</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</section>`,
    { projects },
  );
}

export function renderNewProjectPage(
  values: { error?: string; slug?: string; name?: string } = {},
): string {
  return layout(
    "New project",
    `${values.error ? `<div class="error">${escapeHtml(values.error)}</div>` : ""}
<form method="post" action="/projects/new">
  <label>Slug
    <input type="text" name="slug" required value="${escapeHtml(values.slug ?? "")}">
  </label>
  <label>Name
    <input type="text" name="name" required value="${escapeHtml(values.name ?? "")}">
  </label>
  <label>Description
    <textarea name="description"></textarea>
  </label>
  <button type="submit">Create project</button>
</form>`,
  );
}

export function renderProjectNotFound(slug: string, projects: Project[]): string {
  return layout(
    "Project not found",
    `<section class="empty-state">
  <h1>Project not found</h1>
  <p><code>${escapeHtml(slug)}</code></p>
  <a href="/projects">Projects</a>
</section>`,
    { projects },
  );
}
