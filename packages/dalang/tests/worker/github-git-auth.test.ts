import { test, expect } from "bun:test";
import {
  setupGitIdentity,
  setupGithubGitAuth,
  type CommandRunner,
} from "../../src/worker/github-git-auth";

test("setupGitIdentity skips when identity is absent", async () => {
  const calls: string[][] = [];
  const run: CommandRunner = async (cmd) => {
    calls.push(cmd);
    return { exitCode: 0, stderr: "" };
  };

  await setupGitIdentity(undefined, {}, run);

  expect(calls).toEqual([]);
});

test("setupGitIdentity configures user name and email", async () => {
  const calls: string[][] = [];
  const cwds: Array<string | undefined> = [];
  const run: CommandRunner = async (cmd, _env, opts) => {
    calls.push(cmd);
    cwds.push(opts?.cwd);
    return { exitCode: 0, stderr: "" };
  };

  await setupGitIdentity({ userName: "Dalang Bot", userEmail: "dalang@example.com" }, {}, run);

  expect(calls).toEqual([
    ["git", "config", "--global", "user.name", "Dalang Bot"],
    ["git", "config", "--global", "user.email", "dalang@example.com"],
  ]);
  expect(cwds).toEqual(["/tmp", "/tmp"]);
});

test("setupGithubGitAuth skips when no github token is present", async () => {
  const calls: string[][] = [];
  const run: CommandRunner = async (cmd) => {
    calls.push(cmd);
    return { exitCode: 0, stderr: "" };
  };

  await setupGithubGitAuth({}, run);

  expect(calls).toEqual([]);
});

test("setupGithubGitAuth configures gh and rewrites ssh github remotes to https", async () => {
  const calls: string[][] = [];
  const cwds: Array<string | undefined> = [];
  const env = { GH_TOKEN: "token" };
  const run: CommandRunner = async (cmd, gotEnv, opts) => {
    expect(gotEnv).toBe(env);
    calls.push(cmd);
    cwds.push(opts?.cwd);
    return { exitCode: 0, stderr: "" };
  };

  await setupGithubGitAuth(env, run);

  expect(calls).toEqual([
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
  ]);
  expect(cwds).toEqual(["/tmp", "/tmp", "/tmp"]);
});

test("setupGithubGitAuth throws when setup command fails", async () => {
  const run: CommandRunner = async () => ({ exitCode: 1, stderr: "gh missing" });

  await expect(setupGithubGitAuth({ GITHUB_TOKEN: "token" }, run)).rejects.toThrow(
    /github git auth setup failed: gh auth setup-git: gh missing/,
  );
});
