import { test, expect } from "bun:test";
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FilesystemAuthStore } from "../../src/auth/store";
import { runSandboxDoctor } from "../../src/sandbox/doctor";
import { FakeContainerHost } from "../../src/sandbox/fake-host";
import type { SandboxConfig } from "../../src/config/sandbox-schema";
import type {
  ContainerHandle,
  ContainerHost,
  ContainerStartOptions,
  ExecOptions,
  ExecResult,
} from "../../src/sandbox/types";

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

class WorkerReadyHost extends FakeContainerHost {
  override async start(opts: ContainerStartOptions): Promise<ContainerHandle> {
    const fake = await super.start(opts);
    return {
      name: fake.name,
      exec: async (execOpts: ExecOptions): Promise<ExecResult> => {
        const script = execOpts.cmd.join(" ");
        if (script.includes("/opt/dalang/dalang-worker")) {
          return {
            stdout: (async function* () {})(),
            stderr: (async function* () {})(),
            done: Promise.resolve({ exitCode: 0, signal: null }),
          };
        }
        return fake.exec(execOpts);
      },
      stop: () => fake.stop(),
    };
  }
}

test("runSandboxDoctor reports ok checks for provider CLI, gh, credentials, and workspace", async () => {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), "doctor-ws-")));
  await Bun.spawn(["git", "init"], { cwd: workspace, stdout: "ignore", stderr: "ignore" }).exited;
  const sandboxesRoot = await realpath(await mkdtemp(join(tmpdir(), "doctor-sb-")));
  const store = await storeWithClaudeAuth();

  const result = await runSandboxDoctor({
    host: new WorkerReadyHost(),
    store,
    sandboxesRoot,
    repoDir: process.cwd(),
    workspaceDir: workspace,
    config: {
      ...config,
      git: { userName: "Dalang Bot", userEmail: "dalang@example.com" },
      providers: config.providers,
    },
    provider: "claude",
    requiredTools: ["sh"],
  });

  expect(result.ok).toBe(true);
  expect(result.checks.map((c) => [c.name, c.ok])).toEqual([
    ["worker shim: /opt/dalang/dalang-worker", true],
    ["provider cli: sh", true],
    ["required cli: sh", true],
    ["provider credentials", true],
    ["workspace writable", true],
    ["git repository usable", true],
    ["git commit identity", true],
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

class RecordingHost implements ContainerHost {
  seenExecEnv: Record<string, string> | undefined;

  async start(opts: ContainerStartOptions): Promise<ContainerHandle> {
    const fake = await new FakeContainerHost().start(opts);
    return {
      name: fake.name,
      exec: async (execOpts: ExecOptions): Promise<ExecResult> => {
        const script = execOpts.cmd.join(" ");
        if (script.includes("gh auth status")) {
          this.seenExecEnv = execOpts.env;
        }
        if (
          script.includes("gh auth status") ||
          script.includes("gh auth setup-git") ||
          script.includes("git ls-remote")
        ) {
          return {
            stdout: (async function* () {})(),
            stderr: (async function* () {})(),
            done: Promise.resolve({ exitCode: 0, signal: null }),
          };
        }
        return fake.exec(execOpts);
      },
      stop: () => fake.stop(),
    };
  }
}

test("runSandboxDoctor verifies gh auth with the resolved github token", async () => {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), "doctor-ws-")));
  const sandboxesRoot = await realpath(await mkdtemp(join(tmpdir(), "doctor-sb-")));
  const store = await storeWithClaudeAuth();
  const host = new RecordingHost();

  const result = await runSandboxDoctor({
    host,
    store,
    sandboxesRoot,
    repoDir: process.cwd(),
    workspaceDir: workspace,
    config,
    provider: "claude",
    requiredTools: ["sh"],
    githubToken: "ghp_test",
  });

  expect(result.checks.map((c) => c.name)).toContain("gh auth status");
  expect(host.seenExecEnv).toMatchObject({
    GH_TOKEN: "ghp_test",
    GITHUB_TOKEN: "ghp_test",
  });
});
