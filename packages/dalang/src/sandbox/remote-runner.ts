import type { ContainerHandle } from "./types";

export interface RemoteRunOptions {
  handle: ContainerHandle;
  /** The command to exec inside the container, e.g. `["/opt/dalang/dalang-worker"]` or `["bun", "run", "src/worker/main.ts"]`. */
  shimCmd: string[];
  /** Working directory inside the container for the shim. Optional. */
  cwd?: string;
  /** Extra env to inject for the shim. */
  env?: Record<string, string>;
  /** Cancels the underlying exec via the host's abort plumbing. */
  abortSignal?: AbortSignal;
  /** JSON-serializable invocation written to the shim's stdin once at startup. */
  invocation: unknown;
}

interface ProviderEvent {
  kind: "provider_event";
  payload: unknown;
}
interface ErrorEvent {
  kind: "error";
  message: string;
  detail?: unknown;
}
interface FinishedEvent {
  kind: "finished";
}
type WorkerEvent = ProviderEvent | ErrorEvent | FinishedEvent;

function isWorkerEvent(value: unknown): value is WorkerEvent {
  if (typeof value !== "object" || value === null || !("kind" in value)) return false;
  const k = (value as { kind: unknown }).kind;
  return k === "provider_event" || k === "error" || k === "finished";
}

export async function* remoteRunQuery(opts: RemoteRunOptions): AsyncGenerator<unknown> {
  // ContainerHandle.exec doesn't support stdin in Phase 1's API. We pass the
  // invocation JSON via an env var: the shim reads it from env when stdin is
  // empty. (Stdin support is a Phase 4 follow-up.)
  const invocationJson = JSON.stringify(opts.invocation);

  const exec = await opts.handle.exec({
    cmd: opts.shimCmd,
    cwd: opts.cwd,
    env: { ...(opts.env ?? {}), DALANG_WORKER_INVOCATION: invocationJson },
    abortSignal: opts.abortSignal,
  });

  let sawFinished = false;
  let sawError: ErrorEvent | null = null;

  for await (const line of exec.stdout) {
    if (line.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue; // ignore non-JSON noise
    }
    if (!isWorkerEvent(parsed)) continue;
    if (parsed.kind === "provider_event") {
      yield parsed.payload;
    } else if (parsed.kind === "error") {
      sawError = parsed;
      break;
    } else if (parsed.kind === "finished") {
      sawFinished = true;
      break;
    }
  }

  // Drain stderr to surface useful debug info on failure.
  let stderrTail = "";
  for await (const line of exec.stderr) {
    if (stderrTail.length < 4000) stderrTail += `${line}\n`;
  }

  const status = await exec.done;

  if (sawError) {
    throw new Error(`worker shim error: ${sawError.message}\nstderr: ${stderrTail.trim()}`);
  }
  if (!sawFinished && status.exitCode !== 0) {
    throw new Error(`worker shim exited ${status.exitCode}\nstderr: ${stderrTail.trim()}`);
  }
}
