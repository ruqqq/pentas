// packages/dalang/tests/cli/index.test.ts
import { expect, test } from "bun:test";

test("dalang --help exits before startup", async () => {
  const proc = Bun.spawn({
    cmd: [process.execPath, "run", "packages/dalang/src/index.ts", "--help", "--bad"],
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("Usage: dalang [WORKFLOW.md] [--port <port>]");
  expect(stderr).toBe("");
});
