// A test-only stand-in for the real worker shim. Reads JSON from stdin,
// emits one provider_event per array item, then a finished event.
import { runWorkerLoop } from "../../../src/worker/main";

async function* echo(invocation: unknown): AsyncGenerator<unknown> {
  if (
    typeof invocation === "object" &&
    invocation !== null &&
    "items" in invocation &&
    Array.isArray((invocation as { items: unknown }).items)
  ) {
    for (const item of (invocation as { items: unknown[] }).items) {
      yield item;
    }
    return;
  }
  throw new Error("echo-shim: invalid input (expected { items: [...] })");
}

await runWorkerLoop({
  parseInvocation: (raw: string): unknown => JSON.parse(raw),
  runProvider: echo,
});
