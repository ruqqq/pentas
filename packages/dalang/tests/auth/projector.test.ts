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

test("codex projection disables built-in apps feature in sandbox config", async () => {
  const store = await newStore();
  await store.setCodexAuthJson('{"access_token":"v1"}');
  const sandboxesRoot = await realpath(await mkdtemp(join(tmpdir(), "sandboxes-")));

  const proj = await prepareWorkerCredentials({
    store,
    provider: "codex",
    workerId: "w-codex-config",
    sandboxesRoot,
  });

  const config = await readFile(
    join(proj.bindMounts[0]?.hostPath as string, "config.toml"),
    "utf8",
  );
  expect(config).toContain("[features]");
  expect(config).toContain("apps = false");

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
  const mounted = await readFile(join(mount?.hostPath as string, "opencode", "auth.json"), "utf8");
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
