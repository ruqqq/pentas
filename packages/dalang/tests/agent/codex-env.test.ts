import { test, expect } from "bun:test";
import { buildCodexChildEnv } from "../../src/agent/codex-env";

test("buildCodexChildEnv preserves process env and applies explicit overrides", () => {
  const oldCodexHome = process.env.CODEX_HOME;
  const oldHome = process.env.HOME;
  try {
    process.env.CODEX_HOME = "/run/dalang/codex";
    process.env.HOME = "/home/container-user";

    const env = buildCodexChildEnv({ HOME: "/tmp", GITHUB_TOKEN: "token" });

    expect(env.CODEX_HOME).toBe("/run/dalang/codex");
    expect(env.HOME).toBe("/tmp");
    expect(env.GITHUB_TOKEN).toBe("token");
  } finally {
    if (oldCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = oldCodexHome;
    if (oldHome === undefined) delete process.env.HOME;
    else process.env.HOME = oldHome;
  }
});

test("buildCodexChildEnv can preserve selected process env keys from overrides", () => {
  const oldCodexHome = process.env.CODEX_HOME;
  try {
    process.env.CODEX_HOME = "/run/dalang/codex";

    const env = buildCodexChildEnv(
      { CODEX_HOME: "/home/host/.codex", GITHUB_TOKEN: "token" },
      { preserveProcessKeys: ["CODEX_HOME"] },
    );

    expect(env.CODEX_HOME).toBe("/run/dalang/codex");
    expect(env.GITHUB_TOKEN).toBe("token");
  } finally {
    if (oldCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = oldCodexHome;
  }
});
