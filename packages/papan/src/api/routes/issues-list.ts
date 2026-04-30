import { URLPattern } from "urlpattern-polyfill";
import { getIssuesByStates } from "../../db/repo/issues";
import type { Route } from "../server";

const DEFAULT_LIMIT = 50;

export function issuesListRoute(): Route {
  return {
    method: "GET",
    pattern: new URLPattern({ pathname: "/api/v1/issues" }),
    handler: (req, _match, { db }) => {
      const url = new URL(req.url);
      const states = url.searchParams.getAll("state");
      if (states.length === 0) {
        return Response.json(
          { error: { code: "missing_state", message: "at least one state parameter is required" } },
          { status: 400 },
        );
      }
      const cursor = url.searchParams.get("cursor");
      const result = getIssuesByStates(db, states, cursor, DEFAULT_LIMIT);
      return Response.json(result);
    },
  };
}
