import { URLPattern } from "urlpattern-polyfill";
import type { Route } from "../api/server";
import { getIssuesByStates, getIssueById, createIssue } from "../db/repo/issues";
import { listComments } from "../db/repo/comments";
import { listHistory } from "../db/repo/history";
import { addHistory } from "../db/repo/history";
import { renderBoardPage, renderBoardGrid } from "./pages/board";
import { renderDetailPage } from "./pages/detail";
import { renderNewPage } from "./pages/new";
import { ALL_STATES } from "../domain/issue";
import { parseLinearUrl } from "../lib/linear-url";

const BOARD_LIMIT = 200;

function loadBoardIssues(db: Parameters<typeof getIssuesByStates>[0], q: string) {
  const { issues } = getIssuesByStates(
    db,
    ALL_STATES as readonly string[] as string[],
    null,
    BOARD_LIMIT,
  );
  if (!q) return issues;
  const needle = q.toLowerCase();
  return issues.filter(
    (i) =>
      i.title.toLowerCase().includes(needle) ||
      (i.description ?? "").toLowerCase().includes(needle) ||
      i.identifier.toLowerCase().includes(needle),
  );
}

export function uiBoardRoute(): Route {
  return {
    method: "GET",
    pattern: new URLPattern({ pathname: "/" }),
    handler: (req, _match, { db }) => {
      const url = new URL(req.url);
      const q = url.searchParams.get("q") ?? "";
      const issues = loadBoardIssues(db, q);
      return new Response(renderBoardPage({ issues, q }), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    },
  };
}

export function uiBoardPartialRoute(): Route {
  return {
    method: "GET",
    pattern: new URLPattern({ pathname: "/partials/board" }),
    handler: (req, _match, { db }) => {
      const url = new URL(req.url);
      const q = url.searchParams.get("q") ?? "";
      const issues = loadBoardIssues(db, q);
      return new Response(renderBoardGrid({ issues, q }), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    },
  };
}

export function uiDetailRoute(): Route {
  return {
    method: "GET",
    pattern: new URLPattern({ pathname: "/issues/:id" }),
    handler: (_req, match, { db }) => {
      const id = match.pathname.groups.id!;
      const issue = getIssueById(db, id);
      if (!issue) return new Response("Not Found", { status: 404 });
      const comments = listComments(db, id);
      const history = listHistory(db, id);
      return new Response(renderDetailPage({ issue, comments, history }), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    },
  };
}

export function uiNewRoute(): Route {
  return {
    method: "GET",
    pattern: new URLPattern({ pathname: "/new" }),
    handler: () =>
      new Response(renderNewPage({}), { headers: { "content-type": "text/html; charset=utf-8" } }),
  };
}

export function uiCreatePostRoute(): Route {
  return {
    method: "POST",
    pattern: new URLPattern({ pathname: "/new" }),
    handler: async (req, _match, { db, bus }) => {
      const form = await req.formData();
      const title = String(form.get("title") ?? "").trim();
      if (title === "") {
        return new Response(renderNewPage({ error: "Title is required", values: { title: "" } }), {
          status: 400,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      const description = String(form.get("description") ?? "");
      const state = String(form.get("state") ?? "Todo");
      const priorityRaw = String(form.get("priority") ?? "");
      const priority = priorityRaw === "" ? null : Number(priorityRaw);
      const labels = String(form.get("labels") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const linearUrl = String(form.get("linear_url") ?? "");
      const parsed = linearUrl ? parseLinearUrl(linearUrl) : null;

      const issue = createIssue(db, {
        title,
        description: description || null,
        priority,
        state,
        labels,
        external_ref: parsed?.external_ref ?? null,
        external_url: parsed?.external_url ?? null,
      });
      addHistory(db, {
        issue_id: issue.id,
        kind: "created",
        from_value: null,
        to_value: state,
        actor: "user",
      });
      bus.publish("issue.created", issue);

      return new Response(null, { status: 302, headers: { location: `/issues/${issue.id}` } });
    },
  };
}
