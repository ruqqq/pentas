// packages/dalang/src/config/env-resolver.ts
const VAR_RE = /^\$([A-Za-z_][A-Za-z0-9_]*)$/;
const VAR_INLINE_RE = /\$([A-Za-z_][A-Za-z0-9_]*)/g;

export function resolveEnvValue(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const m = value.match(VAR_RE);
  if (!m) return value;
  const got = process.env[m[1]!];
  if (got === undefined || got === "") return null;
  return got;
}

export function resolveTrackerApiKey(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.startsWith("$")) return resolveEnvValue(value);
  return value;
}

export function resolveGithubToken(value: string | null | undefined): string | null {
  if (value !== null && value !== undefined) {
    if (value.startsWith("$")) return resolveEnvValue(value);
    return value;
  }
  const envToken = process.env.GITHUB_TOKEN;
  if (envToken !== undefined && envToken !== "") return envToken;
  return readGhAuthToken();
}

export function expandPath(input: string): string {
  let out = input;
  if (out.startsWith("~/") || out === "~") {
    const home = process.env.HOME ?? "";
    out = out === "~" ? home : home + out.slice(1);
  }
  out = out.replace(VAR_INLINE_RE, (_match, name: string) => process.env[name] ?? "");
  return out;
}

function readGhAuthToken(): string | null {
  try {
    const proc = Bun.spawnSync(["gh", "auth", "token"], {
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });
    if (proc.exitCode !== 0) return null;
    const token = new TextDecoder().decode(proc.stdout).trim();
    return token.length > 0 ? token : null;
  } catch {
    return null;
  }
}
