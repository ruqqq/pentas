// packages/dalang/src/agent/sdk-runner.ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { RunQuery, RunQueryOptions } from "./agent-runner";

export const sdkRunQuery: RunQuery = (opts: RunQueryOptions) => {
  if (!opts.claude) {
    throw new Error("sdkRunQuery requires opts.claude (provider mismatch)");
  }
  return query({
    prompt: opts.prompt,
    options: {
      cwd: opts.cwd,
      model: opts.model,
      permissionMode: opts.claude.permissionMode,
      pathToClaudeCodeExecutable: opts.executablePath,
      resume: opts.resumeSessionId,
      abortController: opts.abortSignal ? abortSignalToController(opts.abortSignal) : undefined,
    },
  }) as AsyncIterable<unknown>;
};

function abortSignalToController(signal: AbortSignal): AbortController {
  const c = new AbortController();
  if (signal.aborted) c.abort();
  else signal.addEventListener("abort", () => c.abort(), { once: true });
  return c;
}
