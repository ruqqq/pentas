import { query } from "@anthropic-ai/claude-agent-sdk";
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
