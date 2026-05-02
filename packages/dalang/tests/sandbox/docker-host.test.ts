import { test, expect, beforeAll, setDefaultTimeout } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { realpath } from "node:fs/promises";
import { DockerContainerHost } from "../../src/sandbox/docker-host";
import type { ResolvedImage } from "../../src/sandbox/types";
import { resolveImage } from "../../src/sandbox/image-source";

// Docker operations (run/exec/stop) can take several seconds each.
setDefaultTimeout(60_000);

let dockerAvailable = false;

beforeAll(async () => {
  try {
    const proc = Bun.spawn(["docker", "version", "--format", "{{.Server.Version}}"]);
    const code = await proc.exited;
    dockerAvailable = code === 0;
  } catch {
    dockerAvailable = false;
  }
});

const alpineImage: ResolvedImage = {
  kind: "image",
  tag: "alpine:3.19",
  workspaceFolder: "/workspace",
  remoteUser: null,
  postCreateCommand: null,
};

test("DockerContainerHost start/exec/stop happy path", async () => {
  if (!dockerAvailable) return;
  const host = new DockerContainerHost();
  const handle = await host.start({
    name: `dalang-test-${Date.now()}`,
    image: alpineImage,
    bindMounts: [],
    env: { GREETING: "hello" },
    resources: { cpus: "1", memory: "256m", pidsLimit: 256, tmpfsSize: "32m" },
  });

  try {
    const result = await handle.exec({ cmd: ["sh", "-lc", 'echo "$GREETING"'] });
    const lines: string[] = [];
    for await (const line of result.stdout) lines.push(line);
    const status = await result.done;
    expect(lines).toEqual(["hello"]);
    expect(status.exitCode).toBe(0);
  } finally {
    await handle.stop();
  }
});

test("DockerContainerHost honors bind mounts and cwd", async () => {
  if (!dockerAvailable) return;
  const dir = await realpath(await mkdtemp(join(tmpdir(), "dh-mount-")));
  await writeFile(join(dir, "marker.txt"), "ok");
  const host = new DockerContainerHost();
  const handle = await host.start({
    name: `dalang-test-${Date.now() + 1}`,
    image: alpineImage,
    bindMounts: [{ hostPath: dir, containerPath: "/workspace", readOnly: false }],
    env: {},
    resources: { cpus: "1", memory: "256m", pidsLimit: 256, tmpfsSize: "32m" },
  });
  try {
    const result = await handle.exec({ cmd: ["cat", "marker.txt"], cwd: "/workspace" });
    const lines: string[] = [];
    for await (const line of result.stdout) lines.push(line);
    const status = await result.done;
    expect(lines).toEqual(["ok"]);
    expect(status.exitCode).toBe(0);
  } finally {
    await handle.stop();
  }
});

test("DockerContainerHost.start throws sandbox_image_unavailable for an unknown tag", async () => {
  if (!dockerAvailable) return;
  const host = new DockerContainerHost();
  await expect(
    host.start({
      name: `dalang-test-${Date.now() + 2}`,
      image: {
        kind: "image",
        tag: "this-image-does-not-exist:dalang-test",
        workspaceFolder: "/workspace",
        remoteUser: null,
        postCreateCommand: null,
      },
      bindMounts: [],
      env: {},
      resources: { cpus: "1", memory: "256m", pidsLimit: 256, tmpfsSize: "32m" },
    }),
  ).rejects.toMatchObject({ code: "sandbox_image_unavailable" });
});

test("DockerContainerHost builds dockerfile-source images on demand", async () => {
  if (!dockerAvailable) return;
  const repoDir = resolve(import.meta.dir, "..", "fixtures", "devcontainer-sample");
  const resolved = await resolveImage({ source: "devcontainer", path: "." }, repoDir);
  if (resolved.kind !== "image") throw new Error("expected image kind");

  const host = new DockerContainerHost();
  const handle = await host.start({
    name: `dalang-test-${Date.now()}`,
    image: resolved,
    bindMounts: [],
    env: {},
    resources: { cpus: "1", memory: "256m", pidsLimit: 256, tmpfsSize: "32m" },
  });
  try {
    const result = await handle.exec({ cmd: ["sh", "-lc", "echo built"] });
    const lines: string[] = [];
    for await (const l of result.stdout) lines.push(l);
    expect(lines).toEqual(["built"]);
    expect((await result.done).exitCode).toBe(0);
  } finally {
    await handle.stop();
  }
});

test("DockerContainerHost starts a compose stack and execs into the named service", async () => {
  if (!dockerAvailable) return;
  const repoDir = resolve(import.meta.dir, "..", "fixtures", "devcontainer-compose-sample");
  const resolved = await resolveImage({ source: "devcontainer", path: "." }, repoDir);
  if (resolved.kind !== "compose") throw new Error("expected compose kind");

  const host = new DockerContainerHost();
  const handle = await host.start({
    name: `dalang-compose-test-${Date.now()}`,
    image: resolved,
    bindMounts: [],
    env: {},
    resources: { cpus: "1", memory: "256m", pidsLimit: 256, tmpfsSize: "32m" },
  });
  try {
    const result = await handle.exec({ cmd: ["sh", "-lc", "echo composed"] });
    const lines: string[] = [];
    for await (const l of result.stdout) lines.push(l);
    expect(lines).toEqual(["composed"]);
  } finally {
    await handle.stop();
  }
});
