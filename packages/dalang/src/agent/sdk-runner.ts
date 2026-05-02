// packages/dalang/src/agent/sdk-runner.ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { RunQuery, RunQueryOptions } from "./agent-runner";
export { buildClaudeQueryOptions } from "./claude-options";
import { buildClaudeQueryOptions } from "./claude-options";

export const sdkRunQuery: RunQuery = (opts: RunQueryOptions) => {
  if (!opts.claude) {
    throw new Error("sdkRunQuery requires opts.claude (provider mismatch)");
  }
  return query(
    buildClaudeQueryOptions(
      opts,
      opts.abortSignal ? abortSignalToController(opts.abortSignal) : undefined,
    ),
  ) as AsyncIterable<unknown>;
};

function abortSignalToController(signal: AbortSignal): AbortController {
  const c = new AbortController();
  if (signal.aborted) c.abort();
  else signal.addEventListener("abort", () => c.abort(), { once: true });
  return c;
}
