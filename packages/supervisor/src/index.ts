#!/usr/bin/env bun
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { Bootstrap, createLogger } from "@tok-juara/dalang";
import { runWayang } from "@tok-juara/wayang";

interface ParsedArgs {
  workflowPath: string;
  dalangPort: number | null;
  wayangPort: number | undefined;
  dbPath: string | undefined;
}

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
    if (a === "--dalang-port") {
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

// Shared in-process token so dalang authenticates against wayang without
// requiring user setup. Caller can still set WAYANG_API_TOKEN to override.
const apiToken = process.env["WAYANG_API_TOKEN"] ?? randomBytes(24).toString("hex");

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

  // Start wayang first so we know its bound port before configuring dalang.
  wayangHandle = runWayang({
    port: args.wayangPort,
    dbPath,
    apiToken,
  });
  const wayangPort = wayangHandle.server.port;
  const trackerEndpoint = `http://127.0.0.1:${wayangPort}`;

  dalang = new Bootstrap({
    workflowPath: args.workflowPath,
    port: args.dalangPort,
    trackerEndpoint,
    trackerApiKey: apiToken,
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
