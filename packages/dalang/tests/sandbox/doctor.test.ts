import { test, expect } from "bun:test";
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FilesystemAuthStore } from "../../src/auth/store";
import { runSandboxDoctor } from "../../src/sandbox/doctor";
import { FakeContainerHost } from "../../src/sandbox/fake-host";
import type { SandboxConfig } from "../../src/config/sandbox-schema";

const config: SandboxConfig = {
  enabled: true,
  image: { source: "image", tag: "fake" },
  resources: { cpus: "1", memory: "256m", pidsLimit: 256, tmpfsSize: "32m" },
  providers: {
    claude: { executablePath: "sh" },
    codex: { executablePath: "codex" },
    opencode: { executablePath: "opencode" },
  },
};

async function storeWithClaudeAuth(): Promise<FilesystemAuthStore> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "doctor-auth-")));
  const store = new FilesystemAuthStore(root);
  await store.setClaudeToken("sk-ant-oat01-test");
  return store;
}

test("runSandboxDoctor reports ok checks for provider CLI, gh, credentials, and workspace", async () => {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), "doctor-ws-")));
  const sandboxesRoot = await realpath(await mkdtemp(join(tmpdir(), "doctor-sb-")));
  const store = await storeWithClaudeAuth();

  const result = await runSandboxDoctor({
    host: new FakeContainerHost(),
    store,
    sandboxesRoot,
    repoDir: process.cwd(),
    workspaceDir: workspace,
    config: {
      ...config,
      providers: config.providers,
    },
    provider: "claude",
    requiredTools: ["sh"],
  });

  expect(result.ok).toBe(true);
  expect(result.checks.map((c) => [c.name, c.ok])).toEqual([
    ["provider cli: sh", true],
    ["required cli: sh", true],
    ["provider credentials", true],
    ["workspace writable", true],
  ]);
});

test("runSandboxDoctor reports a missing required CLI as a failed check", async () => {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), "doctor-ws-")));
  const sandboxesRoot = await realpath(await mkdtemp(join(tmpdir(), "doctor-sb-")));
  const store = await storeWithClaudeAuth();

  const result = await runSandboxDoctor({
    host: new FakeContainerHost(),
    store,
    sandboxesRoot,
    repoDir: process.cwd(),
    workspaceDir: workspace,
    config,
    provider: "claude",
    requiredTools: ["definitely-not-a-dalang-tool"],
  });

  expect(result.ok).toBe(false);
  expect(result.checks).toContainEqual(
    expect.objectContaining({
      name: "required cli: definitely-not-a-dalang-tool",
      ok: false,
    }),
  );
});
