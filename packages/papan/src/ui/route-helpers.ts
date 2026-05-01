import type { Database } from "bun:sqlite";
import { getProjectBySlug, listProjects } from "../db/repo/projects";
import type { Project } from "../domain/project";
import { renderProjectNotFound } from "./pages/projects";

export function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

export function isResponse(value: Project | Response): value is Response {
  return value instanceof Response;
}

export function resolveUiProject(db: Database, slug: string): Project | Response {
  const project = getProjectBySlug(db, slug);
  if (!project) {
    return new Response(renderProjectNotFound(slug, listProjects(db)), {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  return project;
}
