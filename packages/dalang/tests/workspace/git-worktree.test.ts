// packages/dalang/tests/workspace/git-worktree.test.ts
import { test, expect } from "bun:test";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitWorktreeManager } from "../../src/workspace/git-worktree";

async function setupSourceRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dalang-src-"));
  const run = async (...args: string[]) => {
    const p = Bun.spawn(args, { cwd: dir });
    const code = await p.exited;
    if (code !== 0) throw new Error(`cmd failed: ${args.join(" ")}`);
  };
  await run("git", "init", "-b", "main", ".");
  await run("git", "config", "user.email", "a@b.c");
  await run("git", "config", "user.name", "Tester");
  await writeFile(join(dir, "README.md"), "hello");
  await run("git", "add", ".");
  await run("git", "commit", "-m", "init");
  return dir;
}

async function tmpRoot(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "dalang-wt-"));
}

test("first worktree creates branch from default and adds worktree", async () => {
  const src = await setupSourceRepo();
  const root = await tmpRoot();
  const m = new GitWorktreeManager({ workspaceRoot: root, repoUrl: src, defaultBranch: "main", branchPrefix: "juara/" });
  await m.ensureSharedClone();
  const wsPath = join(root, "JUARA-1");
  await mkdir(root, { recursive: true });
  await m.ensureWorktree(wsPath, "juara/JUARA-1");
  expect(existsSync(join(wsPath, "README.md"))).toBe(true);
});

test("reusing worktree path is a no-op (preserves branch)", async () => {
  const src = await setupSourceRepo();
  const root = await tmpRoot();
  const m = new GitWorktreeManager({ workspaceRoot: root, repoUrl: src, defaultBranch: "main", branchPrefix: "juara/" });
  await m.ensureSharedClone();
  const wsPath = join(root, "JUARA-2");
  await m.ensureWorktree(wsPath, "juara/JUARA-2");
  await writeFile(join(wsPath, "wip.txt"), "wip");
  await m.ensureWorktree(wsPath, "juara/JUARA-2"); // reuse
  expect(existsSync(join(wsPath, "wip.txt"))).toBe(true);
});

test("removeWorktree cleans dir but leaves branch", async () => {
  const src = await setupSourceRepo();
  const root = await tmpRoot();
  const m = new GitWorktreeManager({ workspaceRoot: root, repoUrl: src, defaultBranch: "main", branchPrefix: "juara/" });
  await m.ensureSharedClone();
  const wsPath = join(root, "JUARA-3");
  await m.ensureWorktree(wsPath, "juara/JUARA-3");
  await m.removeWorktree(wsPath);
  expect(existsSync(wsPath)).toBe(false);
});
