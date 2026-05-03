import { test, expect } from "bun:test";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { FakeContainerHost } from "../../src/sandbox/fake-host";
import { FilesystemAuthStore } from "../../src/auth/store";
import { createSandboxedRunQuery } from "../../src/sandbox/sandboxed-runner";
import type {
  ContainerHandle,
  ContainerHost,
  ContainerStartOptions,
  ExecOptions,
  ExecResult,
} from "../../src/sandbox/types";

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

class RecordingExecHost implements ContainerHost {
  startOptions: ContainerStartOptions | null = null;
  execOptions: ExecOptions | null = null;

  async start(opts: ContainerStartOptions): Promise<ContainerHandle> {
    this.startOptions = opts;
    return {
      name: opts.name,
      exec: async (execOpts: ExecOptions): Promise<ExecResult> => {
        this.execOptions = execOpts;
        return {
          stdout: (async function* () {
            yield JSON.stringify({ kind: "finished" });
          })(),
          stderr: (async function* () {})(),
          done: Promise.resolve({ exitCode: 0, signal: null }),
        };
      },
      stop: async () => {},
    };
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
      disabled_states: [],
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

test("sandboxed RunQuery reports a host transcript path under .dalang/sandbox-sessions", async () => {
  const credDir = await realpath(await mkdtemp(join(tmpdir(), "sbr-cred-")));
  const workspaceRoot = await realpath(await mkdtemp(join(tmpdir(), "sbr-ws-")));
  const sandboxesRoot = join(workspaceRoot, ".dalang", "sandboxes");
  const store = new FilesystemAuthStore(credDir);
  await store.setClaudeToken("sk-ant-oat01-xyz");

  const runQuery = createSandboxedRunQuery({
    host: new FakeContainerHost(),
    store,
    sandboxesRoot,
    repoDir: process.cwd(),
    config: {
      enabled: true,
      disabled_states: [],
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
    workerIdFactory: () => "dalang-worker-test-1",
  });

  let transcriptPath: string | undefined;
  const events: unknown[] = [];
  for await (const ev of runQuery({
    prompt: "hi",
    cwd: process.cwd(),
    model: "claude-haiku-4-5-20251001",
    executablePath: "claude",
    claude: { permissionMode: "default" },
    onTranscriptPath: (path) => {
      transcriptPath = path;
    },
  })) {
    events.push(ev);
  }

  expect(events).toEqual([{ probe: "ok" }]);
  expect(transcriptPath).toBe(
    join(workspaceRoot, ".dalang", "sandbox-sessions", "dalang-worker-test-1.jsonl"),
  );
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
      disabled_states: [],
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
      disabled_states: [],
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

test("sandboxed RunQuery clones the repository inside the worker instead of bind-mounting it", async () => {
  const credDir = await realpath(await mkdtemp(join(tmpdir(), "sbr-cred-")));
  const sandboxesRoot = await realpath(await mkdtemp(join(tmpdir(), "sbr-sb-")));
  const workspaceRoot = await realpath(await mkdtemp(join(tmpdir(), "sbr-ws-")));
  const checkout = join(workspaceRoot, "meem-class-review");
  await mkdir(checkout);

  const store = new FilesystemAuthStore(credDir);
  await store.setClaudeToken("sk-ant-oat01-xyz");
  const host = new RecordingExecHost();

  const runQuery = createSandboxedRunQuery({
    host,
    store,
    sandboxesRoot,
    repoDir: process.cwd(),
    repo: {
      url: "https://github.com/example/meem.git",
      defaultBranch: "main",
    },
    config: {
      enabled: true,
      disabled_states: [],
      image: { source: "image", tag: "fake" },
      resources: { cpus: "1", memory: "256m", pidsLimit: 256, tmpfsSize: "32m" },
      providers: {
        claude: { executablePath: "claude" },
        codex: { executablePath: "codex" },
        opencode: { executablePath: "opencode" },
      },
    },
    shimCmdOverride: ["/opt/dalang/bayang"],
  });

  for await (const _ev of runQuery({
    prompt: "hi",
    cwd: checkout,
    model: "claude-haiku-4-5-20251001",
    executablePath: "claude",
    claude: { permissionMode: "default" },
  })) {
    // drain
  }

  expect(host.startOptions?.bindMounts).toEqual([]);
  expect(host.execOptions?.cwd).toBeUndefined();
  expect(host.execOptions?.cmd.slice(0, 2)).toEqual(["sh", "-lc"]);
  const script = host.execOptions?.cmd[2] ?? "";
  expect(script).toContain("git clone");
  expect(script).toContain("https://github.com/example/meem.git");
  expect(script).toContain("/workspace/meem-class-review");
  const invocation = JSON.parse(host.execOptions?.env?.BAYANG_INVOCATION ?? "{}");
  expect(invocation.cwd).toBe("/workspace/meem-class-review");
});

test("sandboxed RunQuery clones into compose image workspaceFolder when no host mount is used", async () => {
  const repoDir = await realpath(await mkdtemp(join(tmpdir(), "sbr-compose-rd-")));
  const configDir = join(repoDir, ".devcontainer");
  const workspaceFolder = "/project";
  const checkout = join(repoDir, "meem-class-review");
  await mkdir(checkout);
  await mkdir(configDir, { recursive: true });
  await writeFile(
    join(configDir, "devcontainer.json"),
    JSON.stringify({
      name: "compose-workspace-root",
      service: "app",
      dockerComposeFile: "compose.yml",
      workspaceFolder,
    }),
  );

  const credDir = await realpath(await mkdtemp(join(tmpdir(), "sbr-cred-")));
  const sandboxesRoot = await realpath(await mkdtemp(join(tmpdir(), "sbr-sb-")));
  const store = new FilesystemAuthStore(credDir);
  await store.setClaudeToken("sk-ant-oat01-xyz");
  const host = new RecordingExecHost();

  const runQuery = createSandboxedRunQuery({
    host,
    store,
    sandboxesRoot,
    repoDir,
    repo: {
      url: "https://github.com/example/meem.git",
      defaultBranch: "main",
    },
    config: {
      enabled: true,
      disabled_states: [],
      image: { source: "devcontainer", path: ".devcontainer" },
      resources: { cpus: "1", memory: "256m", pidsLimit: 256, tmpfsSize: "32m" },
      providers: {
        claude: { executablePath: "claude" },
        codex: { executablePath: "codex" },
        opencode: { executablePath: "opencode" },
      },
    },
    shimCmdOverride: ["/opt/dalang/bayang"],
  });

  for await (const _ev of runQuery({
    prompt: "hi",
    cwd: checkout,
    model: "claude-haiku-4-5-20251001",
    executablePath: "claude",
    claude: { permissionMode: "default" },
  })) {
    // drain
  }

  const script = host.execOptions?.cmd[2] ?? "";
  const expectedCheckout = `${workspaceFolder}/meem-class-review`;
  expect(script).toContain(expectedCheckout);
  const invocation = JSON.parse(host.execOptions?.env?.BAYANG_INVOCATION ?? "{}");
  expect(invocation.cwd).toBe(expectedCheckout);
});

test("sandboxed clone bootstrap passes codex env and enables ssh token-aware auth", async () => {
  const workspaceRoot = await realpath(await mkdtemp(join(tmpdir(), "sbr-sb-codex-env-")));
  const checkout = join(workspaceRoot, "usemeem");
  await mkdir(checkout);

  const credDir = await realpath(await mkdtemp(join(tmpdir(), "sbr-cred-")));
  const sandboxesRoot = await realpath(await mkdtemp(join(tmpdir(), "sbr-sb-")));
  const store = new FilesystemAuthStore(credDir);
  await store.setCodexAuthJson('{"access_token":"test"}');
  const host = new RecordingExecHost();

  const runQuery = createSandboxedRunQuery({
    host,
    store,
    sandboxesRoot,
    repoDir: process.cwd(),
    repo: {
      url: "https://github.com/example/meem.git",
      defaultBranch: "main",
    },
    config: {
      enabled: true,
      disabled_states: [],
      image: { source: "image", tag: "fake" },
      resources: { cpus: "1", memory: "256m", pidsLimit: 256, tmpfsSize: "32m" },
      providers: {
        claude: { executablePath: "claude" },
        codex: {
          executablePath: "codex",
          env: { GH_TOKEN: "provider-token", HOME: "/tmp" },
        },
        opencode: { executablePath: "opencode" },
      },
    },
    shimCmdOverride: ["/opt/dalang/bayang"],
  });

  for await (const _ev of runQuery({
    prompt: "hi",
    cwd: checkout,
    model: "gpt-5.5",
    executablePath: "codex",
    codex: {
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
      networkAccessEnabled: true,
      env: { GH_TOKEN: "runquery-token" },
    },
  })) {
    // drain
  }

  expect(host.startOptions?.env).toMatchObject({
    GH_TOKEN: "provider-token",
    HOME: "/tmp",
    CODEX_HOME: "/run/dalang/codex",
  });
  const script = host.execOptions?.cmd[2] ?? "";
  expect(script).toContain("StrictHostKeyChecking=accept-new");
  expect(script).toContain("git config --global credential.https://github.com.helper");
});

test("sandboxed RunQuery does not mount the host git common dir when repository cloning is configured", async () => {
  const credDir = await realpath(await mkdtemp(join(tmpdir(), "sbr-cred-")));
  const sandboxesRoot = await realpath(await mkdtemp(join(tmpdir(), "sbr-sb-")));
  const workspaceRoot = await realpath(await mkdtemp(join(tmpdir(), "sbr-ws-")));
  const checkout = join(workspaceRoot, "meem-class-review");
  const sharedGitDir = join(workspaceRoot, ".repo.git");
  const worktreeGitDir = join(sharedGitDir, "worktrees", "meem-class-review");
  await mkdir(checkout);
  await mkdir(worktreeGitDir, { recursive: true });
  await writeFile(join(checkout, ".git"), `gitdir: ${worktreeGitDir}\n`);
  await writeFile(join(worktreeGitDir, "commondir"), "../..");

  const store = new FilesystemAuthStore(credDir);
  await store.setCodexAuthJson('{"access_token":"test"}');
  const host = new RecordingExecHost();

  const runQuery = createSandboxedRunQuery({
    host,
    store,
    sandboxesRoot,
    repoDir: process.cwd(),
    repo: {
      url: "https://github.com/example/meem.git",
      defaultBranch: "main",
    },
    config: {
      enabled: true,
      disabled_states: [],
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

  for await (const _ev of runQuery({
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
    // drain
  }

  expect(host.startOptions?.bindMounts).not.toContainEqual(
    expect.objectContaining({
      hostPath: sharedGitDir,
    }),
  );
  expect(host.startOptions?.bindMounts).toContainEqual({
    hostPath: join(sandboxesRoot, host.startOptions!.name, "codex"),
    containerPath: "/run/dalang/codex",
    readOnly: false,
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
      disabled_states: [],
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
