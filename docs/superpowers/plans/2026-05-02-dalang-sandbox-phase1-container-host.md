# Sandboxed Workers Phase 1 — ContainerHost & Image Source

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a `ContainerHost` abstraction (with a real Docker implementation and an in-process fake) plus image-source resolution (`devcontainer.json` / Dockerfile / pre-pulled image), so that later phases can run workers in containers. No agent-runner / runner integration in this phase — Phase 1 is foundation only.

**Architecture:** A new `packages/dalang/src/sandbox/` module exposes a `ContainerHost` interface with `start`, `exec`, `stop` operations. `DockerContainerHost` shells out to the `docker` CLI (no Docker SDK) so the dependency is just the binary, and parses output. `FakeContainerHost` runs commands as host subprocesses for unit-testing higher layers. `image-source.ts` reads the user-declared sandbox image config and resolves it to a concrete image reference (build the Dockerfile, parse devcontainer.json, or use a pre-pulled tag). Resource limits (`cpus`, `memory`, `pids-limit`, tmpfs) are first-class fields on `ContainerStartOptions`.

**Tech Stack:** Bun, TypeScript (strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes + verbatimModuleSyntax), zod, `bun test`, Docker CLI on the host. Spec: `docs/superpowers/specs/2026-05-02-dalang-sandboxed-workers-design.md` §1, §2, §3 (compose lifecycle is touched only at the interface level — full compose orchestration lands in Phase 4), §10.

---

## File Structure

**Create:**

- `packages/dalang/src/sandbox/types.ts` — public types (`ContainerHost`, `ContainerHandle`, `ContainerStartOptions`, `ExecOptions`, `ResolvedImage`, `SandboxImageConfig`, error classes)
- `packages/dalang/src/sandbox/docker-host.ts` — `DockerContainerHost` implementation
- `packages/dalang/src/sandbox/fake-host.ts` — `FakeContainerHost` for unit tests
- `packages/dalang/src/sandbox/image-source.ts` — resolves `SandboxImageConfig` to `ResolvedImage`
- `packages/dalang/src/sandbox/index.ts` — re-exports
- `packages/dalang/tests/sandbox/types.test.ts`
- `packages/dalang/tests/sandbox/fake-host.test.ts`
- `packages/dalang/tests/sandbox/image-source.test.ts`
- `packages/dalang/tests/sandbox/docker-host.test.ts` (gated behind `DOCKER_AVAILABLE`)
- `packages/dalang/tests/fixtures/devcontainer-sample/devcontainer.json`
- `packages/dalang/tests/fixtures/devcontainer-sample/Dockerfile`
- `packages/dalang/tests/fixtures/devcontainer-compose-sample/devcontainer.json`
- `packages/dalang/tests/fixtures/devcontainer-compose-sample/docker-compose.yml`

**Modify:**

- `packages/dalang/package.json` — add `typecheck` script if missing (it's already there); no new runtime deps

---

## Task 1: Add `SandboxImageConfig` schema and `ResolvedImage` types

**Files:**

- Create: `packages/dalang/src/sandbox/types.ts`
- Test: `packages/dalang/tests/sandbox/types.test.ts`

- [ ] **Step 1: Write the failing test for the schema**

Create `packages/dalang/tests/sandbox/types.test.ts`:

```ts
import { test, expect } from "bun:test";
import { SandboxImageConfigSchema, type ResolvedImage } from "../../src/sandbox/types";

test("SandboxImageConfigSchema accepts devcontainer source with default path", () => {
  const parsed = SandboxImageConfigSchema.parse({ source: "devcontainer" });
  expect(parsed).toEqual({ source: "devcontainer", path: ".devcontainer" });
});

test("SandboxImageConfigSchema accepts dockerfile source with explicit path", () => {
  const parsed = SandboxImageConfigSchema.parse({
    source: "dockerfile",
    path: "build/Dockerfile",
  });
  expect(parsed).toEqual({ source: "dockerfile", path: "build/Dockerfile" });
});

test("SandboxImageConfigSchema accepts image source with tag", () => {
  const parsed = SandboxImageConfigSchema.parse({
    source: "image",
    tag: "node:20-bullseye",
  });
  expect(parsed).toEqual({ source: "image", tag: "node:20-bullseye" });
});

test("SandboxImageConfigSchema rejects image source without tag", () => {
  const result = SandboxImageConfigSchema.safeParse({ source: "image" });
  expect(result.success).toBe(false);
});

test("ResolvedImage type allows compose mode with project file path", () => {
  const r: ResolvedImage = {
    kind: "compose",
    composeFile: "/abs/.devcontainer/docker-compose.yml",
    service: "app",
    workspaceFolder: "/workspace",
    remoteUser: "ubuntu",
    postCreateCommand: "bun install",
  };
  expect(r.kind).toBe("compose");
});
```

- [ ] **Step 2: Run test — expect failure**

Run: `cd packages/dalang && bun test tests/sandbox/types.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `packages/dalang/src/sandbox/types.ts`**

```ts
import { z } from "zod";

export const SandboxImageConfigSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("devcontainer"),
    path: z.string().min(1).default(".devcontainer"),
  }),
  z.object({
    source: z.literal("dockerfile"),
    path: z.string().min(1),
  }),
  z.object({
    source: z.literal("image"),
    tag: z.string().min(1),
  }),
]);

