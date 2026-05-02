import { Codex } from "@openai/codex-sdk";
import type { WorkerInvocation } from "./protocol";

export async function* runCodex(
  inv: Extract<WorkerInvocation, { provider: "codex" }>,
  abortSignal: AbortSignal,
): AsyncGenerator<unknown> {
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
