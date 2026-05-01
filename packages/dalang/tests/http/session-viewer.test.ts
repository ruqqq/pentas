import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseTranscriptLine, renderSessionViewerHtml } from "../../src/http/session-viewer";
import type { NormalizedIssue, RunningEntry } from "../../src/types";

test("parseTranscriptLine maps claude, codex, and opencode jsonl", () => {
  const claude = parseTranscriptLine(
    JSON.stringify({ type: "system", subtype: "init", session_id: "claude-1" }),
    1,
    "claude",
  );
  const codex = parseTranscriptLine(
    JSON.stringify({ type: "event_msg", payload: { type: "agent_message", message: "hello" } }),
    2,
    "codex",
  );
  const opencode = parseTranscriptLine(
    JSON.stringify({ type: "session.created", properties: { info: { id: "open-1" } } }),
    3,
    "opencode",
  );

  expect(claude.runtime_event?.event).toBe("session_started");
  expect(codex.raw_type).toBe("event_msg:agent_message");
  expect(codex.runtime_event?.event).toBe("notification");
  expect(opencode.runtime_event?.event).toBe("session_started");
});

test("renderSessionViewerHtml renders parsed transcript rows", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dalang-session-viewer-html-"));
  const transcriptPath = join(dir, "session.jsonl");
  writeFileSync(
    transcriptPath,
    `${JSON.stringify({ type: "session.created", properties: { info: { id: "s1" } } })}\n`,
  );

  const html = await renderSessionViewerHtml(runningEntry(transcriptPath));
  expect(html).toContain("APP-1");
  expect(html).toContain("opencode");
  expect(html).toContain("session.created");
  expect(html).toContain("/api/v1/sessions/i1/transcript");
});

function runningEntry(transcriptPath: string): RunningEntry {
  const issue: NormalizedIssue = {
    id: "i1",
    identifier: "APP-1",
    title: "Task",
    description: null,
    priority: null,
    state: "In Dev",
    branch_name: null,
    url: null,
    external_ref: null,
    internal_ref: null,
    labels: [],
    blocked_by: [],
    created_at: null,
    updated_at: null,
  };
  return {
    issue,
    identifier: issue.identifier,
    workspace_path: "/tmp/workspace",
    agent_provider: "opencode",
    started_at: new Date().toISOString(),
    abort_controller: new AbortController(),
    retry_attempt: null,
    session: {
      session_id: "s1",
      thread_id: "s1",
      turn_id: "t1",
      transcript_path: transcriptPath,
      claude_session_pid: null,
      last_event: "session_started",
      last_event_at: new Date().toISOString(),
      last_message: null,
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      last_reported_input_tokens: 0,
      last_reported_output_tokens: 0,
      last_reported_total_tokens: 0,
      turn_count: 1,
    },
  };
}