export type SandboxImageConfig = z.infer<typeof SandboxImageConfigSchema>;

export const SandboxResourcesSchema = z
  .object({
    cpus: z.string().min(1).default("2"),
    memory: z.string().min(1).default("4g"),
    pidsLimit: z.number().int().positive().default(1024),
    tmpfsSize: z.string().min(1).default("2g"),
  })
  .default({});

export type SandboxResources = z.infer<typeof SandboxResourcesSchema>;

export type ResolvedImage =
  | {
      kind: "image";
      tag: string;
      workspaceFolder: string;
      remoteUser: string | null;
      postCreateCommand: string | null;
    }
  | {
      kind: "compose";
      composeFile: string;
      service: string;
      workspaceFolder: string;
      remoteUser: string | null;
      postCreateCommand: string | null;
    };

export interface BindMount {
  hostPath: string;
  containerPath: string;
  readOnly: boolean;
}

export interface ContainerStartOptions {
  /** Stable identifier dalang picks (e.g. `dalang-<workerId>`); used as the container name and compose project. */
  name: string;
  image: ResolvedImage;
  bindMounts: BindMount[];
  env: Record<string, string>;
  resources: SandboxResources;
  /** Run as this user inside the container, falling back to the image's `remoteUser`. */
  user?: string;
}

export interface ExecOptions {
  cmd: string[];
  /** Working directory inside the container. */
  cwd?: string;
  env?: Record<string, string>;
  abortSignal?: AbortSignal;
}

export interface ExecResult {
  /** Async iterable of stdout lines (no trailing newline). */
  stdout: AsyncIterable<string>;
  /** Async iterable of stderr lines. */
  stderr: AsyncIterable<string>;
  /** Resolves with the process exit code once both streams have ended. */
  done: Promise<{ exitCode: number; signal: NodeJS.Signals | null }>;
}

export interface ContainerHandle {
  /** Stable name supplied at start time. */
  readonly name: string;
  /** Run a command inside the started container. Multiple calls allowed. */
  exec(opts: ExecOptions): Promise<ExecResult>;
  /** Stop and remove the container (and any compose-side services). Idempotent. */
  stop(): Promise<void>;
}

export interface ContainerHost {
  start(opts: ContainerStartOptions): Promise<ContainerHandle>;
}

export class SandboxError extends Error {
  constructor(
    public readonly code:
      | "sandbox_unavailable"
      | "sandbox_image_unavailable"
      | "sandbox_start_failed"
      | "sandbox_exec_disconnected"
      | "sandbox_oom"
      | "sandbox_misconfigured",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SandboxError";
  }
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `cd packages/dalang && bun test tests/sandbox/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/dalang/src/sandbox/types.ts packages/dalang/tests/sandbox/types.test.ts
git commit -m "feat(dalang): sandbox types and image config schema"
```

---

## Task 2: `FakeContainerHost` for unit tests

**Files:**

- Create: `packages/dalang/src/sandbox/fake-host.ts`
- Test: `packages/dalang/tests/sandbox/fake-host.test.ts`

The fake runs `cmd` as a host subprocess via `Bun.spawn`. Bind mounts and env are honored by translating mounts into the host process's `cwd` (we use the first `--workdir`-equivalent path for `exec.cwd`). It does not enforce resource limits; tests treat them as descriptive.

- [ ] **Step 1: Write failing test**

Create `packages/dalang/tests/sandbox/fake-host.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test — expect failure**

Run: `cd packages/dalang && bun test tests/sandbox/fake-host.test.ts`
Expected: FAIL — `FakeContainerHost` not found.

- [ ] **Step 3: Implement `packages/dalang/src/sandbox/fake-host.ts`**

```ts
import type {
  BindMount,
  ContainerHandle,
  ContainerHost,
  ContainerStartOptions,
  ExecOptions,
  ExecResult,
} from "./types";

class LineStream implements AsyncIterable<string> {
  constructor(private readonly source: ReadableStream<Uint8Array>) {}
  async *[Symbol.asyncIterator](): AsyncIterator<string> {
    const decoder = new TextDecoder();
    let buf = "";
    const reader = this.source.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          yield buf.slice(0, nl);
          buf = buf.slice(nl + 1);
        }
      }
      if (buf.length > 0) yield buf;
    } finally {
      reader.releaseLock();
    }
  }
}

