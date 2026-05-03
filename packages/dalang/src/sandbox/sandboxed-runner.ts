import type { RunQuery, RunQueryOptions } from "../agent/agent-runner";
import type { AuthStore } from "../auth/store";
import type { SandboxConfig } from "../config/sandbox-schema";
import { basename, dirname, join, posix } from "node:path";
import { resolveImage } from "./image-source";
import { runWorkerSession, type WorkerSessionLifecycleEvent } from "./worker-lifecycle";
import type { ContainerHost, BindMount, ResolvedImage } from "./types";

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

function workspaceRootForImage(image: ResolvedImage): string {
  return image.kind === "compose" ? DALANG_COMPOSE_WORKSPACE : image.workspaceFolder;
}

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
  const sshConfigDir = "/tmp/.ssh";
  const githubTokenShellExpr =
    "${GH_TOKEN:-${GITHUB_TOKEN:-}}"; // explicit precedence for GH_TOKEN over GITHUB_TOKEN
  const script = [
    "set -eu",
    `if command -v ssh >/dev/null 2>&1; then`,
    `  mkdir -p ${shellQuote(sshConfigDir)}`,
    `  chmod 700 ${shellQuote(sshConfigDir)}`,
    `  export GIT_SSH_COMMAND="ssh -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=${shellQuote(
      posix.join(sshConfigDir, "known_hosts"),
    )}"`,
    "fi",
    `if [ -n "${githubTokenShellExpr}" ]; then`,
    "  git config --global credential.https://github.com.username x-access-token",
    "  git config --global credential.https://github.com.helper '!f() { echo username=x-access-token; echo password=${GH_TOKEN:-$GITHUB_TOKEN}; }; f'",
    "  git config --global --add url.https://github.com/.insteadOf git@github.com:",
    "  git config --global --add url.https://github.com/.insteadOf ssh://git@github.com/",
    "fi",
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

function cloneBootstrapEnv(
  opts: RunQueryOptions,
  providerExecs: SandboxConfig["providers"],
): Record<string, string> {
  if (opts.codex === undefined) return {};
  const env: Record<string, string> = {};
  if (opts.codex.env !== undefined) Object.assign(env, opts.codex.env);
  if (providerExecs.codex.env !== undefined) Object.assign(env, providerExecs.codex.env);
  return env;
}

export function createSandboxedRunQuery(deps: SandboxedRunnerDeps): RunQuery {
  return (opts: RunQueryOptions): AsyncIterable<unknown> => {
    return {
      [Symbol.asyncIterator]: async function* () {
        const provider = providerOf(opts);
        const workerId = deps.workerIdFactory?.() ?? `bayang-${process.pid}-${++workerCounter}`;

        const image = await resolveImage(deps.config.image, deps.repoDir);

        // For bind-mount mode, compose images usually already mount
        // image.workspaceFolder, so we intentionally use a separate mount target
        // to avoid undefined compose overlay behavior.
        // For clone mode, no host mount is used and we can safely operate at
        // image.workspaceFolder, matching the compose image's expected workspace
        // layout.
        const containerWorkspaceRoot =
          deps.repo === undefined ? workspaceRootForImage(image) : image.workspaceFolder;
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
        const bootstrapEnv = cloneBootstrapEnv(opts, deps.config.providers);
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
          bootstrapEnv,
          transcriptPath,
          ...(deps.onLifecycleEvent ? { onLifecycleEvent: deps.onLifecycleEvent } : {}),
          ...(opts.abortSignal ? { abortSignal: opts.abortSignal } : {}),
        });
      },
    };
  };
}
