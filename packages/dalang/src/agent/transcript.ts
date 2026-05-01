// packages/dalang/src/agent/transcript.ts
import { homedir } from "node:os";
import { readdirSync } from "node:fs";
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
  const codexPath = codexTranscriptPathFor(sessionId);
  if (codexPath) return codexPath;
  const slug = workspacePath.replace(/[/.]/g, "-");
  return join(homedir(), ".claude", "projects", slug, `${sessionId}.jsonl`);
}

function codexTranscriptPathFor(sessionId: string): string | null {
  const root = join(homedir(), ".codex", "sessions");
  const wanted = `${sessionId}.jsonl`;
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) stack.push(path);
      else if (entry.isFile() && entry.name.endsWith(wanted)) return path;
    }
  }
  return null;
}
