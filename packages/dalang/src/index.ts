// packages/dalang/src/index.ts
import { DALANG_HELP, parseArgs } from "./cli/args";
import { Bootstrap } from "./cli/bootstrap";
import { createLogger } from "./logging/logger";

const log = createLogger({ name: "dalang", level: "info" });
const args = parseArgs(Bun.argv.slice(2));

if (args.help) {
  console.log(DALANG_HELP.trimEnd());
  process.exit(0);
}

if (args.command === "lint") {
  const { lintWorkflow } = await import("./config/workflow-linter");
  const result = await lintWorkflow(args.workflowPath);
  if (result.ok) {
    console.log(`OK: ${args.workflowPath}`);
    process.exit(0);
  }
  for (const diagnostic of result.diagnostics) {
    console.error(`${diagnostic.severity}: ${diagnostic.message}`);
  }
  process.exit(1);
}

if (args.command === "auth") {
  const { FilesystemAuthStore, defaultStoreRoot } = await import("./auth/store");
  const { runAuthCli } = await import("./auth/cli");
  const store = new FilesystemAuthStore(defaultStoreRoot());
  const exitCode = await runAuthCli({
    store,
    argv: args.authArgv ?? [],
    log: (line) => console.log(line),
  });
  process.exit(exitCode);
}

const boot = new Bootstrap({ workflowPath: args.workflowPath, port: args.port });

const shutdown = async () => {
  log.info("shutting down");
  await boot.stop();
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});

try {
  await boot.start();
  log.info({ port: boot.serverPort(), workflow: args.workflowPath }, "dalang started");
} catch (err) {
  log.error({ err: (err as Error).message }, "startup failed");
  process.exit(1);
}
