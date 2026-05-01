import { URLPattern } from "urlpattern-polyfill";
import { getIssueById } from "../../db/repo/issues";
import type { Route } from "../server";
import { isResponse, projectSlugFromUrl, resolveProject } from "./project-scope";

export function issuesDetailRoute(): Route {
  return {
    method: "GET",
    pattern: new URLPattern({ pathname: "/api/v1/issues/:id" }),
    handler: (req, match, { db }) => {
      const id = match.pathname.groups.id!;
      const project = resolveProject(db, projectSlugFromUrl(req));
      if (isResponse(project)) return project;
      const issue = getIssueById(db, id, project.id);
      if (!issue) {
        return Response.json(
          { error: { code: "issue_not_found", message: `issue ${id} not found` } },
          { status: 404 },
        );
      }
      return Response.json(issue);
    },
  };
}
