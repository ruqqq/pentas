import type { RunQuery, RunQueryOptions } from "../agent/agent-runner";
import type { AuthStore } from "../auth/store";
import type { SandboxConfig } from "../config/sandbox-schema";
import { basename, dirname, join, posix } from "node:path";
import { resolveImage } from "./image-source";
import { runWorkerSession, type WorkerSessionLifecycleEvent } from "./worker-lifecycle";
import type { ContainerHost, BindMount } from "./types";

export interface SandboxRepoCloneConfig {
  url: string;
  defaultBranch: string;
}

export interface SandboxedRunnerDeps {
  host: ContainerHost;
  store: AuthStore;
  /** Where per-worker tmpdirs live (e.g. dalang state dir). */
  sandboxesRoot: string;
  /** Where host-side sandbox provider transcripts are written. */
  transcriptRoot?: string;
  /** Absolute path to the repo on the host. */
  repoDir: string;
  /** Repository source workers clone inside the container. */
  repo?: SandboxRepoCloneConfig;
  config: SandboxConfig;
  /** Override the exec command (testing). Default uses `/opt/dalang/bayang`. */
  shimCmdOverride?: string[];
  /** Override the invocation payload (testing). Default builds from RunQueryOptions. */
  invocationOverride?: unknown;
  /** Optional sink for sandbox lifecycle events. */
  onLifecycleEvent?: (e: WorkerSessionLifecycleEvent) => void;
  /** Counter or hook to produce stable per-worker IDs. */
  workerIdFactory?: () => string;
}

const DEFAULT_SHIM_CONTAINER_PATH = "/opt/dalang/bayang";

let workerCounter = 0;

function defaultSandboxTranscriptRoot(sandboxesRoot: string): string {
  return join(dirname(sandboxesRoot), "sandbox-sessions");
}

function buildInvocation(
  opts: RunQueryOptions,
  providerExecs: SandboxConfig["providers"],
  containerCwd: string,
  git: SandboxConfig["git"],
): unknown {
  // Resume ids are local provider state. Sandboxed workers are disposable in
  // the current lifecycle, so forwarding them would ask a fresh worker to
  // resume state it cannot have.
  if (opts.claude) {
    return {
      provider: "claude",
      prompt: opts.prompt,
      cwd: containerCwd,
      model: opts.model,
      executablePath: providerExecs.claude.executablePath,
      claude: { permissionMode: opts.claude.permissionMode },
    };
  }
  if (opts.codex) {
    return {
      provider: "codex",
      prompt: opts.prompt,
      cwd: containerCwd,
      model: opts.model,
      executablePath: providerExecs.codex.executablePath,
      codex: {
        sandboxMode: opts.codex.sandboxMode,
        approvalPolicy: opts.codex.approvalPolicy,
        networkAccessEnabled: opts.codex.networkAccessEnabled,
        ...(providerExecs.codex.env !== undefined || opts.codex.env !== undefined
          ? { env: { ...opts.codex.env, ...providerExecs.codex.env } }
          : {}),
        ...(git !== undefined ? { git } : {}),
      },
    };
  }
  if (opts.opencode) {
    return {
      provider: "opencode",
      prompt: opts.prompt,
      cwd: containerCwd,
      model: opts.model,
      executablePath: providerExecs.opencode.executablePath,
    };
  }
  throw new Error("createSandboxedRunQuery: invocation has no provider bag");
}

const DALANG_COMPOSE_WORKSPACE = "/run/dalang/workspace";

function providerOf(opts: RunQueryOptions): "claude" | "codex" | "opencode" {
  if (opts.claude) return "claude";
  if (opts.codex) return "codex";
  if (opts.opencode) return "opencode";
  throw new Error("createSandboxedRunQuery: cannot determine provider");
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

function buildCloneBootstrapCommand(args: {
  repo: SandboxRepoCloneConfig;
  workspaceRoot: string;
  checkoutDir: string;
  shimCmd: string[];
}): string[] {
  const script = [
    "set -eu",
    `mkdir -p ${shellQuote(args.workspaceRoot)}`,
    `if [ ! -d ${shellQuote(posix.join(args.checkoutDir, ".git"))} ]; then`,
    `  rm -rf ${shellQuote(args.checkoutDir)}`,
    `  git clone ${shellQuote(args.repo.url)} ${shellQuote(args.checkoutDir)}`,
    "fi",
    `cd ${shellQuote(args.checkoutDir)}`,
    `git checkout -B ${shellQuote(basename(args.checkoutDir))} ${shellQuote(`origin/${args.repo.defaultBranch}`)} 2>/dev/null || git checkout -B ${shellQuote(basename(args.checkoutDir))}`,
    `exec ${args.shimCmd.map(shellQuote).join(" ")}`,
  ].join("\n");
  return ["sh", "-lc", script];
}

export function createSandboxedRunQuery(deps: SandboxedRunnerDeps): RunQuery {
  return (opts: RunQueryOptions): AsyncIterable<unknown> => {
    return {
      [Symbol.asyncIterator]: async function* () {
        const provider = providerOf(opts);
        const workerId = deps.workerIdFactory?.() ?? `bayang-${process.pid}-${++workerCounter}`;

        const image = await resolveImage(deps.config.image, deps.repoDir);

        // For compose-mode images the user's compose file already mounts something at
        // image.workspaceFolder (typically /workspace). Adding a second mount at the
        // same path yields undefined behavior, so dalang uses a controlled path
        // (/run/dalang/workspace) and points the agent's cwd there. Image-mode keeps
        // the worktree at image.workspaceFolder so the user's expectation holds.
        const containerWorkspaceRoot =
          image.kind === "compose" ? DALANG_COMPOSE_WORKSPACE : image.workspaceFolder;
        const containerCwd = posix.join(containerWorkspaceRoot, basename(opts.cwd));
        const bindMounts: BindMount[] =
          deps.repo === undefined
            ? [
                {
                  hostPath: dirname(opts.cwd),
                  containerPath: containerWorkspaceRoot,
                  readOnly: false,
                },
              ]
            : [];

        const shimCmd = deps.shimCmdOverride ?? [DEFAULT_SHIM_CONTAINER_PATH];
        const workerCmd =
          deps.repo === undefined
            ? shimCmd
            : buildCloneBootstrapCommand({
                repo: deps.repo,
                workspaceRoot: containerWorkspaceRoot,
                checkoutDir: containerCwd,
                shimCmd,
              });
        const invocation =
          deps.invocationOverride ??
          buildInvocation(opts, deps.config.providers, containerCwd, deps.config.git);
        const transcriptPath = join(
          deps.transcriptRoot ?? defaultSandboxTranscriptRoot(deps.sandboxesRoot),
          `${workerId}.jsonl`,
        );
        opts.onTranscriptPath?.(transcriptPath);

        yield* runWorkerSession({
          host: deps.host,
          store: deps.store,
          sandboxesRoot: deps.sandboxesRoot,
          workerId,
          image,
          bindMounts,
          resources: deps.config.resources,
          shim: { cmd: workerCmd, cwd: deps.repo === undefined ? containerCwd : undefined },
          invocation,
          provider,
          transcriptPath,
          ...(deps.onLifecycleEvent ? { onLifecycleEvent: deps.onLifecycleEvent } : {}),
          ...(opts.abortSignal ? { abortSignal: opts.abortSignal } : {}),
        });
      },
    };
  };
}
