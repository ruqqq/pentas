import { test, expect } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realpath } from "node:fs/promises";
import { FakeContainerHost } from "../../src/sandbox/fake-host";
import type { ResolvedImage } from "../../src/sandbox/types";

const dummyImage: ResolvedImage = {
  kind: "image",
  tag: "fake",
  workspaceFolder: "/workspace",
  remoteUser: null,
  postCreateCommand: null,
};

test("FakeContainerHost.start.exec runs a host command and streams stdout", async () => {
  const host = new FakeContainerHost();
  const handle = await host.start({
    name: "fake-1",
    image: dummyImage,
    bindMounts: [],
    env: {},
    resources: { cpus: "2", memory: "4g", pidsLimit: 1024, tmpfsSize: "2g" },
  });

  const result = await handle.exec({ cmd: ["echo", "hello"] });
  const lines: string[] = [];
  for await (const line of result.stdout) lines.push(line);
  const status = await result.done;
  await handle.stop();

  expect(lines).toEqual(["hello"]);
  expect(status.exitCode).toBe(0);
});

test("FakeContainerHost.exec uses bindMount mapping for cwd translation", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "fake-host-")));
  await writeFile(join(dir, "marker.txt"), "ok");

  const host = new FakeContainerHost();
  const handle = await host.start({
    name: "fake-2",
    image: dummyImage,
    bindMounts: [{ hostPath: dir, containerPath: "/workspace", readOnly: false }],
    env: {},
    resources: { cpus: "2", memory: "4g", pidsLimit: 1024, tmpfsSize: "2g" },
  });

  const result = await handle.exec({ cmd: ["cat", "marker.txt"], cwd: "/workspace" });
  const lines: string[] = [];
  for await (const line of result.stdout) lines.push(line);
  const status = await result.done;
  await handle.stop();

  expect(lines).toEqual(["ok"]);
  expect(status.exitCode).toBe(0);
});

test("FakeContainerHost.exec respects abortSignal", async () => {
  const host = new FakeContainerHost();
  const handle = await host.start({
    name: "fake-3",
    image: dummyImage,
    bindMounts: [],
    env: {},
    resources: { cpus: "2", memory: "4g", pidsLimit: 1024, tmpfsSize: "2g" },
  });
  const ac = new AbortController();
  const result = await handle.exec({ cmd: ["sleep", "10"], abortSignal: ac.signal });
  setTimeout(() => ac.abort(), 50);
  const status = await result.done;
  await handle.stop();
  expect(status.exitCode === 0).toBe(false);
});
