import { Codex } from "@openai/codex-sdk";
import { access } from "node:fs/promises";
import type { WorkerInvocation } from "./protocol";

export async function* runCodex(
  inv: Extract<WorkerInvocation, { provider: "codex" }>,
  abortSignal: AbortSignal,
): AsyncGenerator<unknown> {
  // Fail fast if an absolute codex binary path is missing. The SDK's spawn
  // failure path is unreliable (silent retry / hang on ENOENT in some
  // runtimes), and surfacing this as a clear error here lets dalang's
  // sandbox_exec_disconnected event carry the right diagnostic. Bare names
  // (e.g. "codex") are deferred to the OS PATH lookup at spawn time.
  if (inv.executablePath.startsWith("/")) {
    try {
      await access(inv.executablePath);
    } catch {
      throw new Error(
        `codex binary not found at ${inv.executablePath} (configure providers.codex.executablePath in WORKFLOW.md sandbox block)`,
      );
    }
  }
  const codex = new Codex({
    codexPathOverride: inv.executablePath,
    ...(inv.codex.env ? { env: inv.codex.env } : {}),
  });
  const threadOptions = {
    workingDirectory: inv.cwd,
    model: inv.model,
    sandboxMode: inv.codex.sandboxMode,
    approvalPolicy: inv.codex.approvalPolicy,
    networkAccessEnabled: inv.codex.networkAccessEnabled,
  };
  const thread = inv.resumeSessionId
    ? codex.resumeThread(inv.resumeSessionId, threadOptions)
    : codex.startThread(threadOptions);

  const streamed = await thread.runStreamed(inv.prompt, { signal: abortSignal });
  for await (const ev of streamed.events) {
    yield ev;
  }
}
