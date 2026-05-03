import { prepareWorkerCredentials, AuthError, type AuthProvider } from "../auth/projector";
import type { AuthStore } from "../auth/store";
import { remoteRunQuery } from "./remote-runner";
import { SandboxError } from "./types";
import type {
  BindMount,
  ContainerHost,
  ContainerStartOptions,
  ResolvedImage,
  SandboxResources,
} from "./types";

export interface WorkerSessionLifecycleEvent {
  kind:
    | "sandbox_unavailable"
    | "sandbox_image_unavailable"
    | "sandbox_start_failed"
    | "sandbox_exec_disconnected"
    | "sandbox_oom"
    | "sandbox_auth_refresh_conflict"
    | "sandbox_misconfigured"
    | "sandbox_session_started"
    | "sandbox_session_ended";
  message: string;
  detail?: unknown;
}

export interface WorkerSessionOptions {
  host: ContainerHost;
  store: AuthStore;
  sandboxesRoot: string;
  workerId: string;
  image: ResolvedImage;
  bindMounts: BindMount[];
  resources: SandboxResources;
  shim: { cmd: string[]; cwd?: string };
  invocation: unknown;
  provider: AuthProvider;
  transcriptPath?: string;
  onLifecycleEvent?: (e: WorkerSessionLifecycleEvent) => void;
  abortSignal?: AbortSignal;
}

function emit(opts: WorkerSessionOptions, ev: WorkerSessionLifecycleEvent): void {
  opts.onLifecycleEvent?.(ev);
}

export async function* runWorkerSession(opts: WorkerSessionOptions): AsyncGenerator<unknown> {
  emit(opts, {
    kind: "sandbox_session_started",
    message: `preparing worker ${opts.workerId} (provider=${opts.provider}, image=${opts.image.kind})`,
    detail: {
      workerId: opts.workerId,
      provider: opts.provider,
      imageKind: opts.image.kind,
      ...(opts.image.kind === "image"
        ? { imageTag: opts.image.tag }
        : {
            composeFile: opts.image.composeFile,
            composeService: opts.image.service,
          }),
    },
  });

  // 1. Project credentials.
  let creds;
  try {
    creds = await prepareWorkerCredentials({
      store: opts.store,
      provider: opts.provider,
      workerId: opts.workerId,
      sandboxesRoot: opts.sandboxesRoot,
    });
  } catch (err) {
    const message = err instanceof AuthError ? err.message : String(err);
    emit(opts, { kind: "sandbox_misconfigured", message });
    throw err;
  }

  // 2. Start container.
  let handle;
  try {
    const startOpts: ContainerStartOptions = {
      name: opts.workerId,
      image: opts.image,
      bindMounts: [...opts.bindMounts, ...creds.bindMounts],
      env: creds.env,
      resources: opts.resources,
    };
    handle = await opts.host.start(startOpts);
  } catch (err) {
    await creds.dispose().catch(() => {});
    if (err instanceof SandboxError) {
      emit(opts, { kind: err.code, message: err.message });
    } else {
      emit(opts, { kind: "sandbox_start_failed", message: String(err) });
    }
    throw err;
  }

  // 3. Stream events.
  try {
    yield* remoteRunQuery({
      handle,
      shimCmd: opts.shim.cmd,
      cwd: opts.shim.cwd,
      env: creds.env,
      invocation: opts.invocation,
      transcriptPath: opts.transcriptPath,
      abortSignal: opts.abortSignal,
    });
  } catch (err) {
    if (err instanceof SandboxError) {
      emit(opts, { kind: err.code, message: err.message, detail: err });
    } else {
      // Any unhandled error from the shim path counts as a disconnected exec.
      // Pull stderr/exitCode out of the structured Error remoteRunQuery throws.
      const e = err as Error & { stderr?: string; exitCode?: number };
      emit(opts, {
        kind: "sandbox_exec_disconnected",
        message: e.message,
        detail: {
          exitCode: e.exitCode,
          stderr: e.stderr,
        },
      });
    }
    throw err;
  } finally {
    // 4. Always tear down.
    try {
      await handle.stop();
    } catch (err) {
      emit(opts, { kind: "sandbox_start_failed", message: `stop failed: ${String(err)}` });
    }
    try {
      await creds.dispose();
    } catch (err) {
      emit(opts, {
        kind: "sandbox_auth_refresh_conflict",
        message: `credential dispose failed: ${String(err)}`,
      });
    }
    emit(opts, {
      kind: "sandbox_session_ended",
      message: `worker ${opts.workerId} session ended`,
    });
  }
}
