// packages/dalang/tests/agent/codex-runner.test.ts
import { test, expect } from "bun:test";
import { codexRunQuery } from "../../src/agent/codex-runner";

// Smoke test: the runner constructs the SDK lazily (Codex constructor and
// startThread do not spawn the codex binary until runStreamed is awaited),
// so we can verify the runner returns a proper AsyncIterable without
// invoking the real codex executable or requiring credentials.
test("codexRunQuery returns an async iterable (smoke)", () => {
  const it = codexRunQuery({
    prompt: "hello",
    cwd: "/tmp",
    codex: { sandboxMode: "read-only", approvalPolicy: "never", networkAccessEnabled: false },
    model: "gpt-5.5",
    executablePath: "codex",
  });
  expect(typeof (it as AsyncIterable<unknown>)[Symbol.asyncIterator]).toBe("function");
});

test("codexRunQuery throws when opts.codex is missing (provider mismatch)", () => {
  expect(() =>
    codexRunQuery({
      prompt: "hello",
      cwd: "/tmp",
      claude: { permissionMode: "auto" },
      model: "gpt-5.5",
      executablePath: "codex",
    }),
  ).toThrow(/provider mismatch/);
});
