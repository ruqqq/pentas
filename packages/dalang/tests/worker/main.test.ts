import { test, expect } from "bun:test";
import { resolve } from "node:path";
import type { WorkerEvent } from "../../src/worker/protocol";

const fixtureShim = resolve(import.meta.dir, "..", "fixtures", "worker", "echo-shim.ts");

async function runShim(stdinJson: string): Promise<{ stdout: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", fixtureShim], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.write(stdinJson);
  proc.stdin.end();
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { stdout, exitCode };
}

test("echo-shim writes one provider_event per line and a final finished event", async () => {
  const out = await runShim('{"items":[{"a":1},{"b":2}]}');
  const lines = out.stdout.trim().split("\n");
  const events = lines.map((l) => JSON.parse(l) as WorkerEvent);
  expect(events).toEqual([
    { kind: "provider_event", payload: { a: 1 } },
    { kind: "provider_event", payload: { b: 2 } },
    { kind: "finished" },
  ]);
  expect(out.exitCode).toBe(0);
});

test("echo-shim emits an error event and exits non-zero on bad input", async () => {
  const out = await runShim("not json");
  const lines = out.stdout.trim().split("\n");
  const events = lines.map((l) => JSON.parse(l) as WorkerEvent);
  expect(events.length).toBe(1);
  expect(events[0]?.kind).toBe("error");
  expect(out.exitCode).not.toBe(0);
});

const realShim = resolve(import.meta.dir, "..", "..", "src", "worker", "main.ts");
const claudeAuthAvailable =
  typeof process.env["ANTHROPIC_API_KEY"] === "string" ||
  typeof process.env["CLAUDE_CODE_OAUTH_TOKEN"] === "string";

test("worker main with provider:claude streams provider_events from a real Claude turn", async () => {
  if (!claudeAuthAvailable) return;
  const claudePath = process.env["DALANG_CLAUDE_PATH"] ?? "claude";
  const invocation = JSON.stringify({
    provider: "claude",
    prompt: "Say only the word: pong",
    cwd: process.cwd(),
    model: "claude-haiku-4-5-20251001",
    executablePath: claudePath,
    claude: { permissionMode: "default" },
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
  // We at least see one provider_event and a finished marker.
  expect(events.some((e) => e.kind === "provider_event")).toBe(true);
  expect(events[events.length - 1]?.kind).toBe("finished");
  expect(exitCode).toBe(0);
});
