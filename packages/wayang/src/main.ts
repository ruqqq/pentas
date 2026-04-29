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
import { staticRoute } from "./ui/static";
import { uiListRoute, uiDetailRoute, uiNewRoute, uiCreatePostRoute } from "./ui/routes";

export interface RunOptions {
  port?: number;
  dbPath?: string;
}

export function defaultDbPath(): string {
  return resolve(homedir(), ".wayang", "wayang.db");
}

export function runWayang(opts: RunOptions = {}) {
  const dbPath = opts.dbPath ?? process.env["WAYANG_DB_PATH"] ?? defaultDbPath();
  if (!existsSync(dirname(dbPath))) mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  runMigrations(db);

  const port = opts.port ?? Number(process.env["WAYANG_PORT"] ?? 3001);
  const apiToken = process.env["WAYANG_API_TOKEN"] || undefined;

  const server = startServer({ db, apiToken, port }, [
    // Order matters: more specific paths first.
    issuesByIdsRoute(),
    eventsRoute(),
    issuesListRoute(),
    issuesCreateRoute(),
    commentsListRoute(),
    commentsCreateRoute(),
    historyListRoute(),
    issuesUpdateRoute(),
    issuesDeleteRoute(),
    issuesDetailRoute(),
    uiCreatePostRoute(),
    uiNewRoute(),
    uiDetailRoute(),
    uiListRoute(),
    staticRoute(),
  ]);

  console.log(`wayang listening on ${server.url}`);
  return { server, db };
}
