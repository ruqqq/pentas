// packages/dalang/src/config/validate.ts
import type { WorkflowFrontMatter } from "./schema";
import { resolveEnvValue } from "./env-resolver";

export type ValidationCode =
  | "unsupported_tracker_kind"
  | "missing_tracker_api_key"
  | "missing_claude_executable_path"
  | "missing_codex_executable_path"
  | "missing_repo_config"
  | "claude_auth_inactive"
  | "codex_auth_inactive";

export class ValidationError extends Error {
  code: ValidationCode;
  constructor(code: ValidationCode, message: string) {
    super(message);
    this.code = code;
  }
}

export function validateForDispatch(cfg: WorkflowFrontMatter): void {
  if (cfg.tracker.kind !== "tok-juara") {
    throw new ValidationError("unsupported_tracker_kind", `unsupported tracker kind: ${cfg.tracker.kind}`);
  }
  if (cfg.tracker.api_key !== null && cfg.tracker.api_key !== undefined) {
    const resolved = resolveEnvValue(cfg.tracker.api_key);
    if (resolved === null && cfg.tracker.api_key.startsWith("$")) {
      throw new ValidationError("missing_tracker_api_key", `tracker.api_key resolves to empty: ${cfg.tracker.api_key}`);
    }
  }
  if (cfg.agent_provider === "claude") {
    if (!cfg.claude || cfg.claude.executable_path.trim().length === 0) {
      throw new ValidationError("missing_claude_executable_path", "claude.executable_path is required");
    }
  } else if (cfg.agent_provider === "codex") {
    if (!cfg.codex || cfg.codex.executable_path.trim().length === 0) {
      throw new ValidationError("missing_codex_executable_path", "codex.executable_path is required");
    }
  }
}

/** Probes `claude` CLI subscription status. Resolves `null` on success, error message on failure. */
export async function probeClaudeAuth(executablePath: string): Promise<string | null> {
  const proc = Bun.spawn([executablePath, "--version"], { stdout: "pipe", stderr: "pipe" });
  const exitCode = await proc.exited;
  if (exitCode === 0) return null;
  return `claude probe exited with code ${exitCode}`;
}

/** Probes `codex` CLI availability. Resolves `null` on success, error message on failure. */
export async function probeCodexAuth(executablePath: string): Promise<string | null> {
  const proc = Bun.spawn([executablePath, "--version"], { stdout: "pipe", stderr: "pipe" });
  const exitCode = await proc.exited;
  if (exitCode === 0) return null;
  return `codex probe exited with code ${exitCode}`;
}
