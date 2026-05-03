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
