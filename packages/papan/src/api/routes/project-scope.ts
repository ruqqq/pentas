import type { Database } from "bun:sqlite";
import type { Project } from "../../domain/project";
import { DEFAULT_PROJECT_SLUG } from "../../domain/project";
import { getProjectBySlug } from "../../db/repo/projects";

export function projectSlugFromUrl(req: Request): string {
  return new URL(req.url).searchParams.get("project") ?? DEFAULT_PROJECT_SLUG;
}

export function resolveProject(db: Database, slug: string): Project | Response {
  const project = getProjectBySlug(db, slug);
  if (!project) return Response.json({ error: { code: "project_not_found" } }, { status: 404 });
  return project;
}

export function isResponse(value: Project | Response): value is Response {
  return value instanceof Response;
}

export function eventProject(project: Project): { id: string; slug: string } {
  return { id: project.id, slug: project.slug };
}
