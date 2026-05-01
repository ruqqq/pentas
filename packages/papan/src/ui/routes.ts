import { URLPattern } from "urlpattern-polyfill";
import type { Database } from "bun:sqlite";
import type { Route } from "../api/server";
import { getIssuesByStates, getIssueById, createIssue } from "../db/repo/issues";
import { createProject, getProjectBySlug, listProjectSummaries, listProjects } from "../db/repo/projects";
import { listComments } from "../db/repo/comments";
import { listHistory } from "../db/repo/history";
import { addHistory } from "../db/repo/history";
import { renderBoardPage, renderBoardGrid } from "./pages/board";
import { renderDetailPage } from "./pages/detail";
import { renderNewPage } from "./pages/new";
import {
  renderNewProjectPage,
  renderProjectNotFound,
  renderProjectsPage,
} from "./pages/projects";
import { ALL_STATES } from "../domain/issue";
import { DEFAULT_PROJECT_SLUG, isValidProjectSlug, type Project } from "../domain/project";
import { parseLinearUrl } from "../lib/linear-url";

const BOARD_LIMIT = 200;

type CreateIssueFromRequestResult =
  | { error: string; issue?: never }
  | { issue: ReturnType<typeof createIssue>; error?: never };

function loadBoardIssues(db: Database, project: Project, q: string) {
  const { issues } = getIssuesByStates(
    db,
    ALL_STATES as readonly string[] as string[],
    null,
    BOARD_LIMIT,
    project.id,
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

function resolveUiProject(db: Database, slug: string): Project | Response {
  const project = getProjectBySlug(db, slug);
  if (!project) {
    return new Response(renderProjectNotFound(slug, listProjects(db)), {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  return project;
}

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

function isResponse(value: Project | Response): value is Response {
  return value instanceof Response;
}

function issuePath(issueId: string, project: Project): string {
  return project.slug === DEFAULT_PROJECT_SLUG
    ? `/issues/${issueId}`
    : `/projects/${project.slug}/issues/${issueId}`;
}

export function uiProjectsRoute(): Route {
  return {
    method: "GET",
    pattern: new URLPattern({ pathname: "/projects" }),
    handler: (_req, _match, { db }) => html(renderProjectsPage(listProjectSummaries(db))),
  };
}

export function uiProjectNewRoute(): Route {
  return {
    method: "GET",
    pattern: new URLPattern({ pathname: "/projects/new" }),
    handler: () => html(renderNewProjectPage()),
  };
}

export function uiProjectCreatePostRoute(): Route {
  return {
    method: "POST",
    pattern: new URLPattern({ pathname: "/projects/new" }),
    handler: async (req, _match, { db }) => {
      const form = await req.formData();
      const slug = String(form.get("slug") ?? "").trim().toLowerCase();
      const name = String(form.get("name") ?? "").trim();
      if (!isValidProjectSlug(slug)) {
        return html(renderNewProjectPage({ error: "Invalid slug", slug, name }), 400);
      }
      if (!name) {
        return html(renderNewProjectPage({ error: "Name is required", slug, name }), 400);
      }
      try {
        const project = createProject(db, {
          slug,
          name,
          description: String(form.get("description") ?? "") || null,
        });
        return new Response(null, {
          status: 302,
          headers: { location: `/projects/${project.slug}` },
        });
      } catch (err) {
        if (err instanceof Error && err.message.includes("UNIQUE")) {
          return html(renderNewProjectPage({ error: "Project already exists", slug, name }), 409);
        }
        throw err;
      }
    },
  };
}

export function uiBoardRoute(): Route {
  return {
    method: "GET",
    pattern: new URLPattern({ pathname: "/" }),
    handler: (req, _match, { db }) => {
      const url = new URL(req.url);
      const q = url.searchParams.get("q") ?? "";
      const project = resolveUiProject(db, DEFAULT_PROJECT_SLUG);
      if (isResponse(project)) return project;
      const issues = loadBoardIssues(db, project, q);
      return html(renderBoardPage({ issues, q, project, projects: listProjects(db) }));
    },
  };
}

export function uiProjectBoardRoute(): Route {
  return {
    method: "GET",
    pattern: new URLPattern({ pathname: "/projects/:slug" }),
    handler: (req, match, { db }) => {
      const url = new URL(req.url);
      const q = url.searchParams.get("q") ?? "";
      const project = resolveUiProject(db, match.pathname.groups.slug!);
      if (isResponse(project)) return project;
      const issues = loadBoardIssues(db, project, q);
      return html(renderBoardPage({ issues, q, project, projects: listProjects(db) }));
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
      const project = resolveUiProject(db, DEFAULT_PROJECT_SLUG);
      if (isResponse(project)) return project;
      const issues = loadBoardIssues(db, project, q);
      return html(renderBoardGrid({ issues, q, project }));
    },
  };
}

export function uiProjectBoardPartialRoute(): Route {
  return {
    method: "GET",
    pattern: new URLPattern({ pathname: "/projects/:slug/partials/board" }),
    handler: (req, match, { db }) => {
      const url = new URL(req.url);
      const q = url.searchParams.get("q") ?? "";
      const project = resolveUiProject(db, match.pathname.groups.slug!);
      if (isResponse(project)) return project;
      const issues = loadBoardIssues(db, project, q);
      return html(renderBoardGrid({ issues, q, project }));
    },
  };
}

export function uiDetailRoute(): Route {
  return {
    method: "GET",
    pattern: new URLPattern({ pathname: "/issues/:id" }),
    handler: (_req, match, { db }) => {
      const project = resolveUiProject(db, DEFAULT_PROJECT_SLUG);
      if (isResponse(project)) return project;
      const id = match.pathname.groups.id!;
      const issue = getIssueById(db, id, project.id);
      if (!issue) return new Response("Not Found", { status: 404 });
      const comments = listComments(db, id);
      const history = listHistory(db, id);
      return html(renderDetailPage({ issue, comments, history, projects: listProjects(db) }));
    },
  };
}

export function uiProjectDetailRoute(): Route {
  return {
    method: "GET",
    pattern: new URLPattern({ pathname: "/projects/:slug/issues/:id" }),
    handler: (_req, match, { db }) => {
      const project = resolveUiProject(db, match.pathname.groups.slug!);
      if (isResponse(project)) return project;
      const id = match.pathname.groups.id!;
      const issue = getIssueById(db, id, project.id);
      if (!issue) return new Response("Not Found", { status: 404 });
      const comments = listComments(db, id);
      const history = listHistory(db, id);
      return html(renderDetailPage({ issue, comments, history, project, projects: listProjects(db) }));
    },
  };
}

export function uiNewRoute(): Route {
  return {
    method: "GET",
    pattern: new URLPattern({ pathname: "/new" }),
    handler: (_req, _match, { db }) => {
      const project = resolveUiProject(db, DEFAULT_PROJECT_SLUG);
      if (isResponse(project)) return project;
      return html(renderNewPage({ projects: listProjects(db) }));
    },
  };
}

export function uiProjectNewIssueRoute(): Route {
  return {
    method: "GET",
    pattern: new URLPattern({ pathname: "/projects/:slug/new" }),
    handler: (_req, match, { db }) => {
      const project = resolveUiProject(db, match.pathname.groups.slug!);
      if (isResponse(project)) return project;
      return html(renderNewPage({ project, projects: listProjects(db) }));
    },
  };
}

async function createIssueFromRequest(
  req: Request,
  db: Database,
  project: Project,
): Promise<CreateIssueFromRequestResult> {
  const form = await req.formData();
  const title = String(form.get("title") ?? "").trim();
  if (title === "") {
    return {
      error: renderNewPage({
        error: "Title is required",
        values: { title: "" },
        project,
        projects: listProjects(db),
      }),
    };
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
    project_id: project.id,
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
  return { issue };
}

export function uiCreatePostRoute(): Route {
  return {
    method: "POST",
    pattern: new URLPattern({ pathname: "/new" }),
    handler: async (req, _match, { db, bus }) => {
      const project = resolveUiProject(db, DEFAULT_PROJECT_SLUG);
      if (isResponse(project)) return project;
      const result = await createIssueFromRequest(req, db, project);
      if (result.error !== undefined) return html(result.error, 400);
      bus.publish("issue.created", {
        ...result.issue,
        project: { id: project.id, slug: project.slug },
      });
      return new Response(null, {
        status: 302,
        headers: { location: issuePath(result.issue.id, project) },
      });
    },
  };
}

export function uiProjectCreateIssuePostRoute(): Route {
  return {
    method: "POST",
    pattern: new URLPattern({ pathname: "/projects/:slug/new" }),
    handler: async (req, match, { db, bus }) => {
      const project = resolveUiProject(db, match.pathname.groups.slug!);
      if (isResponse(project)) return project;
      const result = await createIssueFromRequest(req, db, project);
      if (result.error !== undefined) return html(result.error, 400);
      bus.publish("issue.created", {
        ...result.issue,
        project: { id: project.id, slug: project.slug },
      });
      return new Response(null, {
        status: 302,
        headers: { location: issuePath(result.issue.id, project) },
      });
    },
  };
}
