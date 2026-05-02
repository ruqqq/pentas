import { test, expect } from "bun:test";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { homedir } from "node:os";

const realShim = resolve(import.meta.dir, "..", "..", "src", "worker", "main.ts");
const codexAuthAvailable =
  typeof process.env["OPENAI_API_KEY"] === "string" ||
  existsSync(resolve(homedir(), ".codex", "auth.json"));

test("worker main with provider:codex streams provider_events from a real Codex turn", async () => {
  if (!codexAuthAvailable) return;
  const codexPath = process.env["DALANG_CODEX_PATH"] ?? "codex";
  const invocation = JSON.stringify({
    provider: "codex",
    prompt: "Say only the word: pong",
    cwd: process.cwd(),
    model: "gpt-5",
    executablePath: codexPath,
    codex: {
      sandboxMode: "read-only",
      approvalPolicy: "never",
      networkAccessEnabled: false,
    },
  });
  const proc = Bun.spawn(["bun", "run", realShim], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: process.env as Record<string, string>,
  });
  proc.stdin.write(invocation);
  proc.stdin.end();
  const stdoutText = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  const events = stdoutText
    .trim()
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as { kind: string });
  expect(events.some((e) => e.kind === "provider_event")).toBe(true);
  expect(events[events.length - 1]?.kind).toBe("finished");
  expect(exitCode).toBe(0);
});