function translateCwd(cwd: string | undefined, mounts: readonly BindMount[]): string | undefined {
  if (!cwd) return undefined;
  for (const m of mounts) {
    if (cwd === m.containerPath) return m.hostPath;
    if (cwd.startsWith(`${m.containerPath}/`)) {
      return `${m.hostPath}/${cwd.slice(m.containerPath.length + 1)}`;
    }
  }
  return cwd;
}

class FakeHandle implements ContainerHandle {
  constructor(
    public readonly name: string,
    private readonly mounts: readonly BindMount[],
    private readonly env: Readonly<Record<string, string>>,
  ) {}

  async exec(opts: ExecOptions): Promise<ExecResult> {
    const cwd = translateCwd(opts.cwd, this.mounts);
    const proc = Bun.spawn(opts.cmd, {
      cwd,
      env: { ...this.env, ...(opts.env ?? {}) },
      stdout: "pipe",
      stderr: "pipe",
    });
    if (opts.abortSignal) {
      if (opts.abortSignal.aborted) proc.kill();
      else opts.abortSignal.addEventListener("abort", () => proc.kill(), { once: true });
    }
    const done = (async () => {
      const exitCode = await proc.exited;
      return { exitCode, signal: null as NodeJS.Signals | null };
    })();
    return {
      stdout: new LineStream(proc.stdout),
      stderr: new LineStream(proc.stderr),
      done,
    };
  }

  async stop(): Promise<void> {
    // No-op for the fake.
  }
}

export class FakeContainerHost implements ContainerHost {
  async start(opts: ContainerStartOptions): Promise<ContainerHandle> {
    return new FakeHandle(opts.name, opts.bindMounts, opts.env);
  }
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `cd packages/dalang && bun test tests/sandbox/fake-host.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/dalang/src/sandbox/fake-host.ts packages/dalang/tests/sandbox/fake-host.test.ts
git commit -m "feat(dalang): FakeContainerHost for sandbox unit tests"
```

---

## Task 3: Image-source resolution — `image` and `dockerfile`

**Files:**

- Create: `packages/dalang/src/sandbox/image-source.ts`
- Test: `packages/dalang/tests/sandbox/image-source.test.ts`

For this task, only the simple `image` and `dockerfile` modes. Devcontainer parsing comes in Task 4.

- [ ] **Step 1: Failing test**

Create `packages/dalang/tests/sandbox/image-source.test.ts`:

```ts
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
```

- [ ] **Step 2: Run — expect failure**

Run: `cd packages/dalang && bun test tests/sandbox/image-source.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `packages/dalang/src/sandbox/image-source.ts`**

```ts
import { access } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { SandboxError, type ResolvedImage, type SandboxImageConfig } from "./types";

const DEFAULT_WORKSPACE_FOLDER = "/workspace";

function shortHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 12);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function resolveImage(
  config: SandboxImageConfig,
  repoDir: string,
): Promise<ResolvedImage> {
  if (!isAbsolute(repoDir)) {
    throw new SandboxError(
      "sandbox_misconfigured",
      `resolveImage requires absolute repoDir, got "${repoDir}"`,
    );
  }

  if (config.source === "image") {
    return {
      kind: "image",
      tag: config.tag,
      workspaceFolder: DEFAULT_WORKSPACE_FOLDER,
      remoteUser: null,
      postCreateCommand: null,
    };
  }

  if (config.source === "dockerfile") {
    const abs = resolve(repoDir, config.path);
    if (!(await fileExists(abs))) {
      throw new SandboxError(
        "sandbox_misconfigured",
        `Dockerfile not found at ${abs}`,
      );
    }
    return {
      kind: "image",
      tag: `dalang-build:${shortHash(abs)}`,
      workspaceFolder: DEFAULT_WORKSPACE_FOLDER,
      remoteUser: null,
      postCreateCommand: null,
    };
  }

  // devcontainer — implemented in Task 4.
  throw new SandboxError(
    "sandbox_misconfigured",
    `devcontainer source not yet supported`,
  );
}
```

- [ ] **Step 4: Run — expect pass**

Run: `cd packages/dalang && bun test tests/sandbox/image-source.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/dalang/src/sandbox/image-source.ts packages/dalang/tests/sandbox/image-source.test.ts
git commit -m "feat(dalang): resolve sandbox images for 'image' and 'dockerfile' sources"
```

---

## Task 4: Image-source resolution — `devcontainer`

Read `.devcontainer/devcontainer.json` (or the configured path), pick image vs dockerfile vs compose, honor `workspaceFolder`, `remoteUser`, `postCreateCommand`.

**Files:**

- Modify: `packages/dalang/src/sandbox/image-source.ts`
- Modify: `packages/dalang/tests/sandbox/image-source.test.ts`
- Create: `packages/dalang/tests/fixtures/devcontainer-sample/devcontainer.json`
- Create: `packages/dalang/tests/fixtures/devcontainer-sample/Dockerfile`
- Create: `packages/dalang/tests/fixtures/devcontainer-compose-sample/devcontainer.json`
- Create: `packages/dalang/tests/fixtures/devcontainer-compose-sample/docker-compose.yml`

- [ ] **Step 1: Create fixtures**

Create `packages/dalang/tests/fixtures/devcontainer-sample/Dockerfile`:

```dockerfile
FROM alpine:3.19
WORKDIR /workspace
```

Create `packages/dalang/tests/fixtures/devcontainer-sample/devcontainer.json`:

```json
{
  "name": "sample",
  "build": { "dockerfile": "Dockerfile" },
  "workspaceFolder": "/workspace",
  "remoteUser": "root",
  "postCreateCommand": "echo ready"
}
```

Create `packages/dalang/tests/fixtures/devcontainer-compose-sample/docker-compose.yml`:

```yaml
services:
  app:
    image: alpine:3.19
    command: ["sleep", "infinity"]
