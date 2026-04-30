import { URLPattern } from "urlpattern-polyfill";
import { createIssue } from "../../db/repo/issues";
import { addHistory } from "../../db/repo/history";
import { isValidState } from "../../domain/issue";
import type { Route } from "../server";

interface CreateBody {
  title?: unknown;
  description?: unknown;
  priority?: unknown;
  state?: unknown;
  parent_issue_id?: unknown;
  external_ref?: unknown;
  external_url?: unknown;
  branch_name?: unknown;
  labels?: unknown;
  blocker_ids?: unknown;
}

export function issuesCreateRoute(): Route {
  return {
    method: "POST",
    pattern: new URLPattern({ pathname: "/api/v1/issues" }),
    handler: async (req, _match, { db, bus }) => {
      let body: CreateBody;
      try {
        body = (await req.json()) as CreateBody;
      } catch {
        return Response.json(
          { error: { code: "bad_json", message: "invalid JSON body" } },
          { status: 400 },
        );
      }

      if (typeof body.title !== "string" || body.title.trim() === "") {
        return Response.json(
          { error: { code: "missing_field", message: "title is required", fields: ["title"] } },
          { status: 400 },
        );
      }

      const state = typeof body.state === "string" ? body.state : "Todo";
      if (!isValidState(state)) {
        return Response.json(
          {
            error: { code: "invalid_state", message: `unknown state ${state}`, fields: ["state"] },
          },
          { status: 400 },
        );
      }

      const issue = createIssue(db, {
        title: body.title.trim(),
        description: typeof body.description === "string" ? body.description : null,
        priority: typeof body.priority === "number" ? body.priority : null,
        state,
        parent_issue_id: typeof body.parent_issue_id === "string" ? body.parent_issue_id : null,
        external_ref: typeof body.external_ref === "string" ? body.external_ref : null,
        external_url: typeof body.external_url === "string" ? body.external_url : null,
        branch_name: typeof body.branch_name === "string" ? body.branch_name : null,
        labels: Array.isArray(body.labels)
          ? body.labels.filter((s): s is string => typeof s === "string")
          : [],
        blocker_ids: Array.isArray(body.blocker_ids)
          ? body.blocker_ids.filter((s): s is string => typeof s === "string")
          : [],
      });

      addHistory(db, {
        issue_id: issue.id,
        kind: "created",
        from_value: null,
        to_value: state,
        actor: "user",
      });
      bus.publish("issue.created", issue);

      return Response.json(issue, { status: 201 });
    },
  };
}
