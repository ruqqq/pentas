// packages/dalang/src/workspace/git-worktree.ts
import { existsSync } from "node:fs";
import { rm, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

export interface GitWorktreeOptions {
  workspaceRoot: string;
  repoUrl: string;
  defaultBranch: string;
  branchPrefix: string;
}

export class GitWorktreeError extends Error {}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
}

async function git(
  cwd: string,
  args: string[],
): Promise<{ ok: boolean; stdout: string; stderr: string; exitCode: number }> {
  const p = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const exitCode = await p.exited;
  return {
    ok: exitCode === 0,
    stdout: await new Response(p.stdout).text(),
    stderr: await new Response(p.stderr).text(),
    exitCode,
  };
}

export class GitWorktreeManager {
  private readonly opts: GitWorktreeOptions;
  private readonly sharedClonePath: string;

  constructor(opts: GitWorktreeOptions) {
    this.opts = opts;
    this.sharedClonePath = join(resolve(opts.workspaceRoot), ".repo.git");
  }

  branchName(input: { externalRef: string | null; title: string }): string {
    if (input.externalRef && input.externalRef.trim() !== "") {
      return `${this.opts.branchPrefix}${slugify(input.externalRef)}`;
    }
    return `${this.opts.branchPrefix}feat/${slugify(input.title) || "untitled"}`;
  }

  sharedPath(): string {
    return this.sharedClonePath;
  }

  async ensureSharedClone(): Promise<void> {
    if (existsSync(this.sharedClonePath)) return;
    await mkdir(this.opts.workspaceRoot, { recursive: true });
    const r = await git(this.opts.workspaceRoot, [
      "clone",
      "--bare",
      this.opts.repoUrl,
      ".repo.git",
    ]);
    if (!r.ok) throw new GitWorktreeError(`clone failed: ${r.stderr}`);
  }

  async ensureWorktree(workspacePath: string, branch: string): Promise<void> {
    await this.ensureSharedClone();
    if (existsSync(join(workspacePath, ".git"))) return;
    if (existsSync(workspacePath)) await rm(workspacePath, { recursive: true, force: true });
    const fetch = await git(this.sharedClonePath, ["fetch", "origin"]);
    if (!fetch.ok) throw new GitWorktreeError(`fetch failed: ${fetch.stderr}`);

    const branchExists = await git(this.sharedClonePath, [
      "show-ref",
      "--verify",
      "--quiet",
      `refs/heads/${branch}`,
    ]);
    if (branchExists.ok) {
      const r = await git(this.sharedClonePath, ["worktree", "add", workspacePath, branch]);
      if (!r.ok) throw new GitWorktreeError(`worktree add (existing branch) failed: ${r.stderr}`);
    } else {
      const r = await git(this.sharedClonePath, [
        "worktree",
        "add",
        workspacePath,
        "-b",
        branch,
        this.opts.defaultBranch,
      ]);
      if (!r.ok) throw new GitWorktreeError(`worktree add (new branch) failed: ${r.stderr}`);
    }
  }

  async removeWorktree(workspacePath: string): Promise<void> {
    if (!existsSync(this.sharedClonePath) || !existsSync(workspacePath)) {
      if (existsSync(workspacePath)) await rm(workspacePath, { recursive: true, force: true });
      return;
    }
    await git(this.sharedClonePath, ["worktree", "remove", "--force", workspacePath]);
    if (existsSync(workspacePath)) await rm(workspacePath, { recursive: true, force: true });
  }
}
