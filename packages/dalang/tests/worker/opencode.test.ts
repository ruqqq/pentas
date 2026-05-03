import { test, expect, beforeAll, setDefaultTimeout } from "bun:test";
import { resolve } from "node:path";

setDefaultTimeout(60_000);

const realShim = resolve(import.meta.dir, "..", "..", "src", "worker", "main.ts");
let opencodeAvailable = false;

beforeAll(async () => {
  const opencodePath = process.env["DALANG_OPENCODE_PATH"];
  opencodeAvailable = typeof opencodePath === "string" && opencodePath.length > 0;
});

test("worker main with provider:opencode streams provider_events from a real session", async () => {
  if (!opencodeAvailable) return;
  const opencodePath = process.env["DALANG_OPENCODE_PATH"] as string;
  const model = process.env["DALANG_OPENCODE_MODEL"] ?? "anthropic/claude-haiku-4-5-20251001";
  const invocation = JSON.stringify({
    provider: "opencode",
    prompt: "Say only the word: pong",
    cwd: process.cwd(),
    model,
    executablePath: opencodePath,
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
  await proc.exited;

  const events = stdoutText
    .trim()
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as { kind: string });
  // The shim must round-trip events; both clean finished and error tail are valid
  // (depends on whether the model is enabled for the user's account).
  expect(events.some((e) => e.kind === "provider_event")).toBe(true);
  const last = events[events.length - 1]?.kind;
  expect(last === "finished" || last === "error").toBe(true);
});
