import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, relative } from "node:path";
import { codexTranscriptPathFor, transcriptPathFor } from "../../src/agent/transcript";

test("codexTranscriptPathFor finds Codex session jsonl when present", () => {
  const sessionId = "dalang-transcript-test";
  const root = mkdtempSync(join(tmpdir(), "dalang-codex-sessions-"));
  const dir = join(root, "2099", "01", "01");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `rollout-2099-01-01T00-00-00-${sessionId}.jsonl`);
  writeFileSync(path, "{}\n");

  expect(codexTranscriptPathFor(sessionId, root)).toBe(path);
});

test("transcriptPathFor falls back to Claude session path", () => {
  const workspace = mkdtempSync(join(tmpdir(), "dalang-transcript-"));
  const path = transcriptPathFor(workspace, "missing-session");

  expect(path).not.toBeNull();
  expect(relative(homedir(), path!)).toStartWith(".claude/");
  expect(path).toEndWith("missing-session.jsonl");
});

test("transcriptPathFor returns null for opencode until a locator exists", () => {
  expect(transcriptPathFor("/tmp/workspace", "opencode-session", "opencode")).toBeNull();
});
