import { resolve } from "node:path";
import { prepareWorkerCredentials, type AuthProvider } from "../auth/projector";
import type { AuthStore } from "../auth/store";
import type { SandboxConfig } from "../config/sandbox-schema";
import { resolveImage } from "./image-source";
import type { BindMount, ContainerHost, ContainerHandle } from "./types";

export interface SandboxDoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface SandboxDoctorResult {
  ok: boolean;
  checks: SandboxDoctorCheck[];
}

export interface SandboxDoctorOptions {
  host: ContainerHost;
  store: AuthStore;
  sandboxesRoot: string;
  repoDir: string;
  workspaceDir: string;
  config: SandboxConfig;
  provider: AuthProvider;
  requiredTools?: string[];
  githubToken?: string;
}

const DALANG_COMPOSE_WORKSPACE = "/run/dalang/workspace";

function providerExecutable(config: SandboxConfig, provider: AuthProvider): string {
  switch (provider) {
    case "claude":
      return config.providers.claude.executablePath;
    case "codex":
      return config.providers.codex.executablePath;
    case "opencode":
      return config.providers.opencode.executablePath;
  }
}

function credentialProbe(provider: AuthProvider): string {
  switch (provider) {
    case "claude":
      return 'test -n "$CLAUDE_CODE_OAUTH_TOKEN"';
    case "codex":
      return 'test -n "$CODEX_HOME" && test -r "$CODEX_HOME/auth.json" && test -w "$CODEX_HOME/auth.json"';
    case "opencode":
      return 'test -n "$XDG_DATA_HOME" && test -r "$XDG_DATA_HOME/opencode/auth.json" && test -w "$XDG_DATA_HOME/opencode/auth.json"';
  }
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

async function collect(iter: AsyncIterable<string>): Promise<string> {
  const lines: string[] = [];
  for await (const line of iter) lines.push(line);
  return lines.join("\n");
}

async function execCheck(
  handle: ContainerHandle,
  opts: { name: string; script: string; cwd?: string; env?: Record<string, string> },
): Promise<SandboxDoctorCheck> {
  const result = await handle.exec({
    cmd: ["sh", "-lc", opts.script],
    cwd: opts.cwd,
    env: opts.env,
  });
  const [stdout, stderr, status] = await Promise.all([
    collect(result.stdout),
    collect(result.stderr),
    result.done,
  ]);
  const detail = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
  return {
    name: opts.name,
    ok: status.exitCode === 0,
    detail: detail || `exit ${status.exitCode}`,
  };
}

function mergeEnv(
  base: Record<string, string>,
  extra: Record<string, string | undefined>,
): Record<string, string> {
  const out = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export async function runSandboxDoctor(opts: SandboxDoctorOptions): Promise<SandboxDoctorResult> {
  const image = await resolveImage(opts.config.image, opts.repoDir);
  const containerCwd = image.kind === "compose" ? DALANG_COMPOSE_WORKSPACE : image.workspaceFolder;
  const workerId = `dalang-doctor-${process.pid}-${Date.now()}`;
  const creds = await prepareWorkerCredentials({
    store: opts.store,
    provider: opts.provider,
    workerId,
    sandboxesRoot: opts.sandboxesRoot,
  });
  let handle: ContainerHandle | null = null;
  try {
    const bindMounts: BindMount[] = [
      { hostPath: opts.workspaceDir, containerPath: containerCwd, readOnly: false },
      ...creds.bindMounts,
    ];
    handle = await opts.host.start({
      name: workerId,
      image,
      bindMounts,
      env: creds.env,
      resources: opts.config.resources,
    });

    const checks: SandboxDoctorCheck[] = [];
    const execEnv = mergeEnv(creds.env, {
      GH_TOKEN: opts.githubToken,
      GITHUB_TOKEN: opts.githubToken,
    });
    const providerPath = providerExecutable(opts.config, opts.provider);
    checks.push(
      await execCheck(handle, {
        name: `provider cli: ${providerPath}`,
        script: toolProbeScript(providerPath),
        env: execEnv,
      }),
    );
    for (const tool of opts.requiredTools ?? ["gh"]) {
      checks.push(
        await execCheck(handle, {
          name: `required cli: ${tool}`,
          script: toolProbeScript(tool),
          env: execEnv,
        }),
      );
    }
    if (opts.githubToken !== undefined) {
      checks.push(
        await execCheck(handle, {
          name: "gh auth status",
          script: "gh auth status",
          env: execEnv,
        }),
      );
    }
    checks.push(
      await execCheck(handle, {
        name: "provider credentials",
        script: credentialProbe(opts.provider),
        env: execEnv,
      }),
    );
    checks.push(
      await execCheck(handle, {
        name: "workspace writable",
        cwd: containerCwd,
        script:
          'test -d "$PWD" && test -w "$PWD" && touch .dalang-doctor-write-test && rm .dalang-doctor-write-test',
        env: execEnv,
      }),
    );
    return { ok: checks.every((c) => c.ok), checks };
  } finally {
    if (handle !== null) await handle.stop().catch(() => {});
    await creds.dispose().catch(() => {});
  }
}

export function defaultSandboxesRoot(workspaceRoot: string): string {
  return resolve(workspaceRoot, ".dalang", "sandboxes");
}

function toolProbeScript(tool: string): string {
  const q = shellQuote(tool);
  return `command -v ${q} >/dev/null && (${q} --version || ${q} version || true)`;
}
