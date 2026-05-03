import { runWorkerLoop } from "../../../src/worker/main";

async function* dump(invocation: unknown): AsyncGenerator<unknown> {
  yield invocation;
}

await runWorkerLoop({
  parseInvocation: (raw: string): unknown => JSON.parse(raw),
  runProvider: dump,
});
