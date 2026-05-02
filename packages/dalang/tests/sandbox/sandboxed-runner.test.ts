import { test, expect } from "bun:test";
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { FakeContainerHost } from "../../src/sandbox/fake-host";
import { FilesystemAuthStore } from "../../src/auth/store";
import { createSandboxedRunQuery } from "../../src/sandbox/sandboxed-runner";

const fixtureShim = resolve(import.meta.dir, "..", "fixtures", "worker", "echo-shim.ts");
const dumpInvocationShim = resolve(
  import.meta.dir,
  "..",
  "fixtures",
  "worker",
  "dump-invocation-shim.ts",
);

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
    codex: { env: { GITHUB_TOKEN: "token", HOME: "/tmp" } },
  });
});
