import { URLPattern } from "urlpattern-polyfill";
import { getIssueById, updateIssue } from "../../db/repo/issues";
import { addHistory } from "../../db/repo/history";
import { isValidState } from "../../domain/issue";
import type { Route } from "../server";

interface PatchBody {
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
  actor?: unknown;
}

export function issuesUpdateRoute(): Route {
  return {
    method: "PATCH",
    pattern: new URLPattern({ pathname: "/api/v1/issues/:id" }),
    handler: async (req, match, { db, bus }) => {
      const id = match.pathname.groups.id!;
      const existing = getIssueById(db, id);
      if (!existing) {
        return Response.json(
          { error: { code: "issue_not_found", message: `issue ${id} not found` } },
          { status: 404 },
        );
      }

      let body: PatchBody;
      try {
        body = (await req.json()) as PatchBody;
      } catch {
        return Response.json(
          { error: { code: "bad_json", message: "invalid JSON body" } },
          { status: 400 },
        );
      }

      if (
        body.state !== undefined &&
        (typeof body.state !== "string" || !isValidState(body.state))
      ) {
        return Response.json(
          { error: { code: "invalid_state", message: "unknown state", fields: ["state"] } },
          { status: 400 },
        );
      }

      const actor: "user" | "agent" = body.actor === "agent" ? "agent" : "user";
      const oldState = existing.state;

      const updated = updateIssue(db, id, {
        ...(typeof body.title === "string" ? { title: body.title } : {}),
        ...(body.description !== undefined
          ? { description: typeof body.description === "string" ? body.description : null }
          : {}),
        ...(body.priority !== undefined
          ? { priority: typeof body.priority === "number" ? body.priority : null }
          : {}),
        ...(typeof body.state === "string" ? { state: body.state } : {}),
        ...(body.parent_issue_id !== undefined
          ? {
              parent_issue_id:
                typeof body.parent_issue_id === "string" ? body.parent_issue_id : null,
            }
          : {}),
        ...(body.external_ref !== undefined
          ? { external_ref: typeof body.external_ref === "string" ? body.external_ref : null }
          : {}),
        ...(body.external_url !== undefined
          ? { external_url: typeof body.external_url === "string" ? body.external_url : null }
          : {}),
        ...(body.branch_name !== undefined
          ? { branch_name: typeof body.branch_name === "string" ? body.branch_name : null }
          : {}),
        ...(Array.isArray(body.labels)
          ? { labels: body.labels.filter((s): s is string => typeof s === "string") }
          : {}),
        ...(Array.isArray(body.blocker_ids)
          ? { blocker_ids: body.blocker_ids.filter((s): s is string => typeof s === "string") }
          : {}),
      });

      if (!updated) {
        return Response.json({ error: { code: "issue_not_found" } }, { status: 404 });
      }

      if (typeof body.state === "string" && body.state !== oldState) {
        addHistory(db, {
          issue_id: id,
          kind: "state_changed",
          from_value: oldState,
          to_value: body.state,
          actor,
        });
        bus.publish("state.changed", {
          id,
          identifier: updated.identifier,
          from: oldState,
          to: body.state,
          actor,
        });
      } else {
        addHistory(db, { issue_id: id, kind: "edited", from_value: null, to_value: null, actor });
      }

      bus.publish("issue.updated", updated);
      return Response.json(updated);
    },
  };
}
