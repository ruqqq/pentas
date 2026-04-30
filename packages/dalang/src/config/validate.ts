// packages/dalang/src/config/validate.ts
import type { WorkflowFrontMatter } from "./schema";
import { resolveEnvValue } from "./env-resolver";

export type ValidationCode =
  | "unsupported_tracker_kind"
  | "missing_tracker_api_key"
  | "missing_claude_executable_path"
  | "missing_codex_executable_path"
  | "missing_opencode_executable_path"
  | "missing_repo_config"
  | "claude_auth_inactive"
  | "codex_auth_inactive"
  | "opencode_auth_inactive"
  | "opencode_provider_not_authed";

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
  } else if (cfg.agent_provider === "opencode") {
    if (!cfg.opencode || cfg.opencode.executable_path.trim().length === 0) {
      throw new ValidationError("missing_opencode_executable_path", "opencode.executable_path is required");
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

/**
 * Probes `codex` CLI auth state via `codex login status`. Resolves `null` on success,
 * error message on failure (binary missing, not logged in, etc.).
 */
export async function probeCodexAuth(executablePath: string): Promise<string | null> {
  const proc = Bun.spawn([executablePath, "login", "status"], { stdout: "pipe", stderr: "pipe" });
  const exitCode = await proc.exited;
  if (exitCode === 0) return null;
  // Surface stderr so the operator can see what's wrong without re-running the probe.
  const stderr = await new Response(proc.stderr).text();
  const stdout = await new Response(proc.stdout).text();
  const msg = stderr.trim() || stdout.trim() || `exit code ${exitCode}`;
  return `codex auth probe failed: ${msg}`;
}

/**
 * Probes opencode CLI by:
 *   1. Running `<bin> --version` (any non-zero → opencode_auth_inactive).
 *   2. Running `<bin> auth` and checking the provider prefix from `model`
 *      appears in stdout (JSON list or text). If absent → opencode_provider_not_authed.
 *
 * Returns null on success, or a human-readable error string on failure.
 */
export async function probeOpencodeAuth(executablePath: string, model: string): Promise<string | null> {
  const version = Bun.spawn([executablePath, "--version"], { stdout: "pipe", stderr: "pipe" });
  const versionExit = await version.exited;
  if (versionExit !== 0) {
    return `opencode probe failed: exit code ${versionExit}`;
  }
  const slash = model.indexOf("/");
  if (slash <= 0) {
    return `opencode probe failed: model "${model}" not in providerID/modelID form`;
  }
  const providerId = model.slice(0, slash);
  const auth = Bun.spawn([executablePath, "auth"], { stdout: "pipe", stderr: "pipe" });
  const authExit = await auth.exited;
  const stdout = await new Response(auth.stdout).text();
  if (authExit !== 0) {
    const stderr = await new Response(auth.stderr).text();
    return `opencode auth probe failed: ${(stderr.trim() || stdout.trim() || `exit code ${authExit}`)}`;
  }
  if (!stdout.includes(providerId)) {
    return `opencode auth probe: provider "${providerId}" not authenticated (run \`opencode auth login ${providerId}\`)`;
  }
  return null;
}