```

Create `packages/dalang/tests/fixtures/devcontainer-compose-sample/devcontainer.json`:

```json
{
  "name": "compose-sample",
  "dockerComposeFile": "docker-compose.yml",
  "service": "app",
  "workspaceFolder": "/workspace",
  "postCreateCommand": "echo ready"
}
```

- [ ] **Step 2: Append failing tests**

Append to `packages/dalang/tests/sandbox/image-source.test.ts`:

```ts
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
```

- [ ] **Step 3: Run — expect failure**

Run: `cd packages/dalang && bun test tests/sandbox/image-source.test.ts`
Expected: 3 new tests fail.

- [ ] **Step 4: Extend `image-source.ts`**

Replace the trailing `throw new SandboxError("sandbox_misconfigured", "devcontainer source not yet supported")` with:

```ts
  // devcontainer
  const dcDir = resolve(repoDir, config.path);
  const dcJsonPath = join(dcDir, "devcontainer.json");
  if (!(await fileExists(dcJsonPath))) {
    throw new SandboxError(
      "sandbox_misconfigured",
      `devcontainer.json not found at ${dcJsonPath}`,
    );
  }

  const raw = await Bun.file(dcJsonPath).text();
  const json = parseDevcontainerJson(raw, dcJsonPath);

  const workspaceFolder =
    typeof json.workspaceFolder === "string" ? json.workspaceFolder : DEFAULT_WORKSPACE_FOLDER;
  const remoteUser = typeof json.remoteUser === "string" ? json.remoteUser : null;
  const postCreateCommand =
    typeof json.postCreateCommand === "string" ? json.postCreateCommand : null;

  if (typeof json.dockerComposeFile === "string") {
    if (typeof json.service !== "string" || json.service.length === 0) {
      throw new SandboxError(
        "sandbox_misconfigured",
        `devcontainer.json at ${dcJsonPath} declares dockerComposeFile but no service`,
      );
    }
    return {
      kind: "compose",
      composeFile: resolve(dcDir, json.dockerComposeFile),
      service: json.service,
      workspaceFolder,
      remoteUser,
      postCreateCommand,
    };
  }

  if (
    json.build !== undefined &&
    typeof json.build === "object" &&
    json.build !== null &&
    typeof (json.build as { dockerfile?: unknown }).dockerfile === "string"
  ) {
    const dfRel = (json.build as { dockerfile: string }).dockerfile;
    const dfAbs = resolve(dcDir, dfRel);
    if (!(await fileExists(dfAbs))) {
      throw new SandboxError(
        "sandbox_misconfigured",
        `devcontainer build.dockerfile not found at ${dfAbs}`,
      );
    }
    return {
      kind: "image",
      tag: `dalang-build:${shortHash(dfAbs)}`,
      workspaceFolder,
      remoteUser,
      postCreateCommand,
    };
  }

  if (typeof json.image === "string") {
    return {
      kind: "image",
      tag: json.image,
      workspaceFolder,
      remoteUser,
      postCreateCommand,
    };
  }

  throw new SandboxError(
    "sandbox_misconfigured",
    `devcontainer.json at ${dcJsonPath} has no image, build.dockerfile, or dockerComposeFile`,
  );
}

interface DevcontainerJson {
  image?: unknown;
  build?: unknown;
  dockerComposeFile?: unknown;
  service?: unknown;
  workspaceFolder?: unknown;
  remoteUser?: unknown;
  postCreateCommand?: unknown;
}

