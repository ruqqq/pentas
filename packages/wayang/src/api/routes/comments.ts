import { URLPattern } from "urlpattern-polyfill";
import { addComment, listComments } from "../../db/repo/comments";
import { addHistory } from "../../db/repo/history";
import { getIssueById } from "../../db/repo/issues";
import type { Route } from "../server";

interface CommentBody {
  body?: unknown;
  author?: unknown;
}

export function commentsListRoute(): Route {
  return {
    method: "GET",
    pattern: new URLPattern({ pathname: "/api/v1/issues/:id/comments" }),
    handler: (_req, match, { db }) => {
      const id = match.pathname.groups.id!;
      const issue = getIssueById(db, id);
      if (!issue) return Response.json({ error: { code: "issue_not_found" } }, { status: 404 });
      return Response.json({ comments: listComments(db, id) });
    },
  };
}

export function commentsCreateRoute(): Route {
  return {
    method: "POST",
    pattern: new URLPattern({ pathname: "/api/v1/issues/:id/comments" }),
    handler: async (req, match, { db, bus }) => {
      const id = match.pathname.groups.id!;
      const issue = getIssueById(db, id);
      if (!issue) return Response.json({ error: { code: "issue_not_found" } }, { status: 404 });

      let body: CommentBody;
      try {
        body = (await req.json()) as CommentBody;
      } catch {
        return Response.json({ error: { code: "bad_json" } }, { status: 400 });
      }

      if (typeof body.body !== "string" || body.body.trim() === "") {
        return Response.json(
          { error: { code: "missing_field", message: "body is required", fields: ["body"] } },
          { status: 400 },
        );
      }

      const author: "user" | "agent" = body.author === "agent" ? "agent" : "user";
      const comment = addComment(db, id, { body: body.body, author });
      addHistory(db, {
        issue_id: id,
        kind: "comment_added",
        from_value: null,
        to_value: null,
        actor: author,
      });
      bus.publish("comment.added", { issue_id: id, comment });
      return Response.json(comment, { status: 201 });
    },
  };
}
