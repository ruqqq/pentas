import { URLPattern } from "urlpattern-polyfill";
import { getIssueById, deleteIssue } from "../../db/repo/issues";
import type { Route } from "../server";
import { eventProject, isResponse, projectSlugFromUrl, resolveProject } from "./project-scope";

export function issuesDeleteRoute(): Route {
  return {
    method: "DELETE",
    pattern: new URLPattern({ pathname: "/api/v1/issues/:id" }),
    handler: (req, match, { db, bus }) => {
      const id = match.pathname.groups.id!;
      const project = resolveProject(db, projectSlugFromUrl(req));
      if (isResponse(project)) return project;
      const existing = getIssueById(db, id, project.id);
      if (!existing) return Response.json({ error: { code: "issue_not_found" } }, { status: 404 });
      deleteIssue(db, id, project.id);
      bus.publish("issue.deleted", {
        id,
        identifier: existing.identifier,
        project: eventProject(project),
      });
      return new Response(null, { status: 204 });
    },
  };
}
