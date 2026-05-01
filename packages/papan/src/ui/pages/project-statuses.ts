import { layout, escapeHtml } from "../layout";
import type { Project } from "../../domain/project";
import type { ProjectStatus } from "../../domain/status";
import { STATUS_KINDS } from "../../domain/status";

export interface ProjectStatusesPageInput {
  project: Project;
  statuses: ProjectStatus[];
  inUse: Set<string>;
  error?: string;
  projects?: Project[];
}

export function renderProjectStatusesPage(input: ProjectStatusesPageInput): string {
  return layout(`Statuses · ${input.project.name}`, renderProjectStatusesBody(input), {
    projects: input.projects ?? [],
    activeProject: input.project,
  });
}

export function renderProjectStatusesBody(input: ProjectStatusesPageInput): string {
  const { project, statuses, inUse, error } = input;
  return `
<header class="page-title">
  <h1>${escapeHtml(project.name)} · Statuses</h1>
  <a href="/projects/${escapeHtml(project.slug)}">Back to board</a>
</header>
${error ? `<div class="error">${escapeHtml(error)}</div>` : ""}
<section id="statuses-table">
  ${renderTable(project, statuses, inUse)}
</section>
<section class="status-add">
  <h2>Add status</h2>
  <form hx-post="/ui/projects/${escapeHtml(project.slug)}/statuses"
        hx-target="#statuses-table"
        hx-swap="outerHTML">
    <label>Name
      <input type="text" name="name" required>
    </label>
    <label>Kind
      <select name="kind">
        ${STATUS_KINDS.map((k) => `<option value="${k}">${k}</option>`).join("")}
      </select>
    </label>
    <button type="submit">Add</button>
  </form>
</section>`;
}

export function renderStatusesTablePartial(
  project: Project,
  statuses: ProjectStatus[],
  inUse: Set<string>,
): string {
  return `<section id="statuses-table">${renderTable(project, statuses, inUse)}</section>`;
}

function renderTable(project: Project, statuses: ProjectStatus[], inUse: Set<string>): string {
  if (statuses.length === 0) {
    return `<p>No statuses configured. Add one below.</p>`;
  }
  const rows = statuses
    .map((s, idx) => renderRow(project, s, idx, statuses.length, inUse.has(s.name)))
    .join("");
  return `<table class="statuses">
  <thead><tr><th>Order</th><th>Name</th><th>Kind</th><th>Actions</th></tr></thead>
  <tbody>${rows}</tbody>
</table>`;
}

function renderRow(
  project: Project,
  s: ProjectStatus,
  idx: number,
  total: number,
  inUse: boolean,
): string {
  const slug = escapeHtml(project.slug);
  const name = escapeHtml(s.name);
  const targetSel = "#statuses-table";
  const moveUp =
    idx > 0
      ? `<button hx-post="/ui/projects/${slug}/statuses/${name}/move?dir=up" hx-target="${targetSel}" hx-swap="outerHTML">↑</button>`
      : "";
  const moveDown =
    idx < total - 1
      ? `<button hx-post="/ui/projects/${slug}/statuses/${name}/move?dir=down" hx-target="${targetSel}" hx-swap="outerHTML">↓</button>`
      : "";
  const renameForm = `<form class="inline" hx-post="/ui/projects/${slug}/statuses/${name}/rename" hx-target="${targetSel}" hx-swap="outerHTML">
    <input type="text" name="name" value="${name}">
    <button type="submit">Rename</button>
  </form>`;
  const kindForm = `<form class="inline" hx-post="/ui/projects/${slug}/statuses/${name}/kind" hx-target="${targetSel}" hx-swap="outerHTML">
    <select name="kind">${STATUS_KINDS.map(
      (k) => `<option value="${k}"${k === s.kind ? " selected" : ""}>${k}</option>`,
    ).join("")}</select>
    <button type="submit">Save</button>
  </form>`;
  const deleteBtn = inUse
    ? `<button disabled title="Status is in use by one or more issues">Delete</button>`
    : `<button hx-delete="/ui/projects/${slug}/statuses/${name}" hx-target="${targetSel}" hx-swap="outerHTML" hx-confirm="Delete status '${name}'?">Delete</button>`;
  return `<tr data-status="${name}">
    <td class="order">${moveUp}${moveDown}</td>
    <td>${renameForm}</td>
    <td>${kindForm}</td>
    <td class="actions">${deleteBtn}</td>
  </tr>`;
}
