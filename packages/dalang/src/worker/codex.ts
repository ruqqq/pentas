import { Codex } from "@openai/codex-sdk";
import { access } from "node:fs/promises";
import { buildCodexChildEnv } from "../agent/codex-env";
import { setupGitIdentity, setupGithubGitAuth } from "./github-git-auth";
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
  const env = buildCodexChildEnv(inv.codex.env, { preserveProcessKeys: ["CODEX_HOME"] });
  await setupGitIdentity(inv.codex.git, env);
  await setupGithubGitAuth(env);

  const codex = new Codex({
    codexPathOverride: inv.executablePath,
    env,
  });
  type CodexThreadOptions = Parameters<Codex["startThread"]>[0] & {
    modelReasoningEffort?: typeof inv.codex.modelReasoningEffort;
  };
  const threadOptions: CodexThreadOptions = {
    workingDirectory: inv.cwd,
    model: inv.model,
    sandboxMode: inv.codex.sandboxMode,
    approvalPolicy: inv.codex.approvalPolicy,
    networkAccessEnabled: inv.codex.networkAccessEnabled,
    ...(inv.codex.modelReasoningEffort
      ? { modelReasoningEffort: inv.codex.modelReasoningEffort }
      : {}),
  };
  const thread = inv.resumeSessionId
    ? codex.resumeThread(inv.resumeSessionId, threadOptions)
    : codex.startThread(threadOptions);

  const streamed = await thread.runStreamed(inv.prompt, { signal: abortSignal });
  for await (const ev of streamed.events) {
    yield ev;
  }
}
