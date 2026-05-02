import type { RunQuery, RunQueryOptions } from "../agent/agent-runner";
import type { AuthStore } from "../auth/store";
import type { SandboxConfig } from "../config/sandbox-schema";
import { resolveImage } from "./image-source";
import { runWorkerSession, type WorkerSessionLifecycleEvent } from "./worker-lifecycle";
import type { ContainerHost, BindMount } from "./types";

export interface SandboxedRunnerDeps {
  host: ContainerHost;
  store: AuthStore;
  /** Where per-worker tmpdirs live (e.g. dalang state dir). */
  sandboxesRoot: string;
  /** Absolute path to the repo on the host. */
  repoDir: string;
  config: SandboxConfig;
  /** Path to the compiled dalang-worker binary on the host (Phase 2 artifact). */
  shimBinaryHostPath?: string;
  /** Override the exec command (testing). Default uses `/opt/dalang/dalang-worker`. */
  shimCmdOverride?: string[];
  /** Override the invocation payload (testing). Default builds from RunQueryOptions. */
  invocationOverride?: unknown;
  /** Optional sink for sandbox lifecycle events. */
  onLifecycleEvent?: (e: WorkerSessionLifecycleEvent) => void;
  /** Counter or hook to produce stable per-worker IDs. */
  workerIdFactory?: () => string;
}

const DEFAULT_SHIM_CONTAINER_PATH = "/opt/dalang/dalang-worker";

let workerCounter = 0;

function buildInvocation(
  opts: RunQueryOptions,
  providerExecs: SandboxConfig["providers"],
  containerCwd: string,
): unknown {
  if (opts.claude) {
    return {
      provider: "claude",
      prompt: opts.prompt,
      cwd: containerCwd,
      model: opts.model,
      executablePath: providerExecs.claude.executablePath,
      ...(opts.resumeSessionId !== undefined ? { resumeSessionId: opts.resumeSessionId } : {}),
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
      ...(opts.resumeSessionId !== undefined ? { resumeSessionId: opts.resumeSessionId } : {}),
      codex: {
        sandboxMode: opts.codex.sandboxMode,
        approvalPolicy: opts.codex.approvalPolicy,
        networkAccessEnabled: opts.codex.networkAccessEnabled,
        ...(providerExecs.codex.env !== undefined || opts.codex.env !== undefined
          ? { env: { ...opts.codex.env, ...providerExecs.codex.env } }
          : {}),
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
      ...(opts.resumeSessionId !== undefined ? { resumeSessionId: opts.resumeSessionId } : {}),
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

export function createSandboxedRunQuery(deps: SandboxedRunnerDeps): RunQuery {
  return (opts: RunQueryOptions): AsyncIterable<unknown> => {
    return {
      [Symbol.asyncIterator]: async function* () {
        const provider = providerOf(opts);
        const workerId =
          deps.workerIdFactory?.() ?? `dalang-worker-${process.pid}-${++workerCounter}`;

        const image = await resolveImage(deps.config.image, deps.repoDir);

        // For compose-mode images the user's compose file already mounts something at
        // image.workspaceFolder (typically /workspace). Adding a second mount at the
        // same path yields undefined behavior, so dalang uses a controlled path
        // (/run/dalang/workspace) and points the agent's cwd there. Image-mode keeps
        // the worktree at image.workspaceFolder so the user's expectation holds.
        const containerCwd =
          image.kind === "compose" ? DALANG_COMPOSE_WORKSPACE : image.workspaceFolder;
        const worktreeMount: BindMount = {
          hostPath: opts.cwd,
          containerPath: containerCwd,
          readOnly: false,
        };
        const shimMount: BindMount[] = deps.shimBinaryHostPath
          ? [
              {
                hostPath: deps.shimBinaryHostPath,
                containerPath: DEFAULT_SHIM_CONTAINER_PATH,
                readOnly: true,
              },
            ]
          : [];

        const shimCmd = deps.shimCmdOverride ?? [DEFAULT_SHIM_CONTAINER_PATH];
        const invocation =
          deps.invocationOverride ?? buildInvocation(opts, deps.config.providers, containerCwd);

        yield* runWorkerSession({
          host: deps.host,
          store: deps.store,
          sandboxesRoot: deps.sandboxesRoot,
          workerId,
          image,
          bindMounts: [worktreeMount, ...shimMount],
          resources: deps.config.resources,
          shim: { cmd: shimCmd, cwd: containerCwd },
          invocation,
          provider,
          ...(deps.onLifecycleEvent ? { onLifecycleEvent: deps.onLifecycleEvent } : {}),
          ...(opts.abortSignal ? { abortSignal: opts.abortSignal } : {}),
        });
      },
    };
  };
}
