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
