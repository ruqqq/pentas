import { test, expect } from "bun:test";
import { opencodeRunQuery } from "../../src/agent/opencode-runner";
import {
  __resetOpencodeServerForTests,
  __setOpencodeFactoryForTests,
} from "../../src/agent/opencode-server";

function installFakeBackend(opts: {
  onSessionCreate?: (body: unknown) => { id: string };
  onPrompt?: (path: { id: string }, body: unknown) => void;
  emitEvents?: (emit: (e: unknown) => void) => void;
}): void {
  __setOpencodeFactoryForTests(async () => {
    const queue: ({ data: unknown } | null)[] = [];
    const waiters: ((v: { data: unknown } | null) => void)[] = [];
    const push = (v: { data: unknown } | null) => {
      if (waiters.length) waiters.shift()!(v);
      else queue.push(v);
    };
    const emit = (e: unknown) => push({ data: e });
    if (opts.emitEvents) {
      // Emit after a macrotask so the runner can subscribe before events arrive
      setTimeout(() => opts.emitEvents!(emit), 0);
    }
    const iter = {
      [Symbol.asyncIterator]() { return this; },
      async next() {
        const v = queue.length ? queue.shift()! : await new Promise<{ data: unknown } | null>((r) => waiters.push(r));
        if (v === null) return { done: true as const, value: undefined };
        return { done: false as const, value: v };
      },
    };
    return {
      client: {
        event: () => Promise.resolve({ stream: iter as AsyncIterable<{ data: unknown }> }),
        session: {
          create: async ({ body }: { body: unknown }) => {
            const id = (opts.onSessionCreate ?? (() => ({ id: "ses-fake" })))(body).id;
            return { data: { id } };
          },
          promptAsync: async ({ path, body }: { path: { id: string }; body: unknown }) => {
            opts.onPrompt?.(path, body);
            return { data: { ok: true } };
          },
        },
      },
      shutdown: async () => { push(null); },
    };
  });
}

test("opencodeRunQuery throws when opts.opencode bag is missing (provider mismatch)", () => {
  expect(() =>
    opencodeRunQuery({
      prompt: "hi", cwd: "/tmp", model: "anthropic/claude",
      executablePath: "opencode",
      claude: { permissionMode: "auto" },
    } as never),
  ).toThrow(/provider mismatch/);
});

test("opencodeRunQuery throws when model has no provider/model split", () => {
  // Model parsing happens lazily inside the iterator, so we must consume it to surface the throw.
  const iter = opencodeRunQuery({
    prompt: "hi", cwd: "/tmp", model: "no-slash",
    executablePath: "opencode",
    opencode: {},
  });
  expect(async () => { for await (const _ of iter) break; }).toThrow(/providerID/);
});

test("opencodeRunQuery creates a session, sends a prompt, and yields filtered events", async () => {
  __resetOpencodeServerForTests();
  let createdBody: unknown = null;
  let promptPath: { id: string } | null = null;
  let promptBody: unknown = null;
  installFakeBackend({
    onSessionCreate: (body) => { createdBody = body; return { id: "ses-1" }; },
    onPrompt: (path, body) => { promptPath = path; promptBody = body; },
    emitEvents: (emit) => {
      emit({ type: "session.created", properties: { info: { id: "ses-1" } } });
      emit({ type: "message.part.updated", properties: { sessionID: "ses-1", part: { type: "text", text: "hi" } } });
      emit({ type: "session.idle", properties: { sessionID: "ses-1", tokens: { input: 1, output: 2, reasoning: 0 } } });
    },
  });

  const iter = opencodeRunQuery({
    prompt: "do the thing",
    cwd: "/tmp/ws",
    model: "anthropic/claude-sonnet-4-6",
    executablePath: "opencode",
    opencode: {},
  });

  const events: unknown[] = [];
  for await (const e of iter) {
    events.push(e);
    if ((e as { type: string }).type === "session.idle") break;
  }
  expect(events.length).toBe(3);
  expect((createdBody as { directory: string }).directory).toBe("/tmp/ws");
  expect((promptPath as { id: string } | null)?.id).toBe("ses-1");
  expect((promptBody as { model: { providerID: string; modelID: string } }).model)
    .toEqual({ providerID: "anthropic", modelID: "claude-sonnet-4-6" });
});

test("opencodeRunQuery terminates promptly when abortSignal fires while waiting for events", async () => {
  __resetOpencodeServerForTests();

  installFakeBackend({
    onSessionCreate: () => ({ id: "ses-stall" }),
    onPrompt: () => {},
    // No emitEvents — the queue stays empty so the runner blocks on next().
  });

  const ac = new AbortController();
  const iter = opencodeRunQuery({
    prompt: "hangs",
    cwd: "/tmp/ws",
    model: "anthropic/claude-sonnet-4-6",
    executablePath: "opencode",
    opencode: {},
    abortSignal: ac.signal,
  });

  const consumed: unknown[] = [];
  const consume = (async () => {
    for await (const e of iter) consumed.push(e);
  })();

  // Give the runner time to reach the queue wait, then abort.
  await new Promise((r) => setTimeout(r, 20));
  ac.abort();

  // The consume loop should resolve quickly (within ~500ms) once the queue closes.
  await Promise.race([
    consume,
    new Promise((_, reject) => setTimeout(() => reject(new Error("runner did not terminate after abort")), 500)),
  ]);

  expect(consumed.length).toBe(0);
});

test("opencodeRunQuery resumes an existing session id without calling create", async () => {
  __resetOpencodeServerForTests();
  let createCalls = 0;
  let promptedSessionId = "";

  __setOpencodeFactoryForTests(async () => {
    const queue: ({ data: unknown } | null)[] = [];
    const waiters: ((v: { data: unknown } | null) => void)[] = [];
    const push = (v: { data: unknown } | null) => { if (waiters.length) waiters.shift()!(v); else queue.push(v); };
    queueMicrotask(() => {
      push({ data: { type: "session.idle", properties: { sessionID: "ses-resume", tokens: { input: 0, output: 0, reasoning: 0 } } } });
    });
    const stream = {
      [Symbol.asyncIterator]() { return this; },
      async next() {
        const v = queue.length ? queue.shift()! : await new Promise<{ data: unknown } | null>((r) => waiters.push(r));
        if (v === null) return { done: true as const, value: undefined };
        return { done: false as const, value: v };
      },
    };
    return {
      client: {
        event: () => Promise.resolve({ stream: stream as AsyncIterable<{ data: unknown }> }),
        session: {
          create: async () => { createCalls += 1; return { data: { id: "should-not-be-used" } }; },
          promptAsync: async ({ path }: { path: { id: string } }) => { promptedSessionId = path.id; return { data: {} }; },
        },
      },
      shutdown: async () => { push(null); },
    };
  });

  const iter = opencodeRunQuery({
    prompt: "again",
    cwd: "/tmp/ws",
    model: "anthropic/claude-sonnet-4-6",
    executablePath: "opencode",
    resumeSessionId: "ses-resume",
    opencode: {},
  });
  for await (const _ of iter) break;

  expect(createCalls).toBe(0);
  expect(promptedSessionId).toBe("ses-resume");
});
