// packages/dalang/src/agent/codex-runner.ts
import { Codex } from "@openai/codex-sdk";
import type { RunQuery, RunQueryOptions } from "./agent-runner";

export const codexRunQuery: RunQuery = (opts: RunQueryOptions) => {
  if (!opts.codex) {
    throw new Error("codexRunQuery requires opts.codex (provider mismatch)");
  }

  const codex = new Codex({ codexPathOverride: opts.executablePath });

  const threadOptions = {
    workingDirectory: opts.cwd,
    model: opts.model,
    sandboxMode: opts.codex.sandboxMode,
    approvalPolicy: opts.codex.approvalPolicy,
  };

  const thread = opts.resumeSessionId
    ? codex.resumeThread(opts.resumeSessionId, threadOptions)
    : codex.startThread(threadOptions);

  // `runStreamed` is async and returns `{ events: AsyncGenerator<ThreadEvent> }`.
  // Wrap in an async generator so this function can return a synchronous
  // AsyncIterable, matching the `RunQuery` contract used by the orchestrator.
  async function* iterate(): AsyncGenerator<unknown> {
    const turnOptions = opts.abortSignal ? { signal: opts.abortSignal } : {};
    const streamed = await thread.runStreamed(opts.prompt, turnOptions);
    for await (const event of streamed.events) {
      yield event;
    }
  }

  return iterate();
};
