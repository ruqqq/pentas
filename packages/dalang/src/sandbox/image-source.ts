import { access } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
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
      build: { dockerfile: abs, contextDir: repoDir },
      workspaceFolder: DEFAULT_WORKSPACE_FOLDER,
      remoteUser: null,
      postCreateCommand: null,
    };
  }

  // devcontainer
  const dcDir = resolve(repoDir, config.path);
  const dcJsonPath = join(dcDir, "devcontainer.json");
  if (!(await fileExists(dcJsonPath))) {
    throw new SandboxError(
      "sandbox_misconfigured",
      `devcontainer.json not found at ${dcJsonPath}`,
    );
  }

  const raw = await Bun.file(dcJsonPath).text();
  const json = parseDevcontainerJson(raw, dcJsonPath);

  const workspaceFolder =
    typeof json.workspaceFolder === "string" ? json.workspaceFolder : DEFAULT_WORKSPACE_FOLDER;
  const remoteUser = typeof json.remoteUser === "string" ? json.remoteUser : null;
  const postCreateCommand =
    typeof json.postCreateCommand === "string" ? json.postCreateCommand : null;

  if (typeof json.dockerComposeFile === "string") {
    if (typeof json.service !== "string" || json.service.length === 0) {
      throw new SandboxError(
        "sandbox_misconfigured",
        `devcontainer.json at ${dcJsonPath} declares dockerComposeFile but no service`,
      );
    }
    return {
      kind: "compose",
      composeFile: resolve(dcDir, json.dockerComposeFile),
      service: json.service,
      workspaceFolder,
      remoteUser,
      postCreateCommand,
    };
  }

  if (
    json.build !== undefined &&
    typeof json.build === "object" &&
    json.build !== null &&
    typeof (json.build as { dockerfile?: unknown }).dockerfile === "string"
  ) {
    const dfRel = (json.build as { dockerfile: string }).dockerfile;
    const dfAbs = resolve(dcDir, dfRel);
    if (!(await fileExists(dfAbs))) {
      throw new SandboxError(
        "sandbox_misconfigured",
        `devcontainer build.dockerfile not found at ${dfAbs}`,
      );
    }
    return {
      kind: "image",
      tag: `dalang-build:${shortHash(dfAbs)}`,
      build: { dockerfile: dfAbs, contextDir: dcDir },
      workspaceFolder,
      remoteUser,
      postCreateCommand,
    };
  }

  if (typeof json.image === "string") {
    return {
      kind: "image",
      tag: json.image,
      workspaceFolder,
      remoteUser,
      postCreateCommand,
    };
  }

  throw new SandboxError(
    "sandbox_misconfigured",
    `devcontainer.json at ${dcJsonPath} has no image, build.dockerfile, or dockerComposeFile`,
  );
}

interface DevcontainerJson {
  image?: unknown;
  build?: unknown;
  dockerComposeFile?: unknown;
  service?: unknown;
  workspaceFolder?: unknown;
  remoteUser?: unknown;
  postCreateCommand?: unknown;
}

function parseDevcontainerJson(raw: string, path: string): DevcontainerJson {
  // devcontainer.json files commonly contain comments. Strip line + block comments before JSON.parse.
  const stripped = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, (_m, p1: string) => p1);
  try {
    const parsed = JSON.parse(stripped) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new SandboxError(
        "sandbox_misconfigured",
        `devcontainer.json at ${path} is not a JSON object`,
      );
    }
    return parsed as DevcontainerJson;
  } catch (err) {
    if (err instanceof SandboxError) throw err;
    throw new SandboxError(
      "sandbox_misconfigured",
      `failed to parse devcontainer.json at ${path}: ${(err as Error).message}`,
      { cause: err },
    );
  }
}
