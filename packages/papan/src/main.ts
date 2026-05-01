import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { runMigrations } from "./db/migrations";
import { startServer } from "./api/server";
import { issuesListRoute } from "./api/routes/issues-list";
import { issuesByIdsRoute } from "./api/routes/issues-by-ids";
import { issuesDetailRoute } from "./api/routes/issues-detail";
import { issuesCreateRoute } from "./api/routes/issues-create";
import { issuesUpdateRoute } from "./api/routes/issues-update";
import { issuesDeleteRoute } from "./api/routes/issues-delete";
import { commentsListRoute, commentsCreateRoute } from "./api/routes/comments";
import { historyListRoute } from "./api/routes/history";
import { eventsRoute } from "./api/routes/events";
import { projectsCreateRoute, projectsDetailRoute, projectsListRoute } from "./api/routes/projects";
import {
  projectStatusesCreateRoute,
  projectStatusesDeleteRoute,
  projectStatusesListRoute,
  projectStatusesReorderRoute,
  projectStatusesUpdateRoute,
} from "./api/routes/project-statuses";
import { staticRoute } from "./ui/static";
import {
  uiBoardRoute,
  uiBoardPartialRoute,
  uiProjectBoardRoute,
  uiProjectBoardPartialRoute,
  uiDetailRoute,
  uiProjectDetailRoute,
  uiNewRoute,
  uiProjectNewIssueRoute,
  uiCreatePostRoute,
  uiProjectCreateIssuePostRoute,
  uiProjectsRoute,
  uiProjectNewRoute,
  uiProjectCreatePostRoute,
  uiProjectStatusesRoute,
  uiProjectStatusesAddRoute,
  uiProjectStatusesRenameRoute,
  uiProjectStatusesKindRoute,
  uiProjectStatusesMoveRoute,
  uiProjectStatusesDeleteRoute,
} from "./ui/routes";

export interface RunOptions {
  port?: number;
  dbPath?: string;
  apiToken?: string;
}

export function defaultDbPath(): string {
  return resolve(homedir(), ".papan", "papan.db");
}

export function runPapan(opts: RunOptions = {}) {
  const dbPath = opts.dbPath ?? process.env["PAPAN_DB_PATH"] ?? defaultDbPath();
  if (!existsSync(dirname(dbPath))) mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  runMigrations(db);

  const port = opts.port ?? Number(process.env["PAPAN_PORT"] ?? 3001);
  const apiToken = opts.apiToken ?? process.env["PAPAN_API_TOKEN"] ?? undefined;

  const server = startServer({ db, apiToken, port }, [
    // Order matters: more specific paths first.
    issuesByIdsRoute(),
    eventsRoute(),
    projectStatusesReorderRoute(),
    projectStatusesUpdateRoute(),
    projectStatusesDeleteRoute(),
    projectStatusesCreateRoute(),
    projectStatusesListRoute(),
    projectsListRoute(),
    projectsCreateRoute(),
    projectsDetailRoute(),
    issuesListRoute(),
    issuesCreateRoute(),
    commentsListRoute(),
    commentsCreateRoute(),
    historyListRoute(),
    issuesUpdateRoute(),
    issuesDeleteRoute(),
    issuesDetailRoute(),
    uiProjectStatusesAddRoute(),
    uiProjectStatusesRenameRoute(),
    uiProjectStatusesKindRoute(),
    uiProjectStatusesMoveRoute(),
    uiProjectStatusesDeleteRoute(),
    uiProjectStatusesRoute(),
    uiCreatePostRoute(),
    uiProjectCreateIssuePostRoute(),
    uiProjectCreatePostRoute(),
    uiNewRoute(),
    uiProjectNewIssueRoute(),
    uiProjectNewRoute(),
    uiProjectsRoute(),
    uiProjectBoardPartialRoute(),
    uiBoardPartialRoute(),
    uiProjectDetailRoute(),
    uiDetailRoute(),
    uiProjectBoardRoute(),
    uiBoardRoute(),
    staticRoute(),
  ]);

  console.log(`papan listening on ${server.url}`);
  return { server, db };
}
