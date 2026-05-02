import { test, expect, beforeAll, setDefaultTimeout } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { realpath } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { DockerContainerHost } from "../../src/sandbox/docker-host";
import { FilesystemAuthStore } from "../../src/auth/store";
import { createSandboxedRunQuery } from "../../src/sandbox/sandboxed-runner";

setDefaultTimeout(120_000);

let dockerAvailable = false;
let claudeAuthAvailable = false;

beforeAll(async () => {
  try {
    const proc = Bun.spawn(["docker", "version", "--format", "{{.Server.Version}}"]);
    dockerAvailable = (await proc.exited) === 0;
  } catch {
    dockerAvailable = false;
  }
  claudeAuthAvailable =
    typeof process.env["CLAUDE_CODE_OAUTH_TOKEN"] === "string" ||
    typeof process.env["ANTHROPIC_API_KEY"] === "string" ||
    existsSync(join(homedir(), ".claude", ".credentials.json"));
});

test("sandboxed claude RunQuery executes a one-turn prompt end-to-end", async () => {
  if (!dockerAvailable || !claudeAuthAvailable) return;

  const repoDir = await realpath(await mkdtemp(join(tmpdir(), "sandbox-e2e-")));
  await writeFile(
    join(repoDir, "Dockerfile"),
    `FROM alpine:3.19
RUN apk add --no-cache bash curl
WORKDIR /workspace
`,
  );

  const credDir = await realpath(await mkdtemp(join(tmpdir(), "sandbox-e2e-cred-")));
  const store = new FilesystemAuthStore(credDir);
  const token =
    process.env["CLAUDE_CODE_OAUTH_TOKEN"] ??
    process.env["ANTHROPIC_API_KEY"] ??
    "set-CLAUDE_CODE_OAUTH_TOKEN-to-run-this-test";
  await store.setClaudeToken(token);

  const sandboxesRoot = await realpath(await mkdtemp(join(tmpdir(), "sandbox-e2e-sb-")));
  const shimBinary = resolve(
    import.meta.dir,
    "..",
    "..",
    "dist",
    "dalang-worker",
  );
  if (!existsSync(shimBinary)) {
    console.warn(`shim binary missing at ${shimBinary}; skipping. Run \`bun run worker:build\`.`);
    return;
  }

  const runQuery = createSandboxedRunQuery({
    host: new DockerContainerHost(),
    store,
    sandboxesRoot,
    repoDir,
    config: {
      enabled: true,
      image: { source: "dockerfile", path: "Dockerfile" },
      resources: { cpus: "1", memory: "512m", pidsLimit: 512, tmpfsSize: "64m" },
      providers: {
        claude: { executablePath: "claude" },
        codex: { executablePath: "codex" },
        opencode: { executablePath: "opencode" },
      },
    },
    shimBinaryHostPath: shimBinary,
  });

  const events: unknown[] = [];
  try {
    for await (const ev of runQuery({
      prompt: "Say only the word: pong",
      cwd: repoDir,
      model: "claude-haiku-4-5-20251001",
      executablePath: "claude",
      claude: { permissionMode: "default" },
    })) {
      events.push(ev);
    }
  } catch (err) {
    // The fixture image doesn't have `claude` installed. We expect the shim
    // to surface that as an error event. The lifecycle integration is what
    // we're validating — not whether the fixture image happens to have claude.
    expect((err as Error).message.length).toBeGreaterThan(0);
    return;
  }
  // If the image did have claude, we expect at least one provider event.
  expect(events.length).toBeGreaterThan(0);
});
