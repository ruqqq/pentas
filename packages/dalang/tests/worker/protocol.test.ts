import { test, expect } from "bun:test";
import {
  WorkerInvocationSchema,
  WorkerEventSchema,
  type WorkerEvent,
} from "../../src/worker/protocol";

test("WorkerInvocationSchema accepts a Claude invocation", () => {
  const parsed = WorkerInvocationSchema.parse({
    provider: "claude",
    prompt: "hello",
    cwd: "/workspace",
    model: "claude-sonnet-4-6",
    executablePath: "/opt/dalang/bin/claude",
    claude: { permissionMode: "auto" },
  });
  expect(parsed.provider).toBe("claude");
});

test("WorkerInvocationSchema rejects a Claude invocation without claude bag", () => {
  const result = WorkerInvocationSchema.safeParse({
    provider: "claude",
    prompt: "hello",
    cwd: "/workspace",
    model: "claude-sonnet-4-6",
    executablePath: "/opt/dalang/bin/claude",
  });
  expect(result.success).toBe(false);
});

test("WorkerInvocationSchema accepts a Codex invocation", () => {
  const parsed = WorkerInvocationSchema.parse({
    provider: "codex",
    prompt: "hello",
    cwd: "/workspace",
    model: "gpt-5",
    executablePath: "/opt/dalang/bin/codex",
    codex: {
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
      networkAccessEnabled: true,
      git: { userName: "Dalang Bot", userEmail: "dalang@example.com" },
    },
  });
  expect(parsed.provider).toBe("codex");
  if (parsed.provider === "codex") {
    expect(parsed.codex.git?.userEmail).toBe("dalang@example.com");
  }
});

test("WorkerInvocationSchema accepts an Opencode invocation", () => {
  const parsed = WorkerInvocationSchema.parse({
    provider: "opencode",
    prompt: "hello",
    cwd: "/workspace",
    model: "anthropic/claude-sonnet-4-6",
    executablePath: "/opt/dalang/bin/opencode",
  });
  expect(parsed.provider).toBe("opencode");
});

test("WorkerEventSchema parses provider_event with arbitrary payload", () => {
  const ev: WorkerEvent = {
    kind: "provider_event",
    payload: { foo: "bar", nested: { a: 1 } },
  };
  expect(WorkerEventSchema.parse(ev)).toEqual(ev);
});

test("WorkerEventSchema parses error and finished events", () => {
  expect(WorkerEventSchema.parse({ kind: "error", message: "boom" }).kind).toBe("error");
  expect(WorkerEventSchema.parse({ kind: "finished" }).kind).toBe("finished");
});
