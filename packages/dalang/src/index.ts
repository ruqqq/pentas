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

if (args.command === "sandbox-doctor") {
  const { loadWorkflow } = await import("./config/workflow-loader");
  const { validateForDispatch } = await import("./config/validate");
  const { expandPath } = await import("./config/env-resolver");
  const { FilesystemAuthStore, defaultStoreRoot } = await import("./auth/store");
  const { DockerContainerHost } = await import("./sandbox/docker-host");
  const { defaultSandboxesRoot, runSandboxDoctor } = await import("./sandbox/doctor");
  try {
    const wf = await loadWorkflow(args.workflowPath);
    validateForDispatch(wf.config);
    if (wf.config.sandbox?.enabled !== true) {
      throw new Error("sandbox doctor requires sandbox.enabled: true");
    }
    const workspaceRoot = expandPath(wf.config.workspace.root);
    const result = await runSandboxDoctor({
      host: new DockerContainerHost(),
      store: new FilesystemAuthStore(defaultStoreRoot()),
      sandboxesRoot: defaultSandboxesRoot(workspaceRoot),
      repoDir: process.cwd(),
      workspaceDir: process.cwd(),
      config: wf.config.sandbox,
      provider: wf.config.agent_provider,
    });
    for (const check of result.checks) {
      const prefix = check.ok ? "OK" : "FAIL";
      console.log(`${prefix}: ${check.name}${check.detail ? ` — ${check.detail}` : ""}`);
    }
    process.exit(result.ok ? 0 : 1);
  } catch (err) {
    console.error(`FAIL: ${(err as Error).message}`);
    process.exit(1);
  }
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
