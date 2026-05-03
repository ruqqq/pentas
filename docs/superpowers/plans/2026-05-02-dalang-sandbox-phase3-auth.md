# Sandboxed Workers Phase 3 — Auth Credential Store & Projection

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-user credential store at `<dalang-config>/credentials/`, separate from the host CLIs' credential stores (`~/.claude`, `~/.codex`, `~/.local/share/opencode`). Add a `prepareWorkerCredentials()` function that, given a provider, produces env vars + bind mounts to inject credentials into a worker container, plus a `dispose()` that writes back any refreshed credentials. Add a `dalang auth set <provider>` CLI subcommand so users can populate the store from a copy of their host credentials. Phase 3 does **not** implement interactive login flows (`dalang auth login`) — those are deferred to a follow-up; users run their existing CLIs (`claude setup-token`, `codex login`, `opencode auth login`) on the host, then run `dalang auth set ...` to copy the result into dalang's store.

**Architecture:** New `packages/dalang/src/auth/` module with three pieces: (a) `store.ts` — filesystem-backed `AuthStore` with read/write per provider, paths under `~/.config/dalang/credentials/` by default (configurable via `DALANG_CONFIG_HOME`); (b) `projector.ts` — `prepareWorkerCredentials(store, provider, workerId)` returns `{ env: Record<string,string>, bindMounts: BindMount[], dispose: () => Promise<void> }` that callers feed into `ContainerStartOptions`; (c) `cli.ts` — `dalang auth set <provider>` plumbing. Per-provider strategies follow the spec table:

| Provider | Storage in dalang | Worker injection |
|---|---|---|
| Claude | `credentials/claude_oauth_token` (file containing the token, mode 0600) | env `CLAUDE_CODE_OAUTH_TOKEN=<contents>`, no FS mount |
| Codex | `credentials/codex/auth.json` | bind-mount `<state>/sandboxes/<worker-id>/codex/` r/w → `/run/dalang/codex`, env `CODEX_HOME=/run/dalang/codex` |
| opencode | `credentials/opencode/auth.json` | bind-mount `<state>/sandboxes/<worker-id>/opencode-data/opencode/` r/w → `/run/dalang/opencode-data/opencode`, env `XDG_DATA_HOME=/run/dalang/opencode-data` |

For codex/opencode, `dispose()` reads the (possibly refreshed) `auth.json` back from the per-worker tmpdir and overwrites `credentials/{codex,opencode}/auth.json` (last-writer-wins). The race we accepted is documented in the spec §5.1.

**Tech Stack:** Bun, TypeScript (strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes + verbatimModuleSyntax), zod, `bun test`. No new deps. Spec: `docs/superpowers/specs/2026-05-02-dalang-sandboxed-workers-design.md` §5 and §5.2 (file-projection mechanism).

---

## File Structure

**Create:**

- `packages/dalang/src/auth/store.ts` — `AuthStore` interface + filesystem impl
- `packages/dalang/src/auth/projector.ts` — `prepareWorkerCredentials()` + per-provider strategies
- `packages/dalang/src/auth/cli.ts` — `dalang auth set <provider> ...` handler
- `packages/dalang/src/auth/index.ts` — barrel
- `packages/dalang/tests/auth/store.test.ts`
- `packages/dalang/tests/auth/projector.test.ts`
- `packages/dalang/tests/auth/cli.test.ts`

**Modify:**

- `packages/dalang/src/cli/args.ts` — add `auth` subcommand parsing
- `packages/dalang/src/cli/bootstrap.ts` — route `auth` to the auth CLI handler

---

## Task 1: `AuthStore` interface and filesystem implementation

**Files:**

- Create: `packages/dalang/src/auth/store.ts`
- Test: `packages/dalang/tests/auth/store.test.ts`

The store has three operations per provider: `get`, `set`, `clear`. The on-disk layout is fixed; tests use a temp dir as the store root.

- [ ] **Step 1: Failing test**

Create `packages/dalang/tests/auth/store.test.ts`:

