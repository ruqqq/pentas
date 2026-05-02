import { test, expect } from "bun:test";
import { resolve } from "node:path";
import type { WorkerEvent } from "../../src/worker/protocol";

const fixtureShim = resolve(import.meta.dir, "..", "fixtures", "worker", "echo-shim.ts");

async function runShim(stdinJson: string): Promise<{ stdout: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", fixtureShim], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.write(stdinJson);
  proc.stdin.end();
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { stdout, exitCode };
}

test("echo-shim writes one provider_event per line and a final finished event", async () => {
  const out = await runShim('{"items":[{"a":1},{"b":2}]}');
  const lines = out.stdout.trim().split("\n");
  const events = lines.map((l) => JSON.parse(l) as WorkerEvent);
  expect(events).toEqual([
    { kind: "provider_event", payload: { a: 1 } },
    { kind: "provider_event", payload: { b: 2 } },
    { kind: "finished" },
  ]);
  expect(out.exitCode).toBe(0);
});

test("echo-shim emits an error event and exits non-zero on bad input", async () => {
  const out = await runShim("not json");
  const lines = out.stdout.trim().split("\n");
  const events = lines.map((l) => JSON.parse(l) as WorkerEvent);
  expect(events.length).toBe(1);
  expect(events[0]?.kind).toBe("error");
  expect(out.exitCode).not.toBe(0);
});
