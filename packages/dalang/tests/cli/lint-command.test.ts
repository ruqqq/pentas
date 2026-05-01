import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";

function runDalang(args: string[]): Bun.Subprocess<"pipe", "pipe", "pipe"> {
  return Bun.spawn({
    cmd: ["bun", "run", "packages/dalang/src/index.ts", ...args],
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });
}

test("dalang lint exits 0 for a valid workflow", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dalang-lint-cli-"));
  const path = join(dir, "WORKFLOW.md");
  await writeFile(path, "---\n---\n{{ issue.identifier }}\n");

  const proc = runDalang(["lint", path]);
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  expect(exitCode).toBe(0);
  expect(stdout).toContain(`OK: ${path}`);
});

test("dalang lint exits 1 and prints diagnostics for an invalid workflow", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dalang-lint-cli-"));
  const path = join(dir, "WORKFLOW.md");
  await writeFile(path, "---\n---\n{{ recent_history.summary }}\n");

  const proc = runDalang(["lint", path]);
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  expect(exitCode).toBe(1);
  expect(stderr).toContain("Unknown Liquid variable path `recent_history.summary`");
});
