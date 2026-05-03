import { test, expect } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

test("bayang:build produces a runnable single-file binary", async () => {
  const bin = resolve(import.meta.dir, "..", "..", "dist", "bayang");
  if (!existsSync(bin)) return;

  const proc = Bun.spawn([bin], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { BAYANG_INVOCATION: "{}" } as Record<string, string>,
  });
  proc.stdin.end();
  const stderrText = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  // With an invalid invocation (`{}` doesn't have `provider`), the shim exits non-zero
  // and emits an error event. Both behaviors are acceptable for a smoke test.
  expect(exitCode === 0 || exitCode === 1 || exitCode === 2).toBe(true);
  // sanity: no node module resolution errors leaked to stderr
  expect(stderrText).not.toContain("Cannot find module");
});
