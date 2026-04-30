import { URLPattern } from "urlpattern-polyfill";
import { getIssuesByIds } from "../../db/repo/issues";
import type { Route } from "../server";

export function issuesByIdsRoute(): Route {
  return {
    method: "GET",
    pattern: new URLPattern({ pathname: "/api/v1/issues/by-ids" }),
    handler: (req, _match, { db }) => {
      const url = new URL(req.url);
      const ids = url.searchParams.getAll("id");
      const issues = getIssuesByIds(db, ids);
      return Response.json({ issues });
    },
  };
}
