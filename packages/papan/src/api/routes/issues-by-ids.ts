import { URLPattern } from "urlpattern-polyfill";
import { getIssuesByIdsInProject } from "../../db/repo/issues";
import type { Route } from "../server";
import { isResponse, projectSlugFromUrl, resolveProject } from "./project-scope";

export function issuesByIdsRoute(): Route {
  return {
    method: "GET",
    pattern: new URLPattern({ pathname: "/api/v1/issues/by-ids" }),
    handler: (req, _match, { db }) => {
      const url = new URL(req.url);
      const ids = url.searchParams.getAll("id");
      const project = resolveProject(db, projectSlugFromUrl(req));
      if (isResponse(project)) return project;
      const issues = getIssuesByIdsInProject(db, ids, project.id);
      return Response.json({ issues });
    },
  };
}
