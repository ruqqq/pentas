import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BindMount } from "../sandbox/types";
import type { AuthStore } from "./store";

export class AuthError extends Error {
  constructor(public readonly code: "auth_missing" | "auth_invalid", message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export type AuthProvider = "claude" | "codex" | "opencode";

export interface PrepareCredentialsOptions {
  store: AuthStore;
  provider: AuthProvider;
  /** Stable per-worker identifier; used as the per-worker tmpdir name. */
  workerId: string;
  /** Root directory under which per-worker tmpdirs are created. */
  sandboxesRoot: string;
}

export interface PreparedCredentials {
  /** Env vars to inject into the worker container. */
  env: Record<string, string>;
  /** Bind mounts to attach to the worker container. */
  bindMounts: BindMount[];
  /** Called after the worker exits. Writes back any refreshed credentials and removes tmpdirs. */
  dispose(): Promise<void>;
}

export async function prepareWorkerCredentials(
  opts: PrepareCredentialsOptions,
): Promise<PreparedCredentials> {
  switch (opts.provider) {
    case "claude":
      return prepareClaudeCredentials(opts);
    case "codex":
      return prepareCodexCredentials(opts);
    case "opencode":
      throw new AuthError(
        "auth_missing",
        "opencode credential projection not yet implemented (Task 4)",
      );
  }
}

async function prepareClaudeCredentials(
  opts: PrepareCredentialsOptions,
): Promise<PreparedCredentials> {
  const token = await opts.store.getClaudeToken();
  if (token === null || token.length === 0) {
    throw new AuthError(
      "auth_missing",
      "no claude token in store; run `dalang auth set claude --token <t>` first",
    );
  }
  return {
    env: { CLAUDE_CODE_OAUTH_TOKEN: token.trim() },
    bindMounts: [],
    dispose: async () => {
      // Nothing to clean up for env-only providers.
    },
  };
}

async function prepareCodexCredentials(
  opts: PrepareCredentialsOptions,
): Promise<PreparedCredentials> {
  const initial = await opts.store.getCodexAuthJson();
  if (initial === null) {
    throw new AuthError(
      "auth_missing",
      "no codex credentials in store; run `dalang auth set codex --from <auth.json>` first",
    );
  }
  const dir = await ensureWorkerSandboxDir(opts.sandboxesRoot, opts.workerId, "codex");
  const authPath = join(dir, "auth.json");
  await writeFile(authPath, initial, { mode: 0o600 });

  return {
    env: { CODEX_HOME: "/run/dalang/codex" },
    bindMounts: [
      {
        hostPath: dir,
        containerPath: "/run/dalang/codex",
        readOnly: false,
      },
    ],
    dispose: async () => {
      try {
        const final = await readFile(authPath, "utf8");
        if (final !== initial) {
          await opts.store.setCodexAuthJson(final);
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        // If the shim deleted auth.json, leave the store as-is.
      }
      await removeWorkerSandbox(opts.sandboxesRoot, opts.workerId);
    },
  };
}

/** Helper used by codex/opencode projections in later tasks. */
export async function ensureWorkerSandboxDir(
  sandboxesRoot: string,
  workerId: string,
  subPath: string,
): Promise<string> {
  const dir = join(sandboxesRoot, workerId, subPath);
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Helper used by codex/opencode projections to remove per-worker tmpdirs. */
export async function removeWorkerSandbox(
  sandboxesRoot: string,
  workerId: string,
): Promise<void> {
  const dir = join(sandboxesRoot, workerId);
  await rm(dir, { recursive: true, force: true });
}
