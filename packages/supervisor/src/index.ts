#!/usr/bin/env bun
import { dirname, resolve } from "node:path";
import { Bootstrap, createLogger, loadWorkflow, resolveTrackerApiKey } from "@tok-juara/dalang";
import { runWayang } from "@tok-juara/wayang";

interface ParsedArgs {
  workflowPath: string;
  dalangPort: number | null;
  wayangPort: number | undefined;
  dbPath: string | undefined;
}

const HELP_TEXT = `tok-juara supervisor — runs dalang orchestrator and wayang tracker together.

Usage:
  supervisor [WORKFLOW] [options]

Arguments:
  WORKFLOW                 Path to WORKFLOW.md (default: ./WORKFLOW.md).
                           Also accepted via --workflow <path>.

Options:
  --workflow <path>        Path to WORKFLOW.md (overrides positional).
  --dalang-port <port>     Port for dalang HTTP surface (0 = auto-pick, default: 0).
  --wayang-port <port>     Port for wayang HTTP surface (0 = auto-pick, default: 0).
  --db <path>              Path to wayang sqlite db (default: <workflow dir>/wayang.db,
                           or $WAYANG_DB_PATH if set).
  -h, --help               Show this help and exit.

Notes:
  Wayang's API auth token is read from WORKFLOW.md (tracker.api_key); a value
  like "$VAR" is resolved from the environment. If null/absent, auth is off
  on both wayang and dalang.

Environment:
  WAYANG_DB_PATH           Default db path when --db is not provided.
`;

function parseArgs(argv: string[]): ParsedArgs {
  let workflowPath: string | null = null;
  let dalangPort: number | null = null;
  let wayangPort: number | undefined;
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
    } else if (a === "--wayang-port") {
      const n = Number.parseInt(need("--wayang-port"), 10);
      if (!Number.isInteger(n) || n < 0) throw new Error("invalid --wayang-port");
      wayangPort = n;
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
    wayangPort: wayangPort ?? 0,
    dbPath,
  };
}

const args = parseArgs(Bun.argv.slice(2));
const log = createLogger({ name: "supervisor", level: "info" });

let wayangHandle: ReturnType<typeof runWayang> | null = null;
let dalang: Bootstrap | null = null;
let shuttingDown = false;

const shutdown = async (code = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info("shutting down");
  try { await dalang?.stop(); } catch (err) { log.warn({ err: (err as Error).message }, "dalang stop failed"); }
  try { wayangHandle?.server.stop(); } catch (err) { log.warn({ err: (err as Error).message }, "wayang stop failed"); }
  try { wayangHandle?.db.close(); } catch (err) { log.warn({ err: (err as Error).message }, "wayang db close failed"); }
  process.exit(code);
};

process.on("SIGINT", () => { void shutdown(0); });
process.on("SIGTERM", () => { void shutdown(0); });

try {
  // Default the db to live next to WORKFLOW.md so a project's state travels
  // with its config. Explicit --db wins; WAYANG_DB_PATH env is honored next.
  const resolvedWorkflow = resolve(args.workflowPath);
  const dbPath = args.dbPath
    ?? process.env["WAYANG_DB_PATH"]
    ?? resolve(dirname(resolvedWorkflow), "wayang.db");

  // Read tracker.api_key from WORKFLOW.md and use it as the shared token
  // between dalang and wayang. If null/absent, auth is disabled on both.
  const wf = await loadWorkflow(resolvedWorkflow);
  const apiToken = resolveTrackerApiKey(wf.config.tracker.api_key ?? null);

  // Start wayang first so we know its bound port before configuring dalang.
  wayangHandle = runWayang({
    port: args.wayangPort,
    dbPath,
    apiToken: apiToken ?? undefined,
  });
  const wayangPort = wayangHandle.server.port;
  const trackerEndpoint = `http://127.0.0.1:${wayangPort}`;

  dalang = new Bootstrap({
    workflowPath: args.workflowPath,
    port: args.dalangPort,
    trackerEndpoint,
  });
  await dalang.start();

  log.info(
    {
      dalang_port: dalang.serverPort(),
      wayang_port: wayangPort,
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
