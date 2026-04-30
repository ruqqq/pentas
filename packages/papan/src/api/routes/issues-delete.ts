import { URLPattern } from "urlpattern-polyfill";
import { getIssueById, deleteIssue } from "../../db/repo/issues";
import type { Route } from "../server";

export function issuesDeleteRoute(): Route {
  return {
    method: "DELETE",
    pattern: new URLPattern({ pathname: "/api/v1/issues/:id" }),
    handler: (_req, match, { db, bus }) => {
      const id = match.pathname.groups.id!;
      const existing = getIssueById(db, id);
      if (!existing) return Response.json({ error: { code: "issue_not_found" } }, { status: 404 });
      deleteIssue(db, id);
      bus.publish("issue.deleted", { id, identifier: existing.identifier });
      return new Response(null, { status: 204 });
    },
  };
}