```ts
import { test, expect } from "bun:test";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realpath } from "node:fs/promises";
import { FilesystemAuthStore } from "../../src/auth/store";

async function newStore(): Promise<FilesystemAuthStore> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "auth-store-")));
  return new FilesystemAuthStore(dir);
}

test("claude token round-trips", async () => {
  const store = await newStore();
  expect(await store.getClaudeToken()).toBeNull();
  await store.setClaudeToken("sk-ant-oat01-abc");
  expect(await store.getClaudeToken()).toBe("sk-ant-oat01-abc");
});

test("claude token file has 0600 permissions", async () => {
  const store = await newStore();
  await store.setClaudeToken("hello");
  const path = store.claudeTokenPath();
  const s = await stat(path);
  // mask off non-permission bits, expect rw for owner only.
  expect(s.mode & 0o777).toBe(0o600);
});

test("codex auth.json round-trips as a file copy", async () => {
  const store = await newStore();
  expect(await store.getCodexAuthJson()).toBeNull();
  const sample = { access_token: "tok", refresh_token: "ref", last_refresh: 0 };
  await store.setCodexAuthJson(JSON.stringify(sample));
  const got = await store.getCodexAuthJson();
  expect(got).not.toBeNull();
  expect(JSON.parse(got as string)).toEqual(sample);
});

test("opencode auth.json round-trips", async () => {
  const store = await newStore();
  expect(await store.getOpencodeAuthJson()).toBeNull();
  await store.setOpencodeAuthJson('{"providers":{}}');
  expect(await store.getOpencodeAuthJson()).toBe('{"providers":{}}');
});

test("clearing a credential removes the file", async () => {
  const store = await newStore();
  await store.setClaudeToken("x");
  await store.clearClaudeToken();
  expect(await store.getClaudeToken()).toBeNull();
  await expect(readFile(store.claudeTokenPath())).rejects.toBeDefined();
});
```

- [ ] **Step 2: Run — expect failure**

Run: `bun test packages/dalang/tests/auth/store.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `packages/dalang/src/auth/store.ts`**

```ts
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface AuthStore {
  getClaudeToken(): Promise<string | null>;
  setClaudeToken(token: string): Promise<void>;
  clearClaudeToken(): Promise<void>;

  getCodexAuthJson(): Promise<string | null>;
  setCodexAuthJson(raw: string): Promise<void>;
  clearCodexAuthJson(): Promise<void>;

  getOpencodeAuthJson(): Promise<string | null>;
  setOpencodeAuthJson(raw: string): Promise<void>;
  clearOpencodeAuthJson(): Promise<void>;
}

async function readOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function writeAtomic(path: string, content: string, mode: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmp, content, { mode });
  await rename(tmp, path);
}

async function removeIfExists(path: string): Promise<void> {
  try {
    await rm(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

export class FilesystemAuthStore implements AuthStore {
  constructor(public readonly root: string) {}

  claudeTokenPath(): string {
    return join(this.root, "claude_oauth_token");
  }

  codexAuthJsonPath(): string {
    return join(this.root, "codex", "auth.json");
  }

  opencodeAuthJsonPath(): string {
    return join(this.root, "opencode", "auth.json");
  }

  getClaudeToken(): Promise<string | null> {
    return readOrNull(this.claudeTokenPath());
  }

  async setClaudeToken(token: string): Promise<void> {
    await writeAtomic(this.claudeTokenPath(), token, 0o600);
  }

  clearClaudeToken(): Promise<void> {
    return removeIfExists(this.claudeTokenPath());
  }

  getCodexAuthJson(): Promise<string | null> {
    return readOrNull(this.codexAuthJsonPath());
  }

  async setCodexAuthJson(raw: string): Promise<void> {
    await writeAtomic(this.codexAuthJsonPath(), raw, 0o600);
  }

  clearCodexAuthJson(): Promise<void> {
    return removeIfExists(this.codexAuthJsonPath());
  }

  getOpencodeAuthJson(): Promise<string | null> {
    return readOrNull(this.opencodeAuthJsonPath());
  }

  async setOpencodeAuthJson(raw: string): Promise<void> {
    await writeAtomic(this.opencodeAuthJsonPath(), raw, 0o600);
  }

  clearOpencodeAuthJson(): Promise<void> {
    return removeIfExists(this.opencodeAuthJsonPath());
  }
}

/** Default store root: $DALANG_CONFIG_HOME/credentials, else ~/.config/dalang/credentials. */
export function defaultStoreRoot(env: NodeJS.ProcessEnv = process.env): string {
  if (typeof env["DALANG_CONFIG_HOME"] === "string" && env["DALANG_CONFIG_HOME"].length > 0) {
    return join(env["DALANG_CONFIG_HOME"], "credentials");
  }
  const home = env["HOME"] ?? "";
  return join(home, ".config", "dalang", "credentials");
}
```

- [ ] **Step 4: Run — expect pass**

Run: `bun test packages/dalang/tests/auth/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`

- [ ] **Step 6: Commit**

```bash
git add packages/dalang/src/auth/store.ts packages/dalang/tests/auth/store.test.ts
git commit -m "feat(dalang): filesystem-backed credential store"
```

---

## Task 2: Per-provider projection strategy types

**Files:**

- Create: `packages/dalang/src/auth/projector.ts`
- Test: `packages/dalang/tests/auth/projector.test.ts`

The projector exposes one entry: `prepareWorkerCredentials(opts)`. It returns env vars to inject into the worker container, optional bind mounts pointing at per-worker tmpdirs, and a `dispose()` that handles writeback and cleanup.

For Task 2 we implement only the **claude (env-only)** path. Codex and opencode follow in Tasks 3 and 4.

- [ ] **Step 1: Failing test**

Create `packages/dalang/tests/auth/projector.test.ts`:

```ts
import { test, expect } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realpath } from "node:fs/promises";
import { FilesystemAuthStore } from "../../src/auth/store";
import { prepareWorkerCredentials } from "../../src/auth/projector";

async function newStore(): Promise<FilesystemAuthStore> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "auth-proj-")));
  return new FilesystemAuthStore(dir);
}