function parseDevcontainerJson(raw: string, path: string): DevcontainerJson {
  // devcontainer.json files commonly contain comments. Strip line + block comments before JSON.parse.
  const stripped = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, (_m, p1: string) => p1);
  try {
    const parsed = JSON.parse(stripped) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new SandboxError(
        "sandbox_misconfigured",
        `devcontainer.json at ${path} is not a JSON object`,
      );
    }
    return parsed as DevcontainerJson;
  } catch (err) {
    if (err instanceof SandboxError) throw err;
    throw new SandboxError(
      "sandbox_misconfigured",
      `failed to parse devcontainer.json at ${path}: ${(err as Error).message}`,
      { cause: err },
    );
  }
}
```

- [ ] **Step 5: Run — expect pass**

Run: `cd packages/dalang && bun test tests/sandbox/image-source.test.ts`
Expected: all PASS.

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/dalang/src/sandbox/image-source.ts packages/dalang/tests/sandbox/image-source.test.ts packages/dalang/tests/fixtures/devcontainer-sample packages/dalang/tests/fixtures/devcontainer-compose-sample
git commit -m "feat(dalang): resolve devcontainer.json (build, image, compose) sandbox sources"
```

---

## Task 5: `DockerContainerHost` skeleton (no-compose path)

Implements `start` for `kind: "image"` — `docker run -d`, `docker exec`, `docker stop && docker rm`. Compose path is added in Task 6. All Docker invocations go through `Bun.spawn(["docker", ...])`. We do not pull in a Docker SDK; the `docker` binary is the dependency.

**Files:**

- Create: `packages/dalang/src/sandbox/docker-host.ts`
- Create: `packages/dalang/tests/sandbox/docker-host.test.ts`

- [ ] **Step 1: Failing test (gated behind `DOCKER_AVAILABLE`)**

Create `packages/dalang/tests/sandbox/docker-host.test.ts`:

```ts
import { test, expect, beforeAll } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realpath } from "node:fs/promises";
import { DockerContainerHost } from "../../src/sandbox/docker-host";
import type { ResolvedImage } from "../../src/sandbox/types";

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
```

- [ ] **Step 2: Run — expect failure (or skip if Docker unavailable)**

Run: `cd packages/dalang && bun test tests/sandbox/docker-host.test.ts`
Expected: FAIL — module missing. If Docker is unavailable on the dev machine, the body short-circuits and tests pass empty (acceptable; the integration behavior is verified in CI where Docker is present).

- [ ] **Step 3: Implement `packages/dalang/src/sandbox/docker-host.ts`**

```ts
import {
  SandboxError,
  type BindMount,
  type ContainerHandle,
  type ContainerHost,
  type ContainerStartOptions,
  type ExecOptions,
  type ExecResult,
  type ResolvedImage,
} from "./types";

class LineStream implements AsyncIterable<string> {
  constructor(private readonly source: ReadableStream<Uint8Array>) {}
  async *[Symbol.asyncIterator](): AsyncIterator<string> {
    const decoder = new TextDecoder();
    let buf = "";
    const reader = this.source.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          yield buf.slice(0, nl);
          buf = buf.slice(nl + 1);
        }
      }
      if (buf.length > 0) yield buf;
    } finally {
      reader.releaseLock();
    }
  }
}

async function readToEnd(stream: ReadableStream<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let out = "";
  const reader = stream.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

function bindMountFlag(m: BindMount): string {
  const ro = m.readOnly ? ":ro" : "";
  return `--mount=type=bind,source=${m.hostPath},target=${m.containerPath}${ro ? `,readonly` : ""}`;
}

class DockerHandle implements ContainerHandle {
  constructor(public readonly name: string) {}

  async exec(opts: ExecOptions): Promise<ExecResult> {
    const args = ["exec", "-i"];
    if (opts.cwd) args.push("--workdir", opts.cwd);
    for (const [k, v] of Object.entries(opts.env ?? {})) {
      args.push("--env", `${k}=${v}`);
    }
    args.push(this.name, ...opts.cmd);

    const proc = Bun.spawn(["docker", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
    if (opts.abortSignal) {
      const onAbort = () => {
        Bun.spawn(["docker", "kill", "--signal", "TERM", this.name]).exited.catch(() => {});
      };
      if (opts.abortSignal.aborted) onAbort();
      else opts.abortSignal.addEventListener("abort", onAbort, { once: true });
    }
    const done = (async () => {
      const exitCode = await proc.exited;
      if (exitCode === 137) {
        throw new SandboxError("sandbox_oom", `container ${this.name} exec OOM-killed`);
      }
      return { exitCode, signal: null as NodeJS.Signals | null };
    })();
    return {
      stdout: new LineStream(proc.stdout),
      stderr: new LineStream(proc.stderr),
      done,
    };
  }

  async stop(): Promise<void> {
    // Best-effort stop + rm. Ignore "no such container" failures (idempotent).
    const stop = Bun.spawn(["docker", "stop", "--time", "5", this.name], {
      stdout: "ignore",
      stderr: "ignore",
    });
    await stop.exited;
    const rm = Bun.spawn(["docker", "rm", "--force", this.name], {
      stdout: "ignore",
      stderr: "ignore",
    });
    await rm.exited;
  }
}

function imageRunArgs(image: ResolvedImage): { tag: string } {
  if (image.kind !== "image") {
    throw new SandboxError(
      "sandbox_misconfigured",
      `DockerContainerHost.start cannot run a compose image directly`,
    );
  }
  return { tag: image.tag };
}

export class DockerContainerHost implements ContainerHost {
  async start(opts: ContainerStartOptions): Promise<ContainerHandle> {
    const { tag } = imageRunArgs(opts.image);

    const args: string[] = [
      "run",
      "--detach",
      "--name",
      opts.name,
      "--cpus",
      opts.resources.cpus,
      "--memory",
      opts.resources.memory,
      "--pids-limit",
      String(opts.resources.pidsLimit),
      "--tmpfs",
      `/tmp:rw,size=${opts.resources.tmpfsSize}`,
    ];

    if (opts.user !== undefined) args.push("--user", opts.user);
    else if (opts.image.remoteUser !== null) args.push("--user", opts.image.remoteUser);

    for (const m of opts.bindMounts) args.push(bindMountFlag(m));
    for (const [k, v] of Object.entries(opts.env)) args.push("--env", `${k}=${v}`);

    args.push(tag);
    // Keep the container alive for `docker exec` to attach to.
    args.push("sleep", "infinity");

    const proc = Bun.spawn(["docker", ...args], { stdout: "pipe", stderr: "pipe" });
    const exit = await proc.exited;
    if (exit !== 0) {
      const stderr = await readToEnd(proc.stderr);
      if (/no such image|pull access denied|manifest unknown/i.test(stderr)) {
        throw new SandboxError(
          "sandbox_image_unavailable",
          `docker run failed: ${stderr.trim()}`,
        );
      }
      throw new SandboxError("sandbox_start_failed", `docker run failed: ${stderr.trim()}`);
    }

    return new DockerHandle(opts.name);
  }
}
```

