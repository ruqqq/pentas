// packages/dalang/src/workspace/workspace-manager.ts
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join, sep } from "node:path";
import { sanitizeWorkspaceKey } from "./sanitize";
import type { WorkspaceMeta } from "../types";

export type WorkspaceErrorCode =
  | "workspace_create_error"
  | "workspace_path_outside_root"
  | "workspace_collision";

export class WorkspaceError extends Error {
  code: WorkspaceErrorCode;
  constructor(code: WorkspaceErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const WORKSPACE_CLAIM_FILE = ".dalang-workspace-owner.json";

export interface WorkspaceClaim {
  ownerId: string;
  issueId: string;
  pid: number;
  claimedAt: string;
}

export interface WorkspaceManagerOptions {
  root: string;
}

export class WorkspaceManager {
  private readonly root: string;

  constructor(opts: WorkspaceManagerOptions) {
    this.root = resolve(opts.root);
  }

  rootPath(): string {
    return this.root;
  }

  pathFor(identifier: string): string {
    const key = sanitizeWorkspaceKey(identifier);
    const path = resolve(this.root, key);
    if (path !== this.root && !path.startsWith(this.root + sep)) {
      throw new WorkspaceError("workspace_path_outside_root", `${path} is not under ${this.root}`);
    }
    return path;
  }

  async ensureWorkspace(identifier: string): Promise<WorkspaceMeta> {
    const key = sanitizeWorkspaceKey(identifier);
    const path = this.pathFor(identifier);
    let createdNow = false;

    if (existsSync(path)) {
      const st = await stat(path);
      if (!st.isDirectory()) {
        throw new WorkspaceError("workspace_create_error", `${path} exists and is not a directory`);
      }
    } else {
      await mkdir(this.root, { recursive: true });
      await mkdir(path, { recursive: false });
      createdNow = true;
    }

    return { path, workspace_key: key, created_now: createdNow };
  }

  claimPath(identifier: string): string {
    return join(this.pathFor(identifier), WORKSPACE_CLAIM_FILE);
  }

  private parseClaim(raw: string): WorkspaceClaim | null {
    try {
      const parsed = JSON.parse(raw) as WorkspaceClaim;
      if (
        typeof parsed.ownerId !== "string" ||
        typeof parsed.issueId !== "string" ||
        typeof parsed.pid !== "number" ||
        typeof parsed.claimedAt !== "string"
      ) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  isPidAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === "EPERM";
    }
  }

  async readWorkspaceClaim(identifier: string): Promise<WorkspaceClaim | null> {
    try {
      const raw = await readFile(this.claimPath(identifier), "utf8");
      return this.parseClaim(raw);
    } catch {
      return null;
    }
  }

  async listOrphanWorkspaceClaims(): Promise<
    Array<{ identifier: string; path: string; claim: WorkspaceClaim }>
  > {
    if (!existsSync(this.root)) return [];
    const out: Array<{ identifier: string; path: string; claim: WorkspaceClaim }> = [];
    const rootEntries = await readdir(this.root, { withFileTypes: true });
    for (const entry of rootEntries) {
      if (!entry.isDirectory()) continue;
      const identifier = entry.name;
      const claim = await this.readWorkspaceClaim(identifier);
      if (!claim) continue;
      if (!this.isPidAlive(claim.pid)) {
        out.push({ identifier, path: join(this.root, identifier), claim });
      }
    }
    return out;
  }

  async claimWorkspace(identifier: string, ownerId: string, issueId: string): Promise<void> {
    const path = this.pathFor(identifier);
    const claimFile = join(path, WORKSPACE_CLAIM_FILE);
    const existing = await this.readWorkspaceClaim(identifier);
    if (existing && this.isPidAlive(existing.pid)) {
      if (existing.ownerId !== ownerId) {
        throw new WorkspaceError(
          "workspace_collision",
          `workspace ${path} already claimed by active owner ${existing.ownerId}`,
        );
      }
      return;
    }
    await writeFile(
      claimFile,
      JSON.stringify(
        {
          ownerId,
          issueId,
          pid: process.pid,
          claimedAt: new Date().toISOString(),
        } satisfies WorkspaceClaim,
        null,
        2,
      ) + "\n",
      "utf8",
    );
  }

  async isWorkspaceOwnedBy(identifier: string, ownerId: string): Promise<boolean> {
    const claim = await this.readWorkspaceClaim(identifier);
    return claim?.ownerId === ownerId;
  }

  async releaseWorkspaceClaim(identifier: string, ownerId: string): Promise<void> {
    const claim = await this.readWorkspaceClaim(identifier);
    if (!claim || claim.ownerId !== ownerId) return;
    await rm(this.claimPath(identifier), { force: true });
  }

  async removeWorkspace(identifier: string): Promise<void> {
    const path = this.pathFor(identifier);
    if (!existsSync(path)) return;
    await rm(path, { recursive: true, force: true });
  }

  async assertCwdIsWorkspace(identifier: string, cwd: string): Promise<void> {
    const expected = this.pathFor(identifier);
    if (resolve(cwd) !== expected) {
      throw new WorkspaceError(
        "workspace_path_outside_root",
        `expected cwd ${expected}, got ${cwd}`,
      );
    }
  }
}
