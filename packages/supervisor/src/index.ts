#!/usr/bin/env bun
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
    dalangPort,
    wayangPort,
    dbPath,
  };
}

const args = parseArgs(Bun.argv.slice(2));
const log = createLogger({ name: "supervisor", level: "info" });

const dalang = new Bootstrap({ workflowPath: args.workflowPath, port: args.dalangPort });
let wayangHandle: ReturnType<typeof runWayang> | null = null;
let shuttingDown = false;

const shutdown = async (code = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info("shutting down");
  try { await dalang.stop(); } catch (err) { log.warn({ err: (err as Error).message }, "dalang stop failed"); }
  try { wayangHandle?.server.stop(); } catch (err) { log.warn({ err: (err as Error).message }, "wayang stop failed"); }
  try { wayangHandle?.db.close(); } catch (err) { log.warn({ err: (err as Error).message }, "wayang db close failed"); }
  process.exit(code);
};

process.on("SIGINT", () => { void shutdown(0); });
process.on("SIGTERM", () => { void shutdown(0); });

try {
  // Wayang first: dalang's tracker config typically points at wayang.
  wayangHandle = runWayang({
    ...(args.wayangPort !== undefined ? { port: args.wayangPort } : {}),
    ...(args.dbPath !== undefined ? { dbPath: args.dbPath } : {}),
  });
  await dalang.start();
  log.info(
    { dalang_port: dalang.serverPort(), wayang_port: wayangHandle.server.port, workflow: args.workflowPath },
    "supervisor started",
  );
} catch (err) {
  log.error({ err: (err as Error).message }, "startup failed");
  await shutdown(1);
}