- [ ] **Step 4: Run — expect pass**

Run: `cd packages/dalang && bun test tests/sandbox/docker-host.test.ts`
Expected: PASS (or skipped on hosts without Docker).

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/dalang/src/sandbox/docker-host.ts packages/dalang/tests/sandbox/docker-host.test.ts
git commit -m "feat(dalang): DockerContainerHost for image-kind sandboxes"
```

---

## Task 6: Build helper for `dockerfile` / `devcontainer-build` images

When `ResolvedImage.tag` starts with `dalang-build:`, the image needs to be built before `docker run` can use it. Add a small helper that builds on demand and is called by `DockerContainerHost.start`. Use a sentinel field on `ResolvedImage` to carry the Dockerfile path through.

**Files:**

- Modify: `packages/dalang/src/sandbox/types.ts`
- Modify: `packages/dalang/src/sandbox/image-source.ts`
- Modify: `packages/dalang/src/sandbox/docker-host.ts`
- Modify: `packages/dalang/tests/sandbox/docker-host.test.ts`

- [ ] **Step 1: Extend `ResolvedImage` to carry an optional build context**

In `types.ts`, change the image variant:

```ts
| {
    kind: "image";
    tag: string;
    /** If set, the image must be built from this Dockerfile before run. */
    build?: { dockerfile: string; contextDir: string };
    workspaceFolder: string;
    remoteUser: string | null;
    postCreateCommand: string | null;
  }
```

- [ ] **Step 2: Populate `build` in `image-source.ts`**

For `source: "dockerfile"`:

```ts
return {
  kind: "image",
  tag: `dalang-build:${shortHash(abs)}`,
  build: { dockerfile: abs, contextDir: repoDir },
  workspaceFolder: DEFAULT_WORKSPACE_FOLDER,
  remoteUser: null,
  postCreateCommand: null,
};
```

For the devcontainer `build.dockerfile` branch:

```ts
return {
  kind: "image",
  tag: `dalang-build:${shortHash(dfAbs)}`,
  build: { dockerfile: dfAbs, contextDir: dcDir },
  workspaceFolder,
  remoteUser,
  postCreateCommand,
};
```

- [ ] **Step 3: Add `ensureImageBuilt` to `docker-host.ts`**

Add helper before `DockerContainerHost`:

```ts
async function ensureImageBuilt(image: ResolvedImage): Promise<void> {
  if (image.kind !== "image" || image.build === undefined) return;
  const inspect = Bun.spawn(["docker", "image", "inspect", image.tag], {
    stdout: "ignore",
    stderr: "ignore",
  });
  if ((await inspect.exited) === 0) return;

  const { dockerfile, contextDir } = image.build;
  const proc = Bun.spawn(
    ["docker", "build", "--tag", image.tag, "--file", dockerfile, contextDir],
    { stdout: "pipe", stderr: "pipe" },
  );
  const code = await proc.exited;
  if (code !== 0) {
    const stderr = await readToEnd(proc.stderr);
    throw new SandboxError(
      "sandbox_image_unavailable",
      `docker build failed: ${stderr.trim()}`,
    );
  }
}
```

Call it at the top of `DockerContainerHost.start`:

```ts
async start(opts: ContainerStartOptions): Promise<ContainerHandle> {
  await ensureImageBuilt(opts.image);
  // ...rest unchanged
}
```

- [ ] **Step 4: Append a build-path test**

Append to `packages/dalang/tests/sandbox/docker-host.test.ts`:

```ts
import { resolve } from "node:path";
import { resolveImage } from "../../src/sandbox/image-source";

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
```

- [ ] **Step 5: Run — expect pass**

Run: `cd packages/dalang && bun test tests/sandbox/docker-host.test.ts`
Expected: PASS (or skipped without Docker).

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/dalang/src/sandbox/types.ts packages/dalang/src/sandbox/image-source.ts packages/dalang/src/sandbox/docker-host.ts packages/dalang/tests/sandbox/docker-host.test.ts
git commit -m "feat(dalang): build dockerfile-source sandbox images on demand"
```

