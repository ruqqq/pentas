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
