// packages/dalang/src/workspace/hooks.ts
export interface RunHookOptions {
  name: string;
  script: string | null | undefined;
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
}

export interface HookResult {
  ok: boolean;
  skipped?: boolean;
  exitCode?: number;
  timedOut?: boolean;
  stdout?: string;
  stderr?: string;
}

export async function runHook(opts: RunHookOptions): Promise<HookResult> {
  if (!opts.script || opts.script.trim().length === 0) return { ok: true, skipped: true };

  const proc = Bun.spawn(["bash", "-lc", opts.script], {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; proc.kill(); }, opts.timeoutMs);

  const exitCode = await proc.exited;
  clearTimeout(timer);

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  if (timedOut) return { ok: false, timedOut: true, stdout, stderr };
  if (exitCode !== 0) return { ok: false, exitCode, stdout, stderr };
  return { ok: true, exitCode: 0, stdout, stderr };
}

export function truncateLogged(output: string, max: number = 2000): string {
  if (output.length <= max) return output;
  return output.slice(0, max) + `\n... [truncated ${output.length - max} bytes]`;
}
