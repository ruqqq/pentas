export interface CommandRunner {
  (cmd: string[], env: Record<string, string>): Promise<{ exitCode: number; stderr: string }>;
}

export const runCommand: CommandRunner = async (cmd, env) => {
  const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "pipe", env });
  const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  return { exitCode, stderr };
};

export interface GitIdentity {
  userName: string;
  userEmail: string;
}

export async function setupGitIdentity(
  identity: GitIdentity | undefined,
  env: Record<string, string>,
  run: CommandRunner = runCommand,
): Promise<void> {
  if (identity === undefined) return;
  const commands = [
    ["git", "config", "--global", "user.name", identity.userName],
    ["git", "config", "--global", "user.email", identity.userEmail],
  ];
  for (const cmd of commands) {
    const result = await run(cmd, env);
    if (result.exitCode !== 0) {
      throw new Error(
        `git identity setup failed: ${cmd.join(" ")}: ${result.stderr.trim() || `exit ${result.exitCode}`}`,
      );
    }
  }
}

export async function setupGithubGitAuth(
  env: Record<string, string>,
  run: CommandRunner = runCommand,
): Promise<void> {
  const token = env.GH_TOKEN ?? env.GITHUB_TOKEN;
  if (!token) return;

  const commands = [
    ["gh", "auth", "setup-git"],
    ["git", "config", "--global", "--add", "url.https://github.com/.insteadOf", "git@github.com:"],
    [
      "git",
      "config",
      "--global",
      "--add",
      "url.https://github.com/.insteadOf",
      "ssh://git@github.com/",
    ],
  ];

  for (const cmd of commands) {
    const result = await run(cmd, env);
    if (result.exitCode !== 0) {
      throw new Error(
        `github git auth setup failed: ${cmd.join(" ")}: ${result.stderr.trim() || `exit ${result.exitCode}`}`,
      );
    }
  }
}
