// packages/dalang/src/agent/transcript.ts
import { homedir } from "node:os";
import { join } from "node:path";

// Claude Code stores per-session transcripts at
// ~/.claude/projects/<slug>/<session_id>.jsonl, where <slug> is the absolute
// workspace path with `/` and `.` replaced by `-`. Returns null if the session
// id is missing or a placeholder.
export function transcriptPathFor(
  workspacePath: string,
  sessionId: string | null | undefined,
): string | null {
  if (!sessionId || sessionId === "?" || sessionId.startsWith("?")) return null;
  const slug = workspacePath.replace(/[/.]/g, "-");
  return join(homedir(), ".claude", "projects", slug, `${sessionId}.jsonl`);
}
