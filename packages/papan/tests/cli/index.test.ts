// packages/papan/tests/cli/index.test.ts
import { expect, test } from "bun:test";

test("papan --help exits before startup", async () => {
  const proc = Bun.spawn({
    cmd: [process.execPath, "run", "packages/papan/src/index.ts", "--help", "--bad"],
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("Usage: papan [--port <port>] [--db <path>]");
  expect(stderr).toBe("");
});