---

## Task 7: Compose-stack support in `DockerContainerHost`

For `ResolvedImage.kind === "compose"`, start a per-worker compose stack with project name = `opts.name`, run `docker compose up -d`, and treat the worker-service container as the exec target. `stop()` runs `docker compose down --volumes`.

**Files:**

- Modify: `packages/dalang/src/sandbox/docker-host.ts`
- Modify: `packages/dalang/tests/sandbox/docker-host.test.ts`

- [ ] **Step 1: Failing test for compose path**

Append to `packages/dalang/tests/sandbox/docker-host.test.ts`:

```ts
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
```

- [ ] **Step 2: Run — expect failure (or skip)**

Run: `cd packages/dalang && bun test tests/sandbox/docker-host.test.ts`
Expected: FAIL on a Docker host (compose path not implemented).

- [ ] **Step 3: Implement compose handle**

In `docker-host.ts`, add:

```ts
class ComposeHandle implements ContainerHandle {
  constructor(
    public readonly name: string,
    private readonly composeFile: string,
    private readonly service: string,
  ) {}

  async exec(opts: ExecOptions): Promise<ExecResult> {
    const args = ["compose", "--project-name", this.name, "--file", this.composeFile, "exec"];
    if (opts.cwd) args.push("--workdir", opts.cwd);
    for (const [k, v] of Object.entries(opts.env ?? {})) {
      args.push("--env", `${k}=${v}`);
    }
    args.push("-T", this.service, ...opts.cmd);
    const proc = Bun.spawn(["docker", ...args], { stdout: "pipe", stderr: "pipe" });
    if (opts.abortSignal) {
      const onAbort = () => {
        Bun.spawn([
          "docker",
          "compose",
          "--project-name",
          this.name,
          "--file",
          this.composeFile,
          "kill",
          "--signal",
          "SIGTERM",
          this.service,
        ]).exited.catch(() => {});
      };
      if (opts.abortSignal.aborted) onAbort();
      else opts.abortSignal.addEventListener("abort", onAbort, { once: true });
    }
    const done = (async () => {
      const exitCode = await proc.exited;
      if (exitCode === 137) {
        throw new SandboxError("sandbox_oom", `compose exec ${this.service} OOM-killed`);
      }
      return { exitCode, signal: null as NodeJS.Signals | null };
    })();
    return {
      stdout: new LineStream(proc.stdout),
      stderr: new LineStream(proc.stderr),
      done,
    };
  }

  async stop(): Promise<void> {
    const proc = Bun.spawn(
      [
        "docker",
        "compose",
        "--project-name",
        this.name,
        "--file",
        this.composeFile,
        "down",
        "--volumes",
        "--remove-orphans",
      ],
      { stdout: "ignore", stderr: "ignore" },
    );
    await proc.exited;
  }
}
```

Branch in `start`:

```ts
async start(opts: ContainerStartOptions): Promise<ContainerHandle> {
  if (opts.image.kind === "compose") {
    return this.startCompose(opts, opts.image);
  }
  await ensureImageBuilt(opts.image);
  // ...existing image-kind body
}

private async startCompose(
  opts: ContainerStartOptions,
  image: Extract<ResolvedImage, { kind: "compose" }>,
): Promise<ContainerHandle> {
  const proc = Bun.spawn(
    [
      "docker",
      "compose",
      "--project-name",
      opts.name,
      "--file",
      image.composeFile,
      "up",
      "--detach",
      "--wait",
    ],
    { stdout: "ignore", stderr: "pipe" },
  );
  const code = await proc.exited;
  if (code !== 0) {
    const stderr = await readToEnd(proc.stderr);
    throw new SandboxError(
      "sandbox_start_failed",
      `docker compose up failed: ${stderr.trim()}`,
    );
  }
  return new ComposeHandle(opts.name, image.composeFile, image.service);
}
```

