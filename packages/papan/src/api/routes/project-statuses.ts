import { URLPattern } from "urlpattern-polyfill";
import { getProjectBySlug } from "../../db/repo/projects";
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
} from "../../db/repo/project-statuses";
import { isStatusKind, type StatusKind } from "../../domain/status";
import type { Route } from "../server";

function projectNotFound(): Response {
  return Response.json({ error: { code: "project_not_found" } }, { status: 404 });
}

export function projectStatusesListRoute(): Route {
  return {
    method: "GET",
    pattern: new URLPattern({ pathname: "/api/v1/projects/:slug/statuses" }),
    handler: (_req, match, { db }) => {
      const project = getProjectBySlug(db, match.pathname.groups.slug!);
      if (!project) return projectNotFound();
      return Response.json({ statuses: listStatuses(db, project.id) });
    },
  };
}

interface AddBody {
  name?: unknown;
  kind?: unknown;
  position?: unknown;
}

export function projectStatusesCreateRoute(): Route {
  return {
    method: "POST",
    pattern: new URLPattern({ pathname: "/api/v1/projects/:slug/statuses" }),
    handler: async (req, match, { db }) => {
      const project = getProjectBySlug(db, match.pathname.groups.slug!);
      if (!project) return projectNotFound();
      let body: AddBody;
      try {
        body = (await req.json()) as AddBody;
      } catch {
        return Response.json({ error: { code: "bad_json" } }, { status: 400 });
      }
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) {
        return Response.json(
          { error: { code: "missing_field", fields: ["name"] } },
          { status: 400 },
        );
      }
      if (typeof body.kind !== "string" || !isStatusKind(body.kind)) {
        return Response.json(
          { error: { code: "invalid_kind", fields: ["kind"] } },
          { status: 400 },
        );
      }
      const position =
        typeof body.position === "number" && Number.isInteger(body.position) && body.position >= 0
          ? body.position
          : undefined;
      try {
        const status = addStatus(db, project.id, { name, kind: body.kind, position });
        return Response.json(status, { status: 201 });
      } catch (err) {
        if (err instanceof StatusExistsError) {
          return Response.json({ error: { code: "status_exists" } }, { status: 409 });
        }
        throw err;
      }
    },
  };
}

interface PatchBody {
  name?: unknown;
  kind?: unknown;
}

export function projectStatusesUpdateRoute(): Route {
  return {
    method: "PATCH",
    pattern: new URLPattern({ pathname: "/api/v1/projects/:slug/statuses/:name" }),
    handler: async (req, match, { db }) => {
      const project = getProjectBySlug(db, match.pathname.groups.slug!);
      if (!project) return projectNotFound();
      const oldName = decodeURIComponent(match.pathname.groups.name!);
      let body: PatchBody;
      try {
        body = (await req.json()) as PatchBody;
      } catch {
        return Response.json({ error: { code: "bad_json" } }, { status: 400 });
      }

      // Validate everything before mutating so an invalid `kind` can't slip through
      // after a successful rename has already committed.
      let trimmedNewName: string | null = null;
      if (body.name !== undefined) {
        if (typeof body.name !== "string" || body.name.trim() === "") {
          return Response.json(
            { error: { code: "invalid_name", fields: ["name"] } },
            { status: 400 },
          );
        }
        const trimmed = body.name.trim();
        if (trimmed !== oldName) trimmedNewName = trimmed;
      }
      let kind: StatusKind | null = null;
      if (body.kind !== undefined) {
        if (typeof body.kind !== "string" || !isStatusKind(body.kind)) {
          return Response.json(
            { error: { code: "invalid_kind", fields: ["kind"] } },
            { status: 400 },
          );
        }
        kind = body.kind;
      }

      try {
        let currentName = oldName;
        if (trimmedNewName) {
          const renamed = renameStatus(db, project.id, oldName, trimmedNewName);
          currentName = renamed.name;
        }
        if (kind) updateStatusKind(db, project.id, currentName, kind);
        return Response.json({ statuses: listStatuses(db, project.id) });
      } catch (err) {
        if (err instanceof StatusNotFoundError) {
          return Response.json({ error: { code: "status_not_found" } }, { status: 404 });
        }
        if (err instanceof StatusExistsError) {
          return Response.json({ error: { code: "status_exists" } }, { status: 409 });
        }
        throw err;
      }
    },
  };
}

export function projectStatusesDeleteRoute(): Route {
  return {
    method: "DELETE",
    pattern: new URLPattern({ pathname: "/api/v1/projects/:slug/statuses/:name" }),
    handler: (_req, match, { db }) => {
      const project = getProjectBySlug(db, match.pathname.groups.slug!);
      if (!project) return projectNotFound();
      const name = decodeURIComponent(match.pathname.groups.name!);
      try {
        deleteStatus(db, project.id, name);
        return new Response(null, { status: 204 });
      } catch (err) {
        if (err instanceof StatusNotFoundError) {
          return Response.json({ error: { code: "status_not_found" } }, { status: 404 });
        }
        if (err instanceof StatusInUseError) {
          return Response.json({ error: { code: "status_in_use" } }, { status: 409 });
        }
        throw err;
      }
    },
  };
}

interface ReorderBody {
  order?: unknown;
}

export function projectStatusesReorderRoute(): Route {
  return {
    method: "POST",
    pattern: new URLPattern({ pathname: "/api/v1/projects/:slug/statuses/reorder" }),
    handler: async (req, match, { db }) => {
      const project = getProjectBySlug(db, match.pathname.groups.slug!);
      if (!project) return projectNotFound();
      let body: ReorderBody;
      try {
        body = (await req.json()) as ReorderBody;
      } catch {
        return Response.json({ error: { code: "bad_json" } }, { status: 400 });
      }
      if (!Array.isArray(body.order) || !body.order.every((n) => typeof n === "string")) {
        return Response.json(
          { error: { code: "invalid_order", fields: ["order"] } },
          { status: 400 },
        );
      }
      try {
        const after = reorderStatuses(db, project.id, body.order as string[]);
        return Response.json({ statuses: after });
      } catch (err) {
        if (err instanceof StatusReorderMismatchError) {
          return Response.json({ error: { code: "reorder_mismatch" } }, { status: 400 });
        }
        throw err;
      }
    },
  };
}
