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
    | "sandbox_misconfigured";
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
  onLifecycleEvent?: (e: WorkerSessionLifecycleEvent) => void;
  abortSignal?: AbortSignal;
}

function emit(opts: WorkerSessionOptions, ev: WorkerSessionLifecycleEvent): void {
  opts.onLifecycleEvent?.(ev);
}

export async function* runWorkerSession(opts: WorkerSessionOptions): AsyncGenerator<unknown> {
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
      abortSignal: opts.abortSignal,
    });
  } catch (err) {
    if (err instanceof SandboxError) {
      emit(opts, { kind: err.code, message: err.message });
    } else if ((err as Error).message?.includes("worker shim error")) {
      emit(opts, { kind: "sandbox_exec_disconnected", message: (err as Error).message });
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
  }
}
