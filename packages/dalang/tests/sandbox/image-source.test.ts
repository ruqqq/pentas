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
