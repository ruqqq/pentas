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
  const m = new GitWorktreeManager({
    workspaceRoot: root,
    repoUrl: src,
    defaultBranch: "main",
    branchPrefix: "pentas/",
  });
  await m.ensureSharedClone();
  const wsPath = join(root, "PENTAS-1");
  await mkdir(root, { recursive: true });
  await m.ensureWorktree(wsPath, "pentas/PENTAS-1");
  expect(existsSync(join(wsPath, "README.md"))).toBe(true);
});

test("empty pre-existing dir is replaced by a real worktree", async () => {
  const src = await setupSourceRepo();
  const root = await tmpRoot();
  const m = new GitWorktreeManager({
    workspaceRoot: root,
    repoUrl: src,
    defaultBranch: "main",
    branchPrefix: "pentas/",
  });
  await m.ensureSharedClone();
  const wsPath = join(root, "EMPTY-1");
  await mkdir(wsPath, { recursive: true });
  await m.ensureWorktree(wsPath, "pentas/EMPTY-1");
  expect(existsSync(join(wsPath, "README.md"))).toBe(true);
  expect(existsSync(join(wsPath, ".git"))).toBe(true);
});

test("reusing worktree path is a no-op (preserves branch)", async () => {
  const src = await setupSourceRepo();
  const root = await tmpRoot();
  const m = new GitWorktreeManager({
    workspaceRoot: root,
    repoUrl: src,
    defaultBranch: "main",
    branchPrefix: "pentas/",
  });
  await m.ensureSharedClone();
  const wsPath = join(root, "PENTAS-2");
  await m.ensureWorktree(wsPath, "pentas/PENTAS-2");
  await writeFile(join(wsPath, "wip.txt"), "wip");
  await m.ensureWorktree(wsPath, "pentas/PENTAS-2"); // reuse
  expect(existsSync(join(wsPath, "wip.txt"))).toBe(true);
});

test("branchName uses external_ref when present", () => {
  const m = new GitWorktreeManager({
    workspaceRoot: "/tmp",
    repoUrl: "x",
    defaultBranch: "main",
    branchPrefix: "claude/",
  });
  expect(m.branchName({ externalRef: "ENG-123", title: "anything" })).toBe("claude/eng-123");
  expect(m.branchName({ externalRef: "ABC-7", title: "Fix the login" })).toBe("claude/abc-7");
});

test("branchName falls back to feat/<title-slug> when external_ref missing", () => {
  const m = new GitWorktreeManager({
    workspaceRoot: "/tmp",
    repoUrl: "x",
    defaultBranch: "main",
    branchPrefix: "claude/",
  });
  expect(m.branchName({ externalRef: null, title: "Fix the login bug!" })).toBe(
    "claude/feat/fix-the-login-bug",
  );
  expect(m.branchName({ externalRef: "", title: "Make it work" })).toBe("claude/feat/make-it-work");
  expect(m.branchName({ externalRef: null, title: "" })).toBe("claude/feat/untitled");
});

test("branchName slugifies long titles to a sane length", () => {
  const m = new GitWorktreeManager({
    workspaceRoot: "/tmp",
    repoUrl: "x",
    defaultBranch: "main",
    branchPrefix: "",
  });
  const out = m.branchName({
    externalRef: null,
    title: "A very long title that should be truncated to a reasonable length for branch naming",
  });
  expect(out.startsWith("feat/")).toBe(true);
  expect(out.length).toBeLessThanOrEqual(60);
});

test("removeWorktree cleans dir but leaves branch", async () => {
  const src = await setupSourceRepo();
  const root = await tmpRoot();
  const m = new GitWorktreeManager({
    workspaceRoot: root,
    repoUrl: src,
    defaultBranch: "main",
    branchPrefix: "pentas/",
  });
  await m.ensureSharedClone();
  const wsPath = join(root, "PENTAS-3");
  await m.ensureWorktree(wsPath, "pentas/PENTAS-3");
  await m.removeWorktree(wsPath);
  expect(existsSync(wsPath)).toBe(false);
});
