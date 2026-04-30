#!/usr/bin/env bun
import { dirname, resolve } from "node:path";
import { Bootstrap, createLogger, loadWorkflow, resolveTrackerApiKey } from "@pentas/dalang";
import { runPapan } from "@pentas/papan";

interface ParsedArgs {
  workflowPath: string;
  dalangPort: number | null;
  papanPort: number | undefined;
  dbPath: string | undefined;
}

const HELP_TEXT = `pentas supervisor — runs dalang orchestrator and papan tracker together.

Usage:
  supervisor [WORKFLOW] [options]

Arguments:
  WORKFLOW                 Path to WORKFLOW.md (default: ./WORKFLOW.md).
                           Also accepted via --workflow <path>.

Options:
  --workflow <path>        Path to WORKFLOW.md (overrides positional).
  --dalang-port <port>     Port for dalang HTTP surface (0 = auto-pick, default: 0).
  --papan-port <port>     Port for papan HTTP surface (0 = auto-pick, default: 0).
  --db <path>              Path to papan sqlite db (default: <workflow dir>/papan.db,
                           or $PAPAN_DB_PATH if set).
  -h, --help               Show this help and exit.

Notes:
  Papan's API auth token is read from WORKFLOW.md (tracker.api_key); a value
  like "$VAR" is resolved from the environment. If null/absent, auth is off
  on both papan and dalang.

Environment:
  PAPAN_DB_PATH           Default db path when --db is not provided.
`;

function parseArgs(argv: string[]): ParsedArgs {
  let workflowPath: string | null = null;
  let dalangPort: number | null = null;
  let papanPort: number | undefined;
  let dbPath: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const need = (flag: string): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${flag} requires a value`);
      return v;
    };
    if (a === "-h" || a === "--help") {
      process.stdout.write(HELP_TEXT);
      process.exit(0);
    } else if (a === "--dalang-port") {
      const n = Number.parseInt(need("--dalang-port"), 10);
      if (!Number.isInteger(n) || n < 0) throw new Error("invalid --dalang-port");
      dalangPort = n;
    } else if (a === "--papan-port") {
      const n = Number.parseInt(need("--papan-port"), 10);
      if (!Number.isInteger(n) || n < 0) throw new Error("invalid --papan-port");
      papanPort = n;
    } else if (a === "--db") {
      dbPath = need("--db");
    } else if (a === "--workflow") {
      workflowPath = need("--workflow");
    } else if (a.startsWith("--")) {
      throw new Error(`unknown flag: ${a}`);
    } else {
      if (workflowPath !== null) throw new Error(`unexpected positional argument: ${a}`);
      workflowPath = a;
    }
  }
  return {
    workflowPath: workflowPath ?? "./WORKFLOW.md",
    // Default: 0 = auto-pick a free port. CLI overrides honored as-is.
    dalangPort: dalangPort ?? 0,
    papanPort: papanPort ?? 0,
    dbPath,
  };
}

const args = parseArgs(Bun.argv.slice(2));
const log = createLogger({ name: "supervisor", level: "info" });

let papanHandle: ReturnType<typeof runPapan> | null = null;
let dalang: Bootstrap | null = null;
let shuttingDown = false;

const shutdown = async (code = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info("shutting down");
  try {
    await dalang?.stop();
  } catch (err) {
    log.warn({ err: (err as Error).message }, "dalang stop failed");
  }
  try {
    papanHandle?.server.stop();
  } catch (err) {
    log.warn({ err: (err as Error).message }, "papan stop failed");
  }
  try {
    papanHandle?.db.close();
  } catch (err) {
    log.warn({ err: (err as Error).message }, "papan db close failed");
  }
  process.exit(code);
};

process.on("SIGINT", () => {
  void shutdown(0);
});
process.on("SIGTERM", () => {
  void shutdown(0);
});

try {
  // Default the db to live next to WORKFLOW.md so a project's state travels
  // with its config. Explicit --db wins; PAPAN_DB_PATH env is honored next.
  const resolvedWorkflow = resolve(args.workflowPath);
  const dbPath =
    args.dbPath ?? process.env["PAPAN_DB_PATH"] ?? resolve(dirname(resolvedWorkflow), "papan.db");

  // Read tracker.api_key from WORKFLOW.md and use it as the shared token
  // between dalang and papan. If null/absent, auth is disabled on both.
  const wf = await loadWorkflow(resolvedWorkflow);
  const apiToken = resolveTrackerApiKey(wf.config.tracker.api_key ?? null);

  // Start papan first so we know its bound port before configuring dalang.
  papanHandle = runPapan({
    port: args.papanPort,
    dbPath,
    apiToken: apiToken ?? undefined,
  });
  const papanPort = papanHandle.server.port;
  const trackerEndpoint = `http://127.0.0.1:${papanPort}`;

  dalang = new Bootstrap({
    workflowPath: args.workflowPath,
    port: args.dalangPort,
    trackerEndpoint,
  });
  await dalang.start();

  log.info(
    {
      dalang_port: dalang.serverPort(),
      papan_port: papanPort,
      tracker_endpoint: trackerEndpoint,
      workflow: resolvedWorkflow,
      db: dbPath,
    },
    "supervisor started",
  );
} catch (err) {
  log.error({ err: (err as Error).message }, "startup failed");
  await shutdown(1);
}
