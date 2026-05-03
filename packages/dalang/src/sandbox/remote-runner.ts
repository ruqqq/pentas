import type { ContainerHandle } from "./types";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export interface RemoteRunOptions {
  handle: ContainerHandle;
  /** The command to exec inside the container, e.g. `["/opt/dalang/bayang"]` or `["bun", "run", "src/worker/main.ts"]`. */
  shimCmd: string[];
  /** Working directory inside the container for the shim. Optional. */
  cwd?: string;
  /** Extra env to inject for the shim. */
  env?: Record<string, string>;
  /** Cancels the underlying exec via the host's abort plumbing. */
  abortSignal?: AbortSignal;
  /** JSON-serializable invocation written to the shim's stdin once at startup. */
  invocation: unknown;
  /** Optional host-side JSONL path for raw provider events streamed by the shim. */
  transcriptPath?: string;
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

async function collectStderrTail(stderr: AsyncIterable<string>): Promise<string> {
  let stderrTail = "";
  for await (const line of stderr) {
    if (stderrTail.length < 4000) stderrTail += `${line}\n`;
  }
  return stderrTail.trim();
}

async function recordTranscriptEvent(path: string, payload: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(payload)}\n`, "utf8");
}

export async function* remoteRunQuery(opts: RemoteRunOptions): AsyncGenerator<unknown> {
  // ContainerHandle.exec doesn't support stdin in Phase 1's API. We pass the
  // invocation JSON via an env var: bayang reads it from env when stdin is
  // empty. (Stdin support is a Phase 4 follow-up.)
  const invocationJson = JSON.stringify(opts.invocation);

  const exec = await opts.handle.exec({
    cmd: opts.shimCmd,
    cwd: opts.cwd,
    env: { ...opts.env, BAYANG_INVOCATION: invocationJson },
    abortSignal: opts.abortSignal,
  });

  let sawFinished = false;
  let sawError: ErrorEvent | null = null;
  const stderrTail = collectStderrTail(exec.stderr);

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
      if (opts.transcriptPath) await recordTranscriptEvent(opts.transcriptPath, parsed.payload);
      yield parsed.payload;
    } else if (parsed.kind === "error") {
      sawError = parsed;
      break;
    } else if (parsed.kind === "finished") {
      sawFinished = true;
      break;
    }
  }

  const [status, stderr] = await Promise.all([exec.done, stderrTail]);

  if (sawError) {
    const err = new Error(`worker shim error: ${sawError.message}`);
    (err as Error & { stderr?: string; exitCode?: number; cause?: unknown }).stderr = stderr;
    (err as Error & { stderr?: string; exitCode?: number }).exitCode = status.exitCode;
    if (sawError.detail !== undefined) {
      (err as Error & { cause?: unknown }).cause = sawError.detail;
    }
    throw err;
  }
  if (!sawFinished && status.exitCode !== 0) {
    const err = new Error(`worker shim exited ${status.exitCode}`);
    (err as Error & { stderr?: string; exitCode?: number }).stderr = stderr;
    (err as Error & { stderr?: string; exitCode?: number }).exitCode = status.exitCode;
    throw err;
  }
}
