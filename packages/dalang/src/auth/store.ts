import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface AuthStore {
  getClaudeToken(): Promise<string | null>;
  setClaudeToken(token: string): Promise<void>;
  clearClaudeToken(): Promise<void>;

  getCodexAuthJson(): Promise<string | null>;
  setCodexAuthJson(raw: string): Promise<void>;
  clearCodexAuthJson(): Promise<void>;

  getOpencodeAuthJson(): Promise<string | null>;
  setOpencodeAuthJson(raw: string): Promise<void>;
  clearOpencodeAuthJson(): Promise<void>;
}

async function readOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function writeAtomic(path: string, content: string, mode: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmp, content, { mode });
  await rename(tmp, path);
}

async function removeIfExists(path: string): Promise<void> {
  try {
    await rm(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

export class FilesystemAuthStore implements AuthStore {
  constructor(public readonly root: string) {}

  claudeTokenPath(): string {
    return join(this.root, "claude_oauth_token");
  }

  codexAuthJsonPath(): string {
    return join(this.root, "codex", "auth.json");
  }

  opencodeAuthJsonPath(): string {
    return join(this.root, "opencode", "auth.json");
  }

  getClaudeToken(): Promise<string | null> {
    return readOrNull(this.claudeTokenPath());
  }

  async setClaudeToken(token: string): Promise<void> {
    await writeAtomic(this.claudeTokenPath(), token, 0o600);
  }

  clearClaudeToken(): Promise<void> {
    return removeIfExists(this.claudeTokenPath());
  }

  getCodexAuthJson(): Promise<string | null> {
    return readOrNull(this.codexAuthJsonPath());
  }

  async setCodexAuthJson(raw: string): Promise<void> {
    await writeAtomic(this.codexAuthJsonPath(), raw, 0o600);
  }

  clearCodexAuthJson(): Promise<void> {
    return removeIfExists(this.codexAuthJsonPath());
  }

  getOpencodeAuthJson(): Promise<string | null> {
    return readOrNull(this.opencodeAuthJsonPath());
  }

  async setOpencodeAuthJson(raw: string): Promise<void> {
    await writeAtomic(this.opencodeAuthJsonPath(), raw, 0o600);
  }

  clearOpencodeAuthJson(): Promise<void> {
    return removeIfExists(this.opencodeAuthJsonPath());
  }
}

/** Default store root: $DALANG_CONFIG_HOME/credentials, else ~/.config/dalang/credentials. */
export function defaultStoreRoot(env: NodeJS.ProcessEnv = process.env): string {
  if (typeof env["DALANG_CONFIG_HOME"] === "string" && env["DALANG_CONFIG_HOME"].length > 0) {
    return join(env["DALANG_CONFIG_HOME"], "credentials");
  }
  const home = env["HOME"] ?? "";
  return join(home, ".config", "dalang", "credentials");
}
