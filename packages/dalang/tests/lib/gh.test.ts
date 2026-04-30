import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGh } from "../../src/lib/gh";

async function makeStub(stdout: string, exit = 0): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "gh-stub-"));
  const path = join(dir, "gh");
  // single-quote-safe heredoc-ish: encode as printf with %s
  const escaped = stdout.replace(/'/g, `'\\''`);
  await writeFile(path, `#!/bin/sh\nprintf '%s' '${escaped}'\nexit ${exit}\n`);
  await chmod(path, 0o755);
  return path;
}

describe("runGh", () => {
  test("returns stdout and exit 0 for a successful invocation", async () => {
    const stub = await makeStub('{"ok":true}');
    const r = await runGh(stub, ["pr", "checks", "1"], { cwd: process.cwd() });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('{"ok":true}');
  });

  test("captures non-zero exit code", async () => {
    const stub = await makeStub("nope", 2);
    const r = await runGh(stub, ["x"], { cwd: process.cwd() });
    expect(r.exitCode).toBe(2);
    expect(r.stdout).toBe("nope");
  });

  test("propagates env to child process", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gh-stub-"));
    const path = join(dir, "gh");
    await writeFile(path, `#!/bin/sh\nprintf '%s' "$DALANG_TEST_VAR"\nexit 0\n`);
    await chmod(path, 0o755);
    const r = await runGh(path, [], { cwd: process.cwd(), env: { DALANG_TEST_VAR: "hello" } });
    expect(r.stdout).toBe("hello");
  });
});