Also update the `imageRunArgs` helper to be unused for compose (it's already guarded by the `kind === "compose"` branch — leave the helper for image-kind clarity).

> **Note on resource limits in compose mode:** Docker Compose ignores `--cpus` / `--memory` flags from the parent process; resources have to be declared in the compose file's `deploy.resources` block. v1 documents this and does not enforce limits in compose mode (recorded in §10 of the spec). Add a TODO comment in `startCompose` referencing this.

- [ ] **Step 4: Run — expect pass**

Run: `cd packages/dalang && bun test tests/sandbox/docker-host.test.ts`
Expected: PASS (or skipped without Docker).

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/dalang/src/sandbox/docker-host.ts packages/dalang/tests/sandbox/docker-host.test.ts
git commit -m "feat(dalang): per-worker docker compose stacks for sandbox"
```

---

## Task 8: `sandbox` index module and barrel exports

**Files:**

- Create: `packages/dalang/src/sandbox/index.ts`

- [ ] **Step 1: Create the barrel**

```ts
export {
  SandboxImageConfigSchema,
  SandboxResourcesSchema,
  SandboxError,
} from "./types";
export type {
  SandboxImageConfig,
  SandboxResources,
  ResolvedImage,
  BindMount,
  ContainerHost,
  ContainerHandle,
  ContainerStartOptions,
  ExecOptions,
  ExecResult,
} from "./types";
export { resolveImage } from "./image-source";
export { DockerContainerHost } from "./docker-host";
export { FakeContainerHost } from "./fake-host";
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Verify the public surface compiles in isolation**

Run: `cd packages/dalang && bun -e 'import("./src/sandbox/index").then(m => console.log(Object.keys(m).sort().join(",")))'`
Expected: prints `BindMount,ContainerHandle,ContainerHost,...,resolveImage,...`. (The exact order doesn't matter; the test is that the import succeeds.)

- [ ] **Step 4: Commit**

```bash
git add packages/dalang/src/sandbox/index.ts
git commit -m "feat(dalang): sandbox barrel exports"
```

---

## Task 9: README note for the new module

**Files:**

- Modify: `packages/dalang/README.md`

- [ ] **Step 1: Add a Sandbox section near the bottom of the README**

Append:

```markdown
## Sandbox (Phase 1 — foundation)

`packages/dalang/src/sandbox/` provides container primitives used by later
phases of the sandboxed-workers feature. The `ContainerHost` interface has
two implementations: `DockerContainerHost` (real Docker; requires the
`docker` CLI) and `FakeContainerHost` (in-process, host subprocesses, for
unit tests).

`resolveImage()` resolves a `SandboxImageConfig` to a concrete `ResolvedImage`
by reading `.devcontainer/devcontainer.json`, building a Dockerfile, or
passing through a tagged image. Per-worker docker-compose stacks are
supported via the `compose` resolved-image kind.

This module is not yet wired into the agent runner. The runner integration
lands in Phase 4 of the sandboxed-workers plan.
```

- [ ] **Step 2: Commit**

```bash
git add packages/dalang/README.md
git commit -m "docs(dalang): document sandbox module foundation"
```

---

## Task 10: Final verification pass

- [ ] **Step 1: Full typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 2: Full test run**

Run: `cd packages/dalang && bun test`
Expected: all tests pass. Docker-gated tests are skipped on hosts without Docker; CI must have Docker available to exercise them.

- [ ] **Step 3: Lint**

Run: `bun run lint` (from repo root, if defined; otherwise `bunx oxlint packages/dalang/src packages/dalang/tests`)
Expected: no errors.

- [ ] **Step 4: Verify no orphaned containers from tests**

Run: `docker ps -a --filter "name=dalang-test-" --filter "name=dalang-compose-test-"`
Expected: empty. If any are listed, the test cleanup is broken — investigate before declaring Phase 1 done.

- [ ] **Step 5: Final commit (if any cleanup landed)**

```bash
git status
# If no further changes, no commit needed.
```

---

## Phase 1 Done Criteria

- `ContainerHost` interface and both implementations exist and pass tests.
- `resolveImage()` handles all three `SandboxImageConfig` modes including devcontainer compose.
- Resource limits (`cpus`, `memory`, `pidsLimit`, `tmpfsSize`) are passed to `docker run` in image mode (compose mode TODO documented).
- No dalang code outside `packages/dalang/src/sandbox/` is changed by this phase except for the README. The agent layer is untouched.
- Docker-gated integration tests pass in CI; unit tests (FakeContainerHost, image-source resolution) pass on developer machines without Docker.

## Next Phases (separate plans)

- **Phase 2:** bayang shim binary (bun build --compile, NDJSON event protocol, in-shim claude/codex/opencode runners).
- **Phase 3:** Credential store, per-worker auth file projection, `dalang auth login <provider>` subcommand.
- **Phase 4:** Runner refactor (`sdk-runner.ts` / `codex-runner.ts` / `opencode-runner.ts`) to use `ContainerHost` + shim, sandbox config block in `WORKFLOW.md`, error classifications wired into `RuntimeEvent`s, end-to-end devcontainer fixture.
