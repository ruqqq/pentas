import { test, expect } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realpath } from "node:fs/promises";
import { resolveImage } from "../../src/sandbox/image-source";

test('source: "image" passes through tag and defaults workspaceFolder', async () => {
  const repoDir = await realpath(await mkdtemp(join(tmpdir(), "repo-img-")));
  const resolved = await resolveImage({ source: "image", tag: "node:20-bullseye" }, repoDir);
  expect(resolved).toEqual({
    kind: "image",
    tag: "node:20-bullseye",
    workspaceFolder: "/workspace",
    remoteUser: null,
    postCreateCommand: null,
  });
});

test('source: "dockerfile" returns kind "image" with synthetic tag pointing to the Dockerfile path', async () => {
  const repoDir = await realpath(await mkdtemp(join(tmpdir(), "repo-df-")));
  await writeFile(join(repoDir, "Dockerfile"), "FROM alpine\n");
  const resolved = await resolveImage({ source: "dockerfile", path: "Dockerfile" }, repoDir);
  expect(resolved.kind).toBe("image");
  if (resolved.kind === "image") {
    // Tag includes a stable hash of the Dockerfile absolute path so the build cache key is reproducible.
    expect(resolved.tag.startsWith("dalang-build:")).toBe(true);
    expect(resolved.workspaceFolder).toBe("/workspace");
  }
});

test('source: "dockerfile" with missing file throws sandbox_misconfigured', async () => {
  const repoDir = await realpath(await mkdtemp(join(tmpdir(), "repo-df-miss-")));
  await expect(
    resolveImage({ source: "dockerfile", path: "missing.Dockerfile" }, repoDir),
  ).rejects.toMatchObject({ code: "sandbox_misconfigured" });
});

import { resolve } from "node:path";

test("devcontainer with build.dockerfile resolves to image kind with workspaceFolder + remoteUser + postCreateCommand", async () => {
  const repoDir = resolve(import.meta.dir, "..", "fixtures", "devcontainer-sample");
  const resolved = await resolveImage({ source: "devcontainer", path: "." }, repoDir);
  expect(resolved.kind).toBe("image");
  if (resolved.kind === "image") {
    expect(resolved.tag.startsWith("dalang-build:")).toBe(true);
    expect(resolved.workspaceFolder).toBe("/workspace");
    expect(resolved.remoteUser).toBe("root");
    expect(resolved.postCreateCommand).toBe("echo ready");
  }
});

test("devcontainer with dockerComposeFile resolves to compose kind", async () => {
  const repoDir = resolve(import.meta.dir, "..", "fixtures", "devcontainer-compose-sample");
  const resolved = await resolveImage({ source: "devcontainer", path: "." }, repoDir);
  expect(resolved.kind).toBe("compose");
  if (resolved.kind === "compose") {
    expect(resolved.composeFile.endsWith("docker-compose.yml")).toBe(true);
    expect(resolved.service).toBe("app");
    expect(resolved.workspaceFolder).toBe("/workspace");
    expect(resolved.postCreateCommand).toBe("echo ready");
  }
});

test("devcontainer with neither build nor image nor compose throws sandbox_misconfigured", async () => {
  const repoDir = resolve(import.meta.dir, "..", "fixtures");
  // Reuse the parent dir; there's no devcontainer.json there.
  await expect(
    resolveImage({ source: "devcontainer", path: "." }, repoDir),
  ).rejects.toMatchObject({ code: "sandbox_misconfigured" });
});
