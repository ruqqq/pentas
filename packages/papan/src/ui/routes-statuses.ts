import { URLPattern } from "urlpattern-polyfill";
import type { Database } from "bun:sqlite";
import type { Route } from "../api/server";
import {
  StatusExistsError,
  StatusInUseError,
  StatusNotFoundError,
  StatusReorderMismatchError,
  addStatus,
  deleteStatus,
  listStatuses,
  renameStatus,
  reorderStatuses,
  updateStatusKind,
} from "../db/repo/project-statuses";
import { listProjects } from "../db/repo/projects";
import { isStatusKind } from "../domain/status";
import type { Project } from "../domain/project";
import { html, isResponse, resolveUiProject } from "./route-helpers";
import {
  renderProjectStatusesPage,
  renderStatusesTablePartial,
} from "./pages/project-statuses";

function inUseSet(db: Database, projectId: string): Set<string> {
  const rows = db
    .query<{ state: string }, [string]>("SELECT DISTINCT state FROM issues WHERE project_id = ?")
    .all(projectId);
  return new Set(rows.map((r) => r.state));
}

function tablePartial(db: Database, project: Project): Response {
  return html(
    renderStatusesTablePartial(project, listStatuses(db, project.id), inUseSet(db, project.id)),
  );
}

export function uiProjectStatusesRoute(): Route {
  return {
    method: "GET",
    pattern: new URLPattern({ pathname: "/projects/:slug/statuses" }),
    handler: (_req, match, { db }) => {
      const project = resolveUiProject(db, match.pathname.groups.slug!);
      if (isResponse(project)) return project;
      return html(
        renderProjectStatusesPage({
          project,
          statuses: listStatuses(db, project.id),
          inUse: inUseSet(db, project.id),
          projects: listProjects(db),
        }),
      );
    },
  };
}

export function uiProjectStatusesAddRoute(): Route {
  return {
    method: "POST",
    pattern: new URLPattern({ pathname: "/ui/projects/:slug/statuses" }),
    handler: async (req, match, { db }) => {
      const project = resolveUiProject(db, match.pathname.groups.slug!);
      if (isResponse(project)) return project;
      const form = await req.formData();
      const name = String(form.get("name") ?? "").trim();
      const kind = String(form.get("kind") ?? "");
      if (!name || !isStatusKind(kind)) return html("Bad request", 400);
      try {
        addStatus(db, project.id, { name, kind });
      } catch (err) {
        if (err instanceof StatusExistsError) return html("Status already exists", 409);
        throw err;
      }
      return tablePartial(db, project);
    },
  };
}

export function uiProjectStatusesRenameRoute(): Route {
  return {
    method: "POST",
    pattern: new URLPattern({ pathname: "/ui/projects/:slug/statuses/:name/rename" }),
    handler: async (req, match, { db }) => {
      const project = resolveUiProject(db, match.pathname.groups.slug!);
      if (isResponse(project)) return project;
      const oldName = decodeURIComponent(match.pathname.groups.name!);
      const form = await req.formData();
      const newName = String(form.get("name") ?? "").trim();
      if (!newName) return html("Name required", 400);
      try {
        renameStatus(db, project.id, oldName, newName);
      } catch (err) {
        if (err instanceof StatusNotFoundError) return html("Not found", 404);
        if (err instanceof StatusExistsError) return html("Name already exists", 409);
        throw err;
      }
      return tablePartial(db, project);
    },
  };
}

export function uiProjectStatusesKindRoute(): Route {
  return {
    method: "POST",
    pattern: new URLPattern({ pathname: "/ui/projects/:slug/statuses/:name/kind" }),
    handler: async (req, match, { db }) => {
      const project = resolveUiProject(db, match.pathname.groups.slug!);
      if (isResponse(project)) return project;
      const name = decodeURIComponent(match.pathname.groups.name!);
      const form = await req.formData();
      const kind = String(form.get("kind") ?? "");
      if (!isStatusKind(kind)) return html("Bad kind", 400);
      try {
        updateStatusKind(db, project.id, name, kind);
      } catch (err) {
        if (err instanceof StatusNotFoundError) return html("Not found", 404);
        throw err;
      }
      return tablePartial(db, project);
    },
  };
}

export function uiProjectStatusesMoveRoute(): Route {
  return {
    method: "POST",
    pattern: new URLPattern({ pathname: "/ui/projects/:slug/statuses/:name/move" }),
    handler: (req, match, { db }) => {
      const project = resolveUiProject(db, match.pathname.groups.slug!);
      if (isResponse(project)) return project;
      const name = decodeURIComponent(match.pathname.groups.name!);
      const url = new URL(req.url);
      const dir = url.searchParams.get("dir");
      const current = listStatuses(db, project.id);
      const idx = current.findIndex((s) => s.name === name);
      if (idx < 0) return html("Not found", 404);
      const target = dir === "up" ? idx - 1 : idx + 1;
      if (target < 0 || target >= current.length) return tablePartial(db, project);
      const reordered = [...current];
      const tmp = reordered[idx]!;
      reordered[idx] = reordered[target]!;
      reordered[target] = tmp;
      try {
        reorderStatuses(
          db,
          project.id,
          reordered.map((s) => s.name),
        );
      } catch (err) {
        if (err instanceof StatusReorderMismatchError) return html("Mismatch", 400);
        throw err;
      }
      return tablePartial(db, project);
    },
  };
}

export function uiProjectStatusesDeleteRoute(): Route {
  return {
    method: "DELETE",
    pattern: new URLPattern({ pathname: "/ui/projects/:slug/statuses/:name" }),
    handler: (_req, match, { db }) => {
      const project = resolveUiProject(db, match.pathname.groups.slug!);
      if (isResponse(project)) return project;
      const name = decodeURIComponent(match.pathname.groups.name!);
      try {
        deleteStatus(db, project.id, name);
      } catch (err) {
        if (err instanceof StatusNotFoundError) return html("Not found", 404);
        if (err instanceof StatusInUseError) return html("Status in use", 409);
        throw err;
      }
      return tablePartial(db, project);
    },
  };
}
