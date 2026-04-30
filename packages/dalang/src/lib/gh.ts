export interface GhResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export interface GhOptions {
  cwd: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export async function runGh(
  executable: string,
  args: string[],
  opts: GhOptions,
): Promise<GhResult> {
  const proc = Bun.spawn([executable, ...args], {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const timeout = opts.timeoutMs ?? 30000;
  const timer = setTimeout(() => proc.kill(), timeout);
  try {
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    return { stdout, stderr, exitCode };
  } finally {
    clearTimeout(timer);
  }
}
