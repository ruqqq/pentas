// packages/dalang/src/index.ts
import { parseArgs } from "./cli/args";
import { Bootstrap } from "./cli/bootstrap";
import { createLogger } from "./logging/logger";

const log = createLogger({ name: "dalang", level: "info" });
const args = parseArgs(Bun.argv.slice(2));
const boot = new Bootstrap({ workflowPath: args.workflowPath, port: args.port });

const shutdown = async () => {
  log.info("shutting down");
  await boot.stop();
  process.exit(0);
};

process.on("SIGINT", () => { void shutdown(); });
process.on("SIGTERM", () => { void shutdown(); });

try {
  await boot.start();
  log.info({ port: boot.serverPort(), workflow: args.workflowPath }, "dalang started");
} catch (err) {
  log.error({ err: (err as Error).message }, "startup failed");
  process.exit(1);
}