test("claude projection injects CLAUDE_CODE_OAUTH_TOKEN env, no bind mounts", async () => {
  const store = await newStore();
  await store.setClaudeToken("sk-ant-oat01-abc");
  const sandboxesRoot = await realpath(await mkdtemp(join(tmpdir(), "sandboxes-")));
  const proj = await prepareWorkerCredentials({
    store,
    provider: "claude",
    workerId: "w1",
    sandboxesRoot,
  });
  expect(proj.env).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-abc" });
  expect(proj.bindMounts).toEqual([]);
  await proj.dispose();
});

test("claude projection throws when no token is stored", async () => {
  const store = await newStore();
  const sandboxesRoot = await realpath(await mkdtemp(join(tmpdir(), "sandboxes-")));
  await expect(
    prepareWorkerCredentials({
      store,
      provider: "claude",
      workerId: "w1",
      sandboxesRoot,
    }),
  ).rejects.toMatchObject({ code: "auth_missing" });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `bun test packages/dalang/tests/auth/projector.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `packages/dalang/src/auth/projector.ts`**

```ts
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { BindMount } from "../sandbox/types";
import type { AuthStore } from "./store";

export class AuthError extends Error {
  constructor(public readonly code: "auth_missing" | "auth_invalid", message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export type AuthProvider = "claude" | "codex" | "opencode";

export interface PrepareCredentialsOptions {
  store: AuthStore;
  provider: AuthProvider;
  /** Stable per-worker identifier; used as the per-worker tmpdir name. */
  workerId: string;
  /** Root directory under which per-worker tmpdirs are created. */
  sandboxesRoot: string;
}

export interface PreparedCredentials {
  /** Env vars to inject into the worker container. */
  env: Record<string, string>;
  /** Bind mounts to attach to the worker container. */
  bindMounts: BindMount[];
  /** Called after the worker exits. Writes back any refreshed credentials and removes tmpdirs. */
  dispose(): Promise<void>;
}

export async function prepareWorkerCredentials(
  opts: PrepareCredentialsOptions,
): Promise<PreparedCredentials> {
  switch (opts.provider) {
    case "claude":
      return prepareClaudeCredentials(opts);
    case "codex":
      throw new AuthError(
        "auth_missing",
        "codex credential projection not yet implemented (Task 3)",
      );
    case "opencode":
      throw new AuthError(
        "auth_missing",
        "opencode credential projection not yet implemented (Task 4)",
      );
  }
}

async function prepareClaudeCredentials(
  opts: PrepareCredentialsOptions,
): Promise<PreparedCredentials> {
  const token = await opts.store.getClaudeToken();
  if (token === null || token.length === 0) {
    throw new AuthError(
      "auth_missing",
      "no claude token in store; run `dalang auth set claude --token <t>` first",
    );
  }
  return {
    env: { CLAUDE_CODE_OAUTH_TOKEN: token.trim() },
    bindMounts: [],
    dispose: async () => {
      // Nothing to clean up for env-only providers.
    },
  };
}

/** Helper used by codex/opencode projections in later tasks. */
export async function ensureWorkerSandboxDir(
  sandboxesRoot: string,
  workerId: string,
  subPath: string,
): Promise<string> {
  const dir = join(sandboxesRoot, workerId, subPath);
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Helper used by codex/opencode projections to remove per-worker tmpdirs. */
export async function removeWorkerSandbox(
  sandboxesRoot: string,
  workerId: string,
): Promise<void> {
  const dir = join(sandboxesRoot, workerId);
  await rm(dir, { recursive: true, force: true });
}
```

- [ ] **Step 4: Run — expect pass**

Run: `bun test packages/dalang/tests/auth/projector.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`

- [ ] **Step 6: Commit**

```bash
git add packages/dalang/src/auth/projector.ts packages/dalang/tests/auth/projector.test.ts
git commit -m "feat(dalang): claude credential projection (env-only)"
```

---

## Task 3: Codex credential projection (file mount + writeback)

Codex's `auth.json` lives at `$CODEX_HOME/auth.json` inside the container. The shim's codex-sdk refreshes the token in-process and writes back to that file. Phase 3 must:

1. Copy `credentials/codex/auth.json` into a per-worker tmpdir at `<sandboxesRoot>/<workerId>/codex/auth.json`.
2. Bind-mount that tmpdir read-write to `/run/dalang/codex` inside the container.
3. Set `CODEX_HOME=/run/dalang/codex` in the container env.
4. On `dispose()`, read the (possibly refreshed) `auth.json` back and overwrite `credentials/codex/auth.json` if it changed. Remove the tmpdir.

**Files:**

- Modify: `packages/dalang/src/auth/projector.ts`
- Modify: `packages/dalang/tests/auth/projector.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
import { readFile, writeFile } from "node:fs/promises";

test("codex projection mounts the per-worker dir and sets CODEX_HOME", async () => {
  const store = await newStore();
  const initial = JSON.stringify({ access_token: "v1", refresh_token: "r1", last_refresh: 100 });
  await store.setCodexAuthJson(initial);
  const sandboxesRoot = await realpath(await mkdtemp(join(tmpdir(), "sandboxes-")));

  const proj = await prepareWorkerCredentials({
    store,
    provider: "codex",
    workerId: "w-codex",
    sandboxesRoot,
  });

  expect(proj.env).toEqual({ CODEX_HOME: "/run/dalang/codex" });
  expect(proj.bindMounts).toHaveLength(1);
  const mount = proj.bindMounts[0];
  expect(mount?.containerPath).toBe("/run/dalang/codex");
  expect(mount?.readOnly).toBe(false);
  // The mounted tmpdir contains a copy of auth.json.
  const mounted = await readFile(join(mount?.hostPath as string, "auth.json"), "utf8");
  expect(mounted).toBe(initial);

  await proj.dispose();
});

test("codex projection writes back a refreshed auth.json on dispose", async () => {
  const store = await newStore();
  await store.setCodexAuthJson('{"access_token":"v1"}');
  const sandboxesRoot = await realpath(await mkdtemp(join(tmpdir(), "sandboxes-")));

  const proj = await prepareWorkerCredentials({
    store,
    provider: "codex",
    workerId: "w-codex-rotate",
    sandboxesRoot,
  });
  // Simulate the in-container codex SDK rotating the token.
  await writeFile(
    join(proj.bindMounts[0]?.hostPath as string, "auth.json"),
    '{"access_token":"v2"}',
  );
  await proj.dispose();

  const after = await store.getCodexAuthJson();
  expect(after).toBe('{"access_token":"v2"}');
});

test("codex projection throws auth_missing when no auth.json is stored", async () => {
  const store = await newStore();
  const sandboxesRoot = await realpath(await mkdtemp(join(tmpdir(), "sandboxes-")));
  await expect(
    prepareWorkerCredentials({ store, provider: "codex", workerId: "w", sandboxesRoot }),
  ).rejects.toMatchObject({ code: "auth_missing" });
});
```

- [ ] **Step 2: Run — expect 3 failures**

Run: `bun test packages/dalang/tests/auth/projector.test.ts`

- [ ] **Step 3: Implement codex branch in `projector.ts`**

Replace the codex `throw` with:

```ts
    case "codex":
      return prepareCodexCredentials(opts);
```

Add the implementation:

```ts
async function prepareCodexCredentials(
  opts: PrepareCredentialsOptions,
): Promise<PreparedCredentials> {
  const initial = await opts.store.getCodexAuthJson();
  if (initial === null) {
    throw new AuthError(
      "auth_missing",
      "no codex credentials in store; run `dalang auth set codex --from <auth.json>` first",
    );
  }
  const dir = await ensureWorkerSandboxDir(opts.sandboxesRoot, opts.workerId, "codex");
  const authPath = join(dir, "auth.json");
  await writeFile(authPath, initial, { mode: 0o600 });

  return {
    env: { CODEX_HOME: "/run/dalang/codex" },
    bindMounts: [
      {
        hostPath: dir,
        containerPath: "/run/dalang/codex",
        readOnly: false,
      },
    ],
    dispose: async () => {
      try {
        const final = await readFile(authPath, "utf8");
        if (final !== initial) {
          await opts.store.setCodexAuthJson(final);
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        // If the shim deleted auth.json, leave the store as-is.
      }
      await removeWorkerSandbox(opts.sandboxesRoot, opts.workerId);
    },
  };
}
```

Add the `readFile`/`writeFile` import:

```ts
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
```

- [ ] **Step 4: Run — expect pass**

Run: `bun test packages/dalang/tests/auth/projector.test.ts`
Expected: PASS (5 tests now: 2 claude + 3 codex).

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`

- [ ] **Step 6: Commit**

```bash
git add packages/dalang/src/auth/projector.ts packages/dalang/tests/auth/projector.test.ts
git commit -m "feat(dalang): codex credential projection with refresh writeback"
```

---

## Task 4: Opencode credential projection

Same shape as codex but the path is `$XDG_DATA_HOME/opencode/auth.json` inside the container. We project to `<sandboxesRoot>/<workerId>/opencode-data/opencode/auth.json` and bind-mount the parent (`opencode-data`) so opencode sees `$XDG_DATA_HOME/opencode/auth.json` correctly.

**Files:**

- Modify: `packages/dalang/src/auth/projector.ts`
- Modify: `packages/dalang/tests/auth/projector.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
test("opencode projection mounts opencode-data dir and sets XDG_DATA_HOME", async () => {
  const store = await newStore();
  const initial = '{"providers":{"anthropic":{"key":"sk-ant-..."}}}';
  await store.setOpencodeAuthJson(initial);
  const sandboxesRoot = await realpath(await mkdtemp(join(tmpdir(), "sandboxes-")));

  const proj = await prepareWorkerCredentials({
    store,
    provider: "opencode",
    workerId: "w-oc",
    sandboxesRoot,
  });

  expect(proj.env).toEqual({ XDG_DATA_HOME: "/run/dalang/opencode-data" });
  expect(proj.bindMounts).toHaveLength(1);
  const mount = proj.bindMounts[0];
  expect(mount?.containerPath).toBe("/run/dalang/opencode-data");
  expect(mount?.readOnly).toBe(false);
  const mounted = await readFile(
    join(mount?.hostPath as string, "opencode", "auth.json"),
    "utf8",
  );
  expect(mounted).toBe(initial);

  await proj.dispose();
});

test("opencode projection writes back a refreshed auth.json on dispose", async () => {
  const store = await newStore();
  await store.setOpencodeAuthJson("{}");
  const sandboxesRoot = await realpath(await mkdtemp(join(tmpdir(), "sandboxes-")));
  const proj = await prepareWorkerCredentials({
    store,
    provider: "opencode",
    workerId: "w-oc-rotate",
    sandboxesRoot,
  });
  await writeFile(
    join(proj.bindMounts[0]?.hostPath as string, "opencode", "auth.json"),
    '{"providers":{"x":{"k":"v"}}}',
  );
  await proj.dispose();
  expect(await store.getOpencodeAuthJson()).toBe('{"providers":{"x":{"k":"v"}}}');
});

test("opencode projection throws auth_missing when no auth.json is stored", async () => {
  const store = await newStore();
  const sandboxesRoot = await realpath(await mkdtemp(join(tmpdir(), "sandboxes-")));
  await expect(
    prepareWorkerCredentials({ store, provider: "opencode", workerId: "w", sandboxesRoot }),
  ).rejects.toMatchObject({ code: "auth_missing" });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `bun test packages/dalang/tests/auth/projector.test.ts`

- [ ] **Step 3: Implement opencode branch**

Replace the opencode `throw` with:

```ts
    case "opencode":
      return prepareOpencodeCredentials(opts);
```

Add the implementation:

```ts
async function prepareOpencodeCredentials(
  opts: PrepareCredentialsOptions,
): Promise<PreparedCredentials> {
  const initial = await opts.store.getOpencodeAuthJson();
  if (initial === null) {
    throw new AuthError(
      "auth_missing",
      "no opencode credentials in store; run `dalang auth set opencode --from <auth.json>` first",
    );
  }
  // The container expects $XDG_DATA_HOME/opencode/auth.json. We bind-mount the
  // XDG_DATA_HOME root so opencode's path resolution works unchanged.
  const xdgRoot = await ensureWorkerSandboxDir(
    opts.sandboxesRoot,
    opts.workerId,
    "opencode-data",
  );
  const opencodeDir = join(xdgRoot, "opencode");
  await mkdir(opencodeDir, { recursive: true });
  const authPath = join(opencodeDir, "auth.json");
  await writeFile(authPath, initial, { mode: 0o600 });

  return {
    env: { XDG_DATA_HOME: "/run/dalang/opencode-data" },
    bindMounts: [
      {
        hostPath: xdgRoot,
        containerPath: "/run/dalang/opencode-data",
        readOnly: false,
      },
    ],
    dispose: async () => {
      try {
        const final = await readFile(authPath, "utf8");
        if (final !== initial) {
          await opts.store.setOpencodeAuthJson(final);
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
      await removeWorkerSandbox(opts.sandboxesRoot, opts.workerId);
    },
  };
}
```

- [ ] **Step 4: Run — expect pass**

Run: `bun test packages/dalang/tests/auth/projector.test.ts`
Expected: PASS (8 tests total).

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`

- [ ] **Step 6: Commit**

```bash
git add packages/dalang/src/auth/projector.ts packages/dalang/tests/auth/projector.test.ts
git commit -m "feat(dalang): opencode credential projection with refresh writeback"
```

---

## Task 5: `dalang auth set <provider>` CLI subcommand

For users to populate the credential store, add a CLI subcommand:

- `dalang auth set claude --token <token>`
- `dalang auth set codex --from <path-to-auth.json>`
- `dalang auth set opencode --from <path-to-auth.json>`

Optional: `dalang auth clear <provider>`. Optional: `dalang auth status` (just lists which providers have credentials, without printing them).

**Files:**

- Create: `packages/dalang/src/auth/cli.ts`
- Create: `packages/dalang/tests/auth/cli.test.ts`
- Modify: `packages/dalang/src/cli/args.ts` — extend `ParsedArgs` and parsing
- Modify: `packages/dalang/src/cli/bootstrap.ts` — route `auth` to the handler

- [ ] **Step 1: Failing test**

Create `packages/dalang/tests/auth/cli.test.ts`:

```ts
import { test, expect } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realpath } from "node:fs/promises";
import { FilesystemAuthStore } from "../../src/auth/store";
import { runAuthCli } from "../../src/auth/cli";

async function newStore(): Promise<FilesystemAuthStore> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "auth-cli-")));
  return new FilesystemAuthStore(dir);
}

test("auth set claude --token writes to the store", async () => {
  const store = await newStore();
  const exit = await runAuthCli({
    store,
    argv: ["set", "claude", "--token", "sk-ant-oat01-abc"],
    log: () => {},
  });
  expect(exit).toBe(0);
  expect(await store.getClaudeToken()).toBe("sk-ant-oat01-abc");
});

test("auth set codex --from <path> reads the file and writes to the store", async () => {
  const store = await newStore();
  const tmp = await realpath(await mkdtemp(join(tmpdir(), "auth-cli-src-")));
  const src = join(tmp, "auth.json");
  await writeFile(src, '{"access_token":"abc"}');
  const exit = await runAuthCli({ store, argv: ["set", "codex", "--from", src], log: () => {} });
  expect(exit).toBe(0);
  expect(await store.getCodexAuthJson()).toBe('{"access_token":"abc"}');
});

test("auth status prints which providers have credentials", async () => {
  const store = await newStore();
  await store.setClaudeToken("x");
  const lines: string[] = [];
  const exit = await runAuthCli({ store, argv: ["status"], log: (l) => lines.push(l) });
  expect(exit).toBe(0);
  const output = lines.join("\n");
  expect(output).toContain("claude");
  expect(output).toMatch(/configured|set|present/i);
});

test("auth clear <provider> removes the credential", async () => {
  const store = await newStore();
  await store.setClaudeToken("x");
  const exit = await runAuthCli({ store, argv: ["clear", "claude"], log: () => {} });
  expect(exit).toBe(0);
  expect(await store.getClaudeToken()).toBeNull();
});

test("auth with bad subcommand exits non-zero", async () => {
  const store = await newStore();
  const exit = await runAuthCli({ store, argv: ["whatever"], log: () => {} });
  expect(exit).not.toBe(0);
});
```

- [ ] **Step 2: Run — expect failure**

Run: `bun test packages/dalang/tests/auth/cli.test.ts`

- [ ] **Step 3: Implement `packages/dalang/src/auth/cli.ts`**

```ts
import { readFile } from "node:fs/promises";
import type { AuthStore } from "./store";

export interface AuthCliOptions {
  store: AuthStore;
  argv: string[];
  log: (line: string) => void;
}

export async function runAuthCli(opts: AuthCliOptions): Promise<number> {
  const [sub, ...rest] = opts.argv;
  switch (sub) {
    case "set":
      return runSet(opts.store, rest, opts.log);
    case "clear":
      return runClear(opts.store, rest, opts.log);
    case "status":
      return runStatus(opts.store, opts.log);
    default:
      opts.log(
        "usage: dalang auth <set|clear|status> [args]\n" +
          "  set claude --token <token>\n" +
          "  set codex --from <path-to-auth.json>\n" +
          "  set opencode --from <path-to-auth.json>\n" +
          "  clear <claude|codex|opencode>\n" +
          "  status",
      );
      return 2;
  }
}

async function runSet(store: AuthStore, args: string[], log: (l: string) => void): Promise<number> {
  const provider = args[0];
  if (provider === "claude") {
    const tokenIdx = args.indexOf("--token");
    if (tokenIdx === -1 || typeof args[tokenIdx + 1] !== "string") {
      log("auth set claude requires --token <token>");
      return 2;
    }
    await store.setClaudeToken(args[tokenIdx + 1] as string);
    log("claude token stored");
    return 0;
  }
  if (provider === "codex" || provider === "opencode") {
    const fromIdx = args.indexOf("--from");
    if (fromIdx === -1 || typeof args[fromIdx + 1] !== "string") {
      log(`auth set ${provider} requires --from <path>`);
      return 2;
    }
    const raw = await readFile(args[fromIdx + 1] as string, "utf8");
    if (provider === "codex") await store.setCodexAuthJson(raw);
    else await store.setOpencodeAuthJson(raw);
    log(`${provider} auth.json stored`);
    return 0;
  }
  log(`unknown provider: ${provider ?? "<none>"}`);
  return 2;
}

async function runClear(store: AuthStore, args: string[], log: (l: string) => void): Promise<number> {
  const provider = args[0];
  switch (provider) {
    case "claude":
      await store.clearClaudeToken();
      break;
    case "codex":
      await store.clearCodexAuthJson();
      break;
    case "opencode":
      await store.clearOpencodeAuthJson();
      break;
    default:
      log(`unknown provider: ${provider ?? "<none>"}`);
      return 2;
  }
  log(`${provider} cleared`);
  return 0;
}

async function runStatus(store: AuthStore, log: (l: string) => void): Promise<number> {
  const claude = (await store.getClaudeToken()) !== null ? "configured" : "missing";
  const codex = (await store.getCodexAuthJson()) !== null ? "configured" : "missing";
  const opencode = (await store.getOpencodeAuthJson()) !== null ? "configured" : "missing";
  log(`claude:    ${claude}`);
  log(`codex:     ${codex}`);
  log(`opencode:  ${opencode}`);
  return 0;
}
```

- [ ] **Step 4: Wire `auth` into `cli/args.ts`**

Read the existing `args.ts` first. Then extend it so `dalang auth <subcommand>` parses cleanly. Minimal additive shape: add `"auth"` to the `command` union and capture the rest of argv for the auth handler:

```ts
export interface ParsedArgs {
  command: "serve" | "lint" | "auth";
  workflowPath: string;
  port: number | null;
  help: boolean;
  /** Populated only when command === "auth"; contains the args after `auth`. */
  authArgv?: string[];
}
```

In `parseArgs(argv)`, branch on `argv[0] === "auth"` and return `{ command: "auth", workflowPath: "", port: null, help: false, authArgv: argv.slice(1) }`. Update `DALANG_HELP` to mention the new subcommand.

- [ ] **Step 5: Wire `auth` into `cli/bootstrap.ts`**

Read the existing `bootstrap.ts` to find where it dispatches commands. When `args.command === "auth"`, instantiate `FilesystemAuthStore(defaultStoreRoot())` and call `runAuthCli({ store, argv: args.authArgv ?? [], log: console.log })`, then `process.exit(exitCode)`.

- [ ] **Step 6: Add a CLI integration test**

Append to `packages/dalang/tests/auth/cli.test.ts`:

```ts
test("dalang auth status runs end-to-end through the CLI", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "auth-cli-e2e-")));
  const proc = Bun.spawn(["bun", "run", "src/index.ts", "auth", "status"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, DALANG_CONFIG_HOME: dir } as Record<string, string>,
  });
  const out = await new Response(proc.stdout).text();
  const exit = await proc.exited;
  expect(exit).toBe(0);
  expect(out).toContain("claude:");
});
```

(If `bun run src/index.ts` doesn't exist as the entry, check `package.json#bin` and use whatever path is correct.)

- [ ] **Step 7: Run — expect pass**

Run: `bun test packages/dalang/tests/auth/`
Expected: all PASS.

- [ ] **Step 8: Typecheck**

Run: `bun run typecheck`

- [ ] **Step 9: Commit**

```bash
git add packages/dalang/src/auth/cli.ts packages/dalang/src/cli/args.ts packages/dalang/src/cli/bootstrap.ts packages/dalang/tests/auth/cli.test.ts
git commit -m "feat(dalang): dalang auth set/clear/status CLI"
```

---

## Task 6: Auth barrel + README note

**Files:**

- Create: `packages/dalang/src/auth/index.ts`
- Modify: `packages/dalang/README.md`

- [ ] **Step 1: Create the barrel**

```ts
export { FilesystemAuthStore, defaultStoreRoot } from "./store";
export type { AuthStore } from "./store";
export {
  prepareWorkerCredentials,
  AuthError,
} from "./projector";
export type {
  AuthProvider,
  PrepareCredentialsOptions,
  PreparedCredentials,
} from "./projector";
export { runAuthCli } from "./cli";
export type { AuthCliOptions } from "./cli";
```

- [ ] **Step 2: Append a README section**

Append:

```markdown
---

## Auth credential store (Phase 3)

dalang stores per-user provider credentials at `~/.config/dalang/credentials/`
(override with `DALANG_CONFIG_HOME`). It does *not* read or write your host
CLI's credential dirs (`~/.claude`, `~/.codex`, `~/.local/share/opencode`).

To populate the store, run your provider CLI's login flow once, then point
dalang at the result:

```bash
# Claude (long-lived token)
claude setup-token  # produces a token starting with "sk-ant-oat01-..."
dalang auth set claude --token "sk-ant-oat01-..."

# Codex (subscription)
codex login
dalang auth set codex --from ~/.codex/auth.json

# opencode
opencode auth login <provider>
dalang auth set opencode --from ~/.local/share/opencode/auth.json
```

Run `dalang auth status` to see which providers are configured.

These credentials are projected into worker containers in Phase 4. Phase 3
only ships the store and the projection primitives.
```

- [ ] **Step 3: Typecheck + commit**

```bash
bun run typecheck
git add packages/dalang/src/auth/index.ts packages/dalang/README.md
git commit -m "docs(dalang): document auth credential store and CLI"
```

---

## Task 7: Final verification

- [ ] **Step 1: Full typecheck**

Run: `bun run typecheck`
Expected: dalang exits 0 (papan errors pre-existing).

- [ ] **Step 2: Full auth tests**

Run: `bun test packages/dalang/tests/auth`
Expected: all tests pass.

- [ ] **Step 3: Whole-repo dalang test sweep**

Run: `bun test packages/dalang/tests`
Expected: same set of pre-existing failures as before (CLI cwd-related), no new failures introduced by Phase 3.

- [ ] **Step 4: Lint**

Run: `bunx oxlint packages/dalang/src/auth packages/dalang/tests/auth`
Expected: no errors.

---

## Phase 3 Done Criteria

- `FilesystemAuthStore` reads/writes per-provider credentials under `<dalang-config>/credentials/`. Files are mode `0600`.
- `prepareWorkerCredentials()` returns env + bind mounts + dispose for each of the three providers, including refresh writeback for codex/opencode.
- `dalang auth set/clear/status` works end-to-end.
- README documents the populate-from-host workflow.
- No dalang runner/orchestrator code is touched. Phase 4 wires the projector into the worker runner.

## Open Questions

1. **Refresh writeback race.** Two concurrent codex workers refresh the same parent token; one rotation invalidates the other. Last-writer-wins is documented in the spec. Phase 4 will surface this as a `sandbox_auth_refresh_conflict` runtime event when it bites.
2. **`dalang auth login <provider>` interactive flows.** Out of scope for Phase 3. The plan is to run the provider's interactive login inside a one-shot container with `HOME` / `CODEX_HOME` / `XDG_DATA_HOME` overridden, capture the resulting credential, and persist into dalang's store. Defer to a follow-up plan once Phase 4 has shaken out the container-launch ergonomics.
3. **Encryption at rest.** v1 stores credentials as plain files with mode `0600`. OS keyring integration (Secret Service / macOS Keychain / Windows Credential Manager) is a follow-up.

## Risks

- **`writeAtomic` portability.** The implementation uses a `<path>.tmp.<pid>.<ts>` sibling write + atomic rename pattern. Any cross-platform quirks (Windows file locking?) are not addressed in v1; dalang's primary platform is Linux/macOS.
- **`dispose()` failures.** If the worker container is killed mid-refresh, the per-worker tmpdir's `auth.json` may be partially written. The `dispose()` reads it as-is and writes back; a malformed JSON would clobber a previously-good store entry. Mitigation: `dispose()` could `JSON.parse` to validate before writing back, falling back to leaving the store unchanged. Phase 4 may add this guard once we see real failure modes.
- **Symlink attacks on the per-worker tmpdir.** `<sandboxesRoot>/<workerId>/` is owned by dalang's process; a symlink-style escape would require an attacker who can already write to that directory. Out of scope for the threat model (single-user host).

## Next Phase

- **Phase 4** — Runner refactor (`sdk-runner.ts` / `codex-runner.ts` / `opencode-runner.ts` become thin wrappers over `ContainerHost` + `bayang` shim + `prepareWorkerCredentials`), `sandbox:` config block in `WORKFLOW.md`, error classifications in `RuntimeEvent`, end-to-end devcontainer fixture.
