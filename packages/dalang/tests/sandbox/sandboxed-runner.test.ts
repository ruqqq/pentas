import { test, expect } from "bun:test";
import { mkdir, mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { FakeContainerHost } from "../../src/sandbox/fake-host";
import { FilesystemAuthStore } from "../../src/auth/store";
import { createSandboxedRunQuery } from "../../src/sandbox/sandboxed-runner";
import type { ContainerHost, ContainerStartOptions } from "../../src/sandbox/types";

const fixtureShim = resolve(import.meta.dir, "..", "fixtures", "worker", "echo-shim.ts");
const dumpInvocationShim = resolve(
  import.meta.dir,
  "..",
  "fixtures",
  "worker",
  "dump-invocation-shim.ts",
);

class RecordingHost extends FakeContainerHost implements ContainerHost {
  startOptions: ContainerStartOptions | null = null;
  override async start(opts: ContainerStartOptions) {
    this.startOptions = opts;
    return super.start(opts);
  }
}

test("sandboxed RunQuery for claude provider drains echo-shim through full lifecycle", async () => {
  const credDir = await realpath(await mkdtemp(join(tmpdir(), "sbr-cred-")));
  const sandboxesRoot = await realpath(await mkdtemp(join(tmpdir(), "sbr-sb-")));
  const store = new FilesystemAuthStore(credDir);
  await store.setClaudeToken("sk-ant-oat01-xyz");

  const runQuery = createSandboxedRunQuery({
    host: new FakeContainerHost(),
    store,
    sandboxesRoot,
    repoDir: process.cwd(),
    config: {
      enabled: true,
      image: { source: "image", tag: "fake" },
      resources: { cpus: "1", memory: "256m", pidsLimit: 256, tmpfsSize: "32m" },
      providers: {
        claude: { executablePath: "claude" },
        codex: { executablePath: "codex" },
        opencode: { executablePath: "opencode" },
      },
    },
    shimCmdOverride: [process.execPath, "run", fixtureShim],
    invocationOverride: { items: [{ probe: "ok" }] },
  });

  const events: unknown[] = [];
  for await (const ev of runQuery({
    prompt: "hi",
    cwd: process.cwd(),
    model: "claude-haiku-4-5-20251001",
    executablePath: "claude",
    claude: { permissionMode: "default" },
  })) {
    events.push(ev);
  }
  expect(events).toEqual([{ probe: "ok" }]);
});

test("sandboxed RunQuery includes sandbox Codex env in the worker invocation", async () => {
  const credDir = await realpath(await mkdtemp(join(tmpdir(), "sbr-cred-")));
  const sandboxesRoot = await realpath(await mkdtemp(join(tmpdir(), "sbr-sb-")));
  const store = new FilesystemAuthStore(credDir);
  await store.setCodexAuthJson('{"access_token":"test"}');

  const runQuery = createSandboxedRunQuery({
    host: new FakeContainerHost(),
    store,
    sandboxesRoot,
    repoDir: process.cwd(),
    config: {
      enabled: true,
      image: { source: "image", tag: "fake" },
      resources: { cpus: "1", memory: "256m", pidsLimit: 256, tmpfsSize: "32m" },
      git: { userName: "Dalang Bot", userEmail: "dalang@example.com" },
      providers: {
        claude: { executablePath: "claude" },
        codex: { executablePath: "codex", env: { HOME: "/tmp" } },
        opencode: { executablePath: "opencode" },
      },
    },
    shimCmdOverride: [process.execPath, "run", dumpInvocationShim],
  });

  const events: unknown[] = [];
  for await (const ev of runQuery({
    prompt: "hi",
    cwd: process.cwd(),
    model: "gpt-5.5",
    executablePath: "codex",
    codex: {
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
      networkAccessEnabled: true,
      env: { HOME: "/home/host", GITHUB_TOKEN: "token" },
    },
  })) {
    events.push(ev);
  }

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    provider: "codex",
    codex: {
      env: { GITHUB_TOKEN: "token", HOME: "/tmp" },
      git: { userName: "Dalang Bot", userEmail: "dalang@example.com" },
    },
  });
});

test("sandboxed RunQuery starts worker inside checkout directory under mounted workspace root", async () => {
  const credDir = await realpath(await mkdtemp(join(tmpdir(), "sbr-cred-")));
  const sandboxesRoot = await realpath(await mkdtemp(join(tmpdir(), "sbr-sb-")));
  const workspaceRoot = await realpath(await mkdtemp(join(tmpdir(), "sbr-ws-")));
  const checkout = join(workspaceRoot, "meem-class-review");
  await mkdir(checkout);

  const store = new FilesystemAuthStore(credDir);
  await store.setCodexAuthJson('{"access_token":"test"}');
  const host = new RecordingHost();

  const runQuery = createSandboxedRunQuery({
    host,
    store,
    sandboxesRoot,
    repoDir: process.cwd(),
    config: {
      enabled: true,
      image: { source: "image", tag: "fake" },
      resources: { cpus: "1", memory: "256m", pidsLimit: 256, tmpfsSize: "32m" },
      providers: {
        claude: { executablePath: "claude" },
        codex: { executablePath: "codex" },
        opencode: { executablePath: "opencode" },
      },
    },
    shimCmdOverride: [process.execPath, "run", dumpInvocationShim],
  });

  const events: unknown[] = [];
  for await (const ev of runQuery({
    prompt: "hi",
    cwd: checkout,
    model: "gpt-5.5",
    executablePath: "codex",
    codex: {
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
      networkAccessEnabled: true,
    },
  })) {
    events.push(ev);
  }

  expect(host.startOptions?.bindMounts[0]).toMatchObject({
    hostPath: workspaceRoot,
    containerPath: "/workspace",
    readOnly: false,
  });
  expect(events[0]).toMatchObject({
    provider: "codex",
    cwd: "/workspace/meem-class-review",
  });
});

test("sandboxed RunQuery does not forward resumeSessionId into disposable workers", async () => {
  const credDir = await realpath(await mkdtemp(join(tmpdir(), "sbr-cred-")));
  const sandboxesRoot = await realpath(await mkdtemp(join(tmpdir(), "sbr-sb-")));
  const store = new FilesystemAuthStore(credDir);
  await store.setCodexAuthJson('{"access_token":"test"}');

  const runQuery = createSandboxedRunQuery({
    host: new FakeContainerHost(),
    store,
    sandboxesRoot,
    repoDir: process.cwd(),
    config: {
      enabled: true,
      image: { source: "image", tag: "fake" },
      resources: { cpus: "1", memory: "256m", pidsLimit: 256, tmpfsSize: "32m" },
      providers: {
        claude: { executablePath: "claude" },
        codex: { executablePath: "codex" },
        opencode: { executablePath: "opencode" },
      },
    },
    shimCmdOverride: [process.execPath, "run", dumpInvocationShim],
  });

  const events: unknown[] = [];
  for await (const ev of runQuery({
    prompt: "hi",
    cwd: process.cwd(),
    model: "gpt-5.5",
    executablePath: "codex",
    resumeSessionId: "thread-from-previous-worker",
    codex: {
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
      networkAccessEnabled: true,
    },
  })) {
    events.push(ev);
  }

  expect(events).toHaveLength(1);
  expect(events[0]).not.toHaveProperty("resumeSessionId");
});
