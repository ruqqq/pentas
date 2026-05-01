import { URLPattern } from "urlpattern-polyfill";
import { createProject, getProjectBySlug, listProjectSummaries } from "../../db/repo/projects";
import { isValidProjectSlug } from "../../domain/project";
import type { Route } from "../server";

interface CreateProjectBody {
  slug?: unknown;
  name?: unknown;
  description?: unknown;
}

export function projectsListRoute(): Route {
  return {
    method: "GET",
    pattern: new URLPattern({ pathname: "/api/v1/projects" }),
    handler: (_req, _match, { db }) => Response.json({ projects: listProjectSummaries(db) }),
  };
}

export function projectsCreateRoute(): Route {
  return {
    method: "POST",
    pattern: new URLPattern({ pathname: "/api/v1/projects" }),
    handler: async (req, _match, { db }) => {
      let body: CreateProjectBody;
      try {
        body = (await req.json()) as CreateProjectBody;
      } catch {
        return Response.json({ error: { code: "bad_json" } }, { status: 400 });
      }
      const slug = typeof body.slug === "string" ? body.slug.trim().toLowerCase() : "";
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!isValidProjectSlug(slug)) {
        return Response.json({ error: { code: "invalid_project_slug" } }, { status: 400 });
      }
      if (!name) {
        return Response.json(
          { error: { code: "missing_field", fields: ["name"] } },
          { status: 400 },
        );
      }
      try {
        const project = createProject(db, {
          slug,
          name,
          description: typeof body.description === "string" ? body.description : null,
        });
        return Response.json(project, { status: 201 });
      } catch (err) {
        if (err instanceof Error && err.message.includes("UNIQUE")) {
          return Response.json({ error: { code: "project_exists" } }, { status: 409 });
        }
        throw err;
      }
    },
  };
}

export function projectsDetailRoute(): Route {
  return {
    method: "GET",
    pattern: new URLPattern({ pathname: "/api/v1/projects/:slug" }),
    handler: (_req, match, { db }) => {
      const project = getProjectBySlug(db, match.pathname.groups.slug!);
      if (!project) {
        return Response.json({ error: { code: "project_not_found" } }, { status: 404 });
      }
      return Response.json(project);
    },
  };
}
