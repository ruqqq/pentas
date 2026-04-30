// packages/dalang/tests/workspace/hooks.test.ts
import { test, expect } from "bun:test";
import { mkdtemp, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHook } from "../../src/workspace/hooks";

async function tmp(): Promise<string> {
  return await realpath(await mkdtemp(join(tmpdir(), "dalang-hooks-")));
}

test("runs script with workspace as cwd and exposes env", async () => {
  const cwd = await tmp();
  const result = await runHook({
    name: "after_create",
    script: 'echo "$ISSUE_IDENTIFIER" > out.txt && pwd > pwd.txt',
    cwd,
    env: { ISSUE_IDENTIFIER: "PENTAS-1" },
    timeoutMs: 5000,
  });
  expect(result.ok).toBe(true);
  expect((await readFile(join(cwd, "out.txt"), "utf8")).trim()).toBe("PENTAS-1");
  expect((await readFile(join(cwd, "pwd.txt"), "utf8")).trim()).toBe(cwd);
});

test("returns ok=false on non-zero exit", async () => {
  const cwd = await tmp();
  const result = await runHook({
    name: "before_run",
    script: "exit 17",
    cwd,
    env: {},
    timeoutMs: 5000,
  });
  expect(result.ok).toBe(false);
  expect(result.exitCode).toBe(17);
});

test("returns timeout=true after timeoutMs", async () => {
  const cwd = await tmp();
  const result = await runHook({
    name: "after_create",
    script: "sleep 5",
    cwd,
    env: {},
    timeoutMs: 200,
  });
  expect(result.ok).toBe(false);
  expect(result.timedOut).toBe(true);
});

test("returns null result for null/empty script", async () => {
  const cwd = await tmp();
  expect(await runHook({ name: "after_run", script: null, cwd, env: {}, timeoutMs: 1000 })).toEqual(
    { ok: true, skipped: true },
  );
  expect(await runHook({ name: "after_run", script: "", cwd, env: {}, timeoutMs: 1000 })).toEqual({
    ok: true,
    skipped: true,
  });
});
