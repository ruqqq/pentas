import { query } from "@anthropic-ai/claude-agent-sdk";
import { access } from "node:fs/promises";
import type { WorkerInvocation } from "./protocol";

function abortSignalToController(signal: AbortSignal): AbortController {
  const c = new AbortController();
  if (signal.aborted) c.abort();
  else signal.addEventListener("abort", () => c.abort(), { once: true });
  return c;
}

export async function* runClaude(
  inv: Extract<WorkerInvocation, { provider: "claude" }>,
  abortSignal: AbortSignal,
): AsyncGenerator<unknown> {
  // Same fail-fast as runCodex: surface a missing absolute binary as a
  // clear error before the SDK tries to spawn it.
  if (inv.executablePath.startsWith("/")) {
    try {
      await access(inv.executablePath);
    } catch {
      throw new Error(
        `claude binary not found at ${inv.executablePath} (configure providers.claude.executablePath in WORKFLOW.md sandbox block)`,
      );
    }
  }
  const iterable = query({
    prompt: inv.prompt,
    options: {
      cwd: inv.cwd,
      model: inv.model,
      permissionMode: inv.claude.permissionMode,
      pathToClaudeCodeExecutable: inv.executablePath,
      resume: inv.resumeSessionId,
      abortController: abortSignalToController(abortSignal),
    },
  }) as AsyncIterable<unknown>;
  for await (const ev of iterable) {
    yield ev;
  }
}
