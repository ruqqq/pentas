import { WorkerInvocationSchema, serializeEvent, type WorkerEvent, type WorkerInvocation } from "./protocol";
import { runClaude } from "./claude";

export interface WorkerLoopOptions<I> {
  parseInvocation: (raw: string) => I;
  runProvider: (invocation: I, signal: AbortSignal) => AsyncGenerator<unknown>;
}

async function readAllStdin(): Promise<string> {
  const decoder = new TextDecoder();
  let out = "";
  const reader = Bun.stdin.stream().getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

function emit(ev: WorkerEvent): void {
  Bun.write(Bun.stdout, serializeEvent(ev) + "\n");
}

export async function runWorkerLoop<I>(opts: WorkerLoopOptions<I>): Promise<never> {
  const ac = new AbortController();
  const onSignal = () => ac.abort();
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);

  let exitCode = 0;
  try {
    const raw = await readAllStdin();
    let invocation: I;
    try {
      invocation = opts.parseInvocation(raw);
    } catch (err) {
      emit({ kind: "error", message: `invalid invocation: ${(err as Error).message}` });
      process.exit(2);
    }

    try {
      for await (const ev of opts.runProvider(invocation, ac.signal)) {
        emit({ kind: "provider_event", payload: ev });
      }
      emit({ kind: "finished" });
    } catch (err) {
      emit({ kind: "error", message: (err as Error).message });
      exitCode = 1;
    }
  } finally {
    process.off("SIGTERM", onSignal);
    process.off("SIGINT", onSignal);
  }
  process.exit(exitCode);
}

function dispatch(inv: WorkerInvocation, signal: AbortSignal): AsyncGenerator<unknown> {
  switch (inv.provider) {
    case "claude":
      return runClaude(inv, signal);
    case "codex":
      throw new Error("codex provider not yet implemented (Task 4)");
    case "opencode":
      throw new Error("opencode provider not yet implemented (Task 5)");
  }
}

// When run directly as `bun run main.ts`, run the real loop.
if (import.meta.main) {
  await runWorkerLoop({
    parseInvocation: (raw) => WorkerInvocationSchema.parse(JSON.parse(raw)),
    runProvider: dispatch,
  });
}
