// packages/dalang/tests/config/validate.test.ts
import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyDefaults } from "../../src/config/schema";
import { validateForDispatch, ValidationError, probeCodexAuth, probeOpencodeAuth } from "../../src/config/validate";

function makeFakeBin(script: string): string {
  const dir = mkdtempSync(join(tmpdir(), "opencode-bin-"));
  const path = join(dir, "opencode");
  writeFileSync(path, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  chmodSync(path, 0o755);
  return path;
}

const baseConfig = () => applyDefaults({
  tracker: { endpoint: "http://localhost:3001", active_states: ["Todo"], terminal_states: ["Done"] },
  workspace: { root: "/tmp/dalang" },
});

test("accepts a complete valid config", () => {
  const cfg = baseConfig();
  cfg.tracker.api_key = null;
  expect(() => validateForDispatch(cfg)).not.toThrow();
});

test("rejects when $VAR api_key is unresolved", () => {
  const cfg = baseConfig();
  cfg.tracker.api_key = "$NEVER_DEFINED_KEY_XYZ";
  delete process.env.NEVER_DEFINED_KEY_XYZ;
  expect(() => validateForDispatch(cfg)).toThrow(ValidationError);
});

test("accepts when $VAR api_key resolves", () => {
  const cfg = baseConfig();
  cfg.tracker.api_key = "$EXISTS_KEY_XYZ";
  process.env.EXISTS_KEY_XYZ = "abc";
  expect(() => validateForDispatch(cfg)).not.toThrow();
  delete process.env.EXISTS_KEY_XYZ;
});

test("rejects empty claude.executable_path", () => {
  const cfg = baseConfig();
  cfg.claude!.executable_path = "";
  expect(() => validateForDispatch(cfg)).toThrow(/executable_path/);
});

test("validateForDispatch with codex provider rejects empty executable_path", () => {
  const cfg = applyDefaults({ agent_provider: "codex" });
  cfg.codex!.executable_path = "";
  expect(() => validateForDispatch(cfg)).toThrow(ValidationError);
  try {
    validateForDispatch(cfg);
  } catch (e) {
    expect((e as ValidationError).code).toBe("missing_codex_executable_path");
  }
});

test("validateForDispatch with claude provider does not require codex block fields", () => {
  const cfg = applyDefaults({});
  expect(cfg.agent_provider).toBe("claude");
  // The inactive codex block is omitted entirely; validation must still pass.
  expect(cfg.codex).toBeUndefined();
  expect(() => validateForDispatch(cfg)).not.toThrow();
});

test("probeCodexAuth resolves null on success", async () => {
  const result = await probeCodexAuth("/usr/bin/true");
  expect(result).toBeNull();
});

test("probeCodexAuth resolves a message on failure", async () => {
  const result = await probeCodexAuth("/usr/bin/false");
  expect(typeof result).toBe("string");
  expect(result).toMatch(/codex/i);
});

test("probeOpencodeAuth returns null when version OK and provider is in auth list", async () => {
  const bin = makeFakeBin(`
case "$1" in
  --version) echo "opencode 1.0.0"; exit 0;;
  auth)      echo '[{"provider":"anthropic"}]'; exit 0;;
esac
exit 0
`);
  const err = await probeOpencodeAuth(bin, "anthropic/claude-sonnet-4-6");
  expect(err).toBeNull();
});

test("probeOpencodeAuth returns error when --version exits non-zero", async () => {
  const bin = makeFakeBin(`exit 1`);
  const err = await probeOpencodeAuth(bin, "anthropic/foo");
  expect(err).not.toBeNull();
  expect(err).toContain("opencode probe");
});

test("probeOpencodeAuth returns error when provider missing from auth list", async () => {
  const bin = makeFakeBin(`
case "$1" in
  --version) echo "opencode 1.0.0"; exit 0;;
  auth)      echo '[{"provider":"openai"}]'; exit 0;;
esac
exit 0
`);
  const err = await probeOpencodeAuth(bin, "anthropic/claude-sonnet-4-6");
  expect(err).not.toBeNull();
  expect(err).toContain("anthropic");
});

test("validateForDispatch fails when agent_provider=opencode but block missing", () => {
  const cfg = applyDefaults({ agent_provider: "opencode" });
  delete (cfg as Record<string, unknown>).opencode;
  expect(() => validateForDispatch(cfg)).toThrow(ValidationError);
});
