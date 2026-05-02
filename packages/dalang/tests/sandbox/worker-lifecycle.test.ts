import { test, expect } from "bun:test";
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { FakeContainerHost } from "../../src/sandbox/fake-host";
import { FilesystemAuthStore } from "../../src/auth/store";
import { runWorkerSession } from "../../src/sandbox/worker-lifecycle";

const fixtureShim = resolve(import.meta.dir, "..", "fixtures", "worker", "echo-shim.ts");

test("runWorkerSession yields provider events and emits no lifecycle errors on a clean run", async () => {
  const credDir = await realpath(await mkdtemp(join(tmpdir(), "lifecycle-cred-")));
  const sandboxesRoot = await realpath(await mkdtemp(join(tmpdir(), "lifecycle-sb-")));
  const store = new FilesystemAuthStore(credDir);
  await store.setClaudeToken("sk-ant-oat01-xyz");

  const host = new FakeContainerHost();
  const lifecycleEvents: unknown[] = [];

  const events: unknown[] = [];
  for await (const ev of runWorkerSession({
    host,
    store,
    sandboxesRoot,
    workerId: "wf-1",
    image: { kind: "image", tag: "fake", workspaceFolder: "/workspace", remoteUser: null, postCreateCommand: null },
    bindMounts: [],
    resources: { cpus: "1", memory: "256m", pidsLimit: 256, tmpfsSize: "32m" },
    shim: { cmd: [process.execPath, "run", fixtureShim] },
    invocation: { items: [{ a: 1 }, { b: 2 }] },
    provider: "claude",
    onLifecycleEvent: (e) => lifecycleEvents.push(e),
  })) {
    events.push(ev);
  }

  expect(events).toEqual([{ a: 1 }, { b: 2 }]);
  expect(lifecycleEvents).toEqual([]);
});

test("runWorkerSession emits sandbox_misconfigured when claude auth missing", async () => {
  const credDir = await realpath(await mkdtemp(join(tmpdir(), "lifecycle-cred-")));
  const sandboxesRoot = await realpath(await mkdtemp(join(tmpdir(), "lifecycle-sb-")));
  const store = new FilesystemAuthStore(credDir); // no token set

  const host = new FakeContainerHost();
  const lifecycleEvents: { kind: string; message: string }[] = [];

  const fn = async () => {
    for await (const _ of runWorkerSession({
      host,
      store,
      sandboxesRoot,
      workerId: "wf-2",
      image: { kind: "image", tag: "fake", workspaceFolder: "/workspace", remoteUser: null, postCreateCommand: null },
      bindMounts: [],
      resources: { cpus: "1", memory: "256m", pidsLimit: 256, tmpfsSize: "32m" },
      shim: { cmd: [process.execPath, "run", fixtureShim] },
      invocation: { items: [] },
      provider: "claude",
      onLifecycleEvent: (e) => lifecycleEvents.push(e as { kind: string; message: string }),
    })) {
      // drain
    }
  };

  await expect(fn()).rejects.toThrow();
  expect(lifecycleEvents.some((e) => e.kind === "sandbox_misconfigured")).toBe(true);
});
