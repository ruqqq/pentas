// packages/dalang/tests/config/validate.test.ts
import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { applyDefaults } from "../../src/config/schema";
import {
  validateForDispatch,
  ValidationError,
  probeCodexAuth,
  probeOpencodeAuth,
} from "../../src/config/validate";

function makeFakeBin(script: string): string {
  const dir = mkdtempSync(join(tmpdir(), "opencode-bin-"));
  const path = join(dir, "opencode");
  writeFileSync(path, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  chmodSync(path, 0o755);
  return path;
}

function prependFakeGh(script: string): void {
  const dir = mkdtempSync(join(tmpdir(), "gh-bin-"));
  const path = join(dir, "gh");
  writeFileSync(path, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  chmodSync(path, 0o755);
  process.env.PATH = `${dir}${delimiter}${process.env.PATH ?? ""}`;
}

const baseConfig = () =>
  applyDefaults({
    tracker: {
      endpoint: "http://localhost:3001",
      active_states: ["Todo"],
      terminal_states: ["Done"],
    },
    workspace: { root: "/tmp/dalang" },
  });

test("accepts a complete valid config", () => {
  const cfg = baseConfig();
  cfg.tracker.api_key = null;
  expect(() => validateForDispatch(cfg)).not.toThrow();
});

test("rejects when control_plane $VAR api_key is unresolved", () => {
  const cfg = applyDefaults({
    control_plane: {
      kind: "papan",
      endpoint: "http://localhost:3001",
      api_key: "$NEVER_DEFINED_KEY_XYZ",
      active_states: ["Todo"],
      terminal_states: ["Done"],
      ownership: { mode: "none" },
    },
  });
  delete process.env.NEVER_DEFINED_KEY_XYZ;
  expect(() => validateForDispatch(cfg)).toThrow(ValidationError);
  try {
    validateForDispatch(cfg);
  } catch (err) {
    expect((err as ValidationError).code).toBe("missing_control_plane_api_key");
  }
});

test("accepts when control_plane $VAR api_key resolves", () => {
  const cfg = baseConfig();
  if (cfg.control_plane.kind !== "papan") throw new Error("expected papan control plane");
  cfg.control_plane.api_key = "$EXISTS_KEY_XYZ";
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

test("rejects github-projects control plane without ownership", () => {
  const cfg = applyDefaults({
    control_plane: {
      kind: "github-projects",
      owner_type: "organization",
      owner: "acme",
      project_number: 1,
      repository: "acme/app",
      token: "literal-token",
      status_field: "Status",
      active_states: ["Todo"],
      terminal_states: ["Done"],
      ownership: { mode: "none" },
    },
  });
  expect(() => validateForDispatch(cfg)).toThrow(/ownership/i);
});

test("allows explicit unowned github-projects dispatch", () => {
  const cfg = applyDefaults({
    control_plane: {
      kind: "github-projects",
      owner_type: "organization",
      owner: "acme",
      project_number: 1,
      repository: "acme/app",
      token: "literal-token",
      status_field: "Status",
      active_states: ["Todo"],
      terminal_states: ["Done"],
      ownership: { mode: "none", allow_unowned_dispatch: true },
    },
  });
  expect(() => validateForDispatch(cfg)).not.toThrow();
});

test("allows github-projects control plane with omitted token when GITHUB_TOKEN is set", () => {
  process.env.GITHUB_TOKEN = "env-token";
  const cfg = applyDefaults({
    control_plane: {
      kind: "github-projects",
      owner_type: "organization",
      owner: "acme",
      project_number: 1,
      repository: "acme/app",
      status_field: "Status",
      active_states: ["Todo"],
      terminal_states: ["Done"],
      ownership: { mode: "label", value: "dalang" },
    },
  });

  expect(() => validateForDispatch(cfg)).not.toThrow();
  delete process.env.GITHUB_TOKEN;
});

test("allows github-projects control plane with omitted token when gh auth token works", () => {
  delete process.env.GITHUB_TOKEN;
  prependFakeGh(`
if [ "$1" = auth ] && [ "$2" = token ]; then
  echo gh-token
  exit 0
fi
exit 1
`);
  const cfg = applyDefaults({
    control_plane: {
      kind: "github-projects",
      owner_type: "organization",
      owner: "acme",
      project_number: 1,
      repository: "acme/app",
      status_field: "Status",
      active_states: ["Todo"],
      terminal_states: ["Done"],
      ownership: { mode: "label", value: "dalang" },
    },
  });

  expect(() => validateForDispatch(cfg)).not.toThrow();
});

test("rejects github-projects control plane when no token source exists", () => {
  delete process.env.GITHUB_TOKEN;
  prependFakeGh("exit 1");
  const cfg = applyDefaults({
    control_plane: {
      kind: "github-projects",
      owner_type: "organization",
      owner: "acme",
      project_number: 1,
      repository: "acme/app",
      status_field: "Status",
      active_states: ["Todo"],
      terminal_states: ["Done"],
      ownership: { mode: "label", value: "dalang" },
    },
  });

  expect(() => validateForDispatch(cfg)).toThrow(ValidationError);
  try {
    validateForDispatch(cfg);
  } catch (err) {
    expect((err as ValidationError).code).toBe("missing_control_plane_api_key");
  }
});

test("rejects github-projects control plane when token env var is missing", () => {
  prependFakeGh("exit 1");
  const cfg = applyDefaults({
    control_plane: {
      kind: "github-projects",
      owner_type: "organization",
      owner: "acme",
      project_number: 1,
      repository: "acme/app",
      token: "$MISSING_GITHUB_TOKEN_FOR_TEST",
      status_field: "Status",
      active_states: ["Todo"],
      terminal_states: ["Done"],
      ownership: { mode: "label", value: "dalang" },
    },
  });
  delete process.env.MISSING_GITHUB_TOKEN_FOR_TEST;

  expect(() => validateForDispatch(cfg)).toThrow(ValidationError);
  try {
    validateForDispatch(cfg);
  } catch (err) {
    expect((err as ValidationError).code).toBe("missing_control_plane_api_key");
  }
});

test("rejects explicit legacy tracker api_key when env var is missing", () => {
  const cfg = applyDefaults({
    control_plane: {
      kind: "papan",
      endpoint: "http://localhost:3001",
      api_key: null,
      active_states: ["Todo"],
      terminal_states: ["Done"],
      ownership: { mode: "none" },
    },
    tracker: {
      kind: "papan",
      endpoint: "http://localhost:3001",
      api_key: "$MISSING_TRACKER_TOKEN_FOR_TEST",
      active_states: ["Todo"],
      terminal_states: ["Done"],
    },
  });
  delete process.env.MISSING_TRACKER_TOKEN_FOR_TEST;

  expect(() => validateForDispatch(cfg)).toThrow(ValidationError);
  try {
    validateForDispatch(cfg);
  } catch (err) {
    expect((err as ValidationError).code).toBe("missing_tracker_api_key");
  }
});

test("rejects matching mixed papan api_key env var with legacy tracker error code", () => {
  const cfg = applyDefaults({
    control_plane: {
      kind: "papan",
      endpoint: "http://localhost:3001",
      api_key: "$MISSING_SHARED_TRACKER_TOKEN_FOR_TEST",
      active_states: ["Todo"],
      terminal_states: ["Done"],
      ownership: { mode: "none" },
    },
    tracker: {
      kind: "papan",
      endpoint: "http://localhost:3001",
      api_key: "$MISSING_SHARED_TRACKER_TOKEN_FOR_TEST",
      active_states: ["Todo"],
      terminal_states: ["Done"],
    },
  });
  delete process.env.MISSING_SHARED_TRACKER_TOKEN_FOR_TEST;

  expect(() => validateForDispatch(cfg)).toThrow(ValidationError);
  try {
    validateForDispatch(cfg);
  } catch (err) {
    expect((err as ValidationError).code).toBe("missing_tracker_api_key");
  }
});

test("rejects tracker-only legacy api_key with legacy error code when env var is missing", () => {
  const cfg = applyDefaults({
    tracker: {
      kind: "papan",
      endpoint: "http://localhost:3001",
      api_key: "$MISSING_LEGACY_TRACKER_TOKEN_FOR_TEST",
      active_states: ["Todo"],
      terminal_states: ["Done"],
    },
  });
  delete process.env.MISSING_LEGACY_TRACKER_TOKEN_FOR_TEST;

  expect(() => validateForDispatch(cfg)).toThrow(ValidationError);
  try {
    validateForDispatch(cfg);
  } catch (err) {
    expect((err as ValidationError).code).toBe("missing_tracker_api_key");
  }
});

test("rejects divergent mixed papan control_plane and tracker config", () => {
  const cfg = applyDefaults({
    control_plane: {
      kind: "papan",
      endpoint: "http://localhost:3001",
      api_key: "same-key",
      board: "main",
      active_states: ["Todo", "In Dev"],
      terminal_states: ["Done"],
      ownership: { mode: "none" },
    },
    tracker: {
      kind: "papan",
      endpoint: "http://localhost:3002",
      api_key: "same-key",
      board: "main",
      active_states: ["Todo", "In Dev"],
      terminal_states: ["Done"],
    },
  });

  expect(() => validateForDispatch(cfg)).toThrow(ValidationError);
  try {
    validateForDispatch(cfg);
  } catch (err) {
    expect((err as ValidationError).code).toBe("conflicting_control_plane_tracker_config");
  }
});

test("rejects divergent mixed config even if raw input spoofs internal alias marker", () => {
  const cfg = applyDefaults({
    __control_plane_from_tracker: true,
    control_plane: {
      kind: "papan",
      endpoint: "http://localhost:3001",
      api_key: "same-key",
      board: "main",
      active_states: ["Todo"],
      terminal_states: ["Done"],
      ownership: { mode: "none" },
    },
    tracker: {
      kind: "papan",
      endpoint: "http://localhost:3002",
      api_key: "same-key",
      board: "main",
      active_states: ["Todo"],
      terminal_states: ["Done"],
    },
  });

  expect(() => validateForDispatch(cfg)).toThrow(ValidationError);
  try {
    validateForDispatch(cfg);
  } catch (err) {
    expect((err as ValidationError).code).toBe("conflicting_control_plane_tracker_config");
  }
});

test("raw internal alias marker cannot suppress explicit tracker api_key validation", () => {
  const cfg = applyDefaults({
    __tracker_from_control_plane: true,
    control_plane: {
      kind: "papan",
      endpoint: "http://localhost:3001",
      api_key: null,
      active_states: ["Todo"],
      terminal_states: ["Done"],
      ownership: { mode: "none" },
    },
    tracker: {
      kind: "papan",
      endpoint: "http://localhost:3001",
      api_key: "$MISSING_SPOOFED_TRACKER_TOKEN_FOR_TEST",
      active_states: ["Todo"],
      terminal_states: ["Done"],
    },
  });
  delete process.env.MISSING_SPOOFED_TRACKER_TOKEN_FOR_TEST;

  expect(() => validateForDispatch(cfg)).toThrow(ValidationError);
  try {
    validateForDispatch(cfg);
  } catch (err) {
    expect((err as ValidationError).code).toBe("missing_tracker_api_key");
  }
});

test("control_plane alias provenance survives object spread cloning", () => {
  const cfg = {
    ...applyDefaults({
      control_plane: {
        kind: "papan",
        endpoint: "http://localhost:3001",
        api_key: "$MISSING_SPREAD_CONTROL_PLANE_TOKEN_FOR_TEST",
        active_states: ["Todo"],
        terminal_states: ["Done"],
        ownership: { mode: "none" },
      },
    }),
  };
  delete process.env.MISSING_SPREAD_CONTROL_PLANE_TOKEN_FOR_TEST;

  expect(() => validateForDispatch(cfg)).toThrow(ValidationError);
  try {
    validateForDispatch(cfg);
  } catch (err) {
    expect((err as ValidationError).code).toBe("missing_control_plane_api_key");
  }
});

test("accepts matching mixed papan control_plane and tracker config", () => {
  const cfg = applyDefaults({
    control_plane: {
      kind: "papan",
      endpoint: "http://localhost:3001",
      api_key: "same-key",
      board: "main",
      active_states: ["Todo", "In Dev"],
      terminal_states: ["Done"],
      ownership: { mode: "none" },
    },
    tracker: {
      kind: "papan",
      endpoint: "http://localhost:3001",
      api_key: "same-key",
      board: "main",
      active_states: ["Todo", "In Dev"],
      terminal_states: ["Done"],
    },
  });

  expect(() => validateForDispatch(cfg)).not.toThrow();
});

test("accepts matching mixed papan config when both sides rely on default states", () => {
  const cfg = applyDefaults({
    control_plane: {
      kind: "papan",
      endpoint: "http://localhost:3001",
      ownership: { mode: "none" },
    },
    tracker: {
      kind: "papan",
      endpoint: "http://localhost:3001",
    },
  });

  expect(() => validateForDispatch(cfg)).not.toThrow();
});
