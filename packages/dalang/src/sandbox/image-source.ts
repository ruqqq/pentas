import { access } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { createHash } from "node:crypto";
import { SandboxError, type ResolvedImage, type SandboxImageConfig } from "./types";

const DEFAULT_WORKSPACE_FOLDER = "/workspace";

function shortHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 12);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function resolveImage(
  config: SandboxImageConfig,
  repoDir: string,
): Promise<ResolvedImage> {
  if (!isAbsolute(repoDir)) {
    throw new SandboxError(
      "sandbox_misconfigured",
      `resolveImage requires absolute repoDir, got "${repoDir}"`,
    );
  }

  if (config.source === "image") {
    return {
      kind: "image",
      tag: config.tag,
      workspaceFolder: DEFAULT_WORKSPACE_FOLDER,
      remoteUser: null,
      postCreateCommand: null,
    };
  }

  if (config.source === "dockerfile") {
    const abs = resolve(repoDir, config.path);
    if (!(await fileExists(abs))) {
      throw new SandboxError(
        "sandbox_misconfigured",
        `Dockerfile not found at ${abs}`,
      );
    }
    return {
      kind: "image",
      tag: `dalang-build:${shortHash(abs)}`,
      workspaceFolder: DEFAULT_WORKSPACE_FOLDER,
      remoteUser: null,
      postCreateCommand: null,
    };
  }

  // devcontainer — implemented in Task 4.
  throw new SandboxError(
    "sandbox_misconfigured",
    `devcontainer source not yet supported`,
  );
}
