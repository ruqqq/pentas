import { URLPattern } from "urlpattern-polyfill";
import { listHistory } from "../../db/repo/history";
import { getIssueById } from "../../db/repo/issues";
import type { Route } from "../server";

export function historyListRoute(): Route {
  return {
    method: "GET",
    pattern: new URLPattern({ pathname: "/api/v1/issues/:id/history" }),
    handler: (_req, match, { db }) => {
      const id = match.pathname.groups.id!;
      const issue = getIssueById(db, id);
      if (!issue) return Response.json({ error: { code: "issue_not_found" } }, { status: 404 });
      return Response.json({ history: listHistory(db, id) });
    },
  };
}
