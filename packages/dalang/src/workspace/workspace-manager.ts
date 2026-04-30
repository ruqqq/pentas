// packages/dalang/src/workspace/workspace-manager.ts
import { mkdir, stat, rm } from "node:fs/promises";
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
