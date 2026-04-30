import { test, expect } from "bun:test";
import {
  __resetOpencodeServerForTests,
  __setOpencodeBackoffsForTests,
  __setOpencodeFactoryForTests,
  getOpencodeClient,
  shutdownOpencodeServer,
  subscribeSession,
} from "../../src/agent/opencode-server";

interface FakeFactoryControls {
  spawned: number;
  emit: (e: unknown) => void;
  failNextSpawn?: boolean;
}

function makeFakeFactory(): FakeFactoryControls {
  const ctl: FakeFactoryControls = { spawned: 0, emit: () => {} };
  __setOpencodeFactoryForTests(async () => {
    if (ctl.failNextSpawn) {
      ctl.failNextSpawn = false;
      throw new Error("spawn failed");
    }
    ctl.spawned += 1;
    let push!: (v: { data: unknown } | null) => void;
    const queue: ({ data: unknown } | null)[] = [];
    const waiters: ((v: { data: unknown } | null) => void)[] = [];
    push = (v) => { if (waiters.length) waiters.shift()!(v); else queue.push(v); };
    ctl.emit = (e) => push({ data: e });
    const iter = {
      [Symbol.asyncIterator]() { return this; },
      async next() {
        const v = queue.length ? queue.shift()! : await new Promise<{ data: unknown } | null>((r) => waiters.push(r));
        if (v === null) return { done: true as const, value: undefined };
        return { done: false as const, value: v };
      },
    };
    const close = () => push(null);
    return {
      client: { event: () => Promise.resolve({ stream: iter as AsyncIterable<{ data: unknown }> }) },
      shutdown: async () => { close(); },
    };
  });
  return ctl;
}

test("getOpencodeClient spawns lazily and is cached", async () => {
  __resetOpencodeServerForTests();
  const ctl = makeFakeFactory();
  await getOpencodeClient({ executablePath: "opencode" });
  await getOpencodeClient({ executablePath: "opencode" });
  expect(ctl.spawned).toBe(1);
  await shutdownOpencodeServer();
});

test("subscribeSession yields events filtered by sessionID", async () => {
  __resetOpencodeServerForTests();
  const ctl = makeFakeFactory();
  await getOpencodeClient({ executablePath: "opencode" });

  const sub = subscribeSession("ses-1");
  const it = sub[Symbol.asyncIterator]();

  ctl.emit({ type: "session.created", properties: { info: { id: "ses-1" } } });
  ctl.emit({ type: "message.part.updated", properties: { sessionID: "other" } });
  ctl.emit({ type: "message.part.updated", properties: { sessionID: "ses-1", part: { type: "text", text: "hi" } } });

  const a = await it.next();
  expect((a.value as { type: string }).type).toBe("session.created");
  const b = await it.next();
  expect((b.value as { type: string }).type).toBe("message.part.updated");
  expect(((b.value as { properties: { sessionID: string } }).properties.sessionID)).toBe("ses-1");

  await shutdownOpencodeServer();
});

test("shutdownOpencodeServer closes subscribers", async () => {
  __resetOpencodeServerForTests();
  makeFakeFactory();
  await getOpencodeClient({ executablePath: "opencode" });
  const sub = subscribeSession("ses-1");
  await shutdownOpencodeServer();
  for await (const _ of sub) { /* should drain */ }
  expect(true).toBe(true);
});

test("after a crash, the next getOpencodeClient call respawns the backend", async () => {
  __resetOpencodeServerForTests();

  let spawnCount = 0;
  let crashControl: { close: () => void } | null = null;

  __setOpencodeFactoryForTests(async () => {
    spawnCount += 1;
    const queue: ({ data: unknown } | null)[] = [];
    const waiters: ((v: { data: unknown } | null) => void)[] = [];
    const push = (v: { data: unknown } | null) => {
      if (waiters.length) waiters.shift()!(v);
      else queue.push(v);
    };
    const iter = {
      [Symbol.asyncIterator]() { return this; },
      async next() {
        const v = queue.length ? queue.shift()! : await new Promise<{ data: unknown } | null>((r) => waiters.push(r));
        if (v === null) return { done: true as const, value: undefined };
        return { done: false as const, value: v };
      },
    };
    crashControl = { close: () => push(null) };
    return {
      client: { event: () => Promise.resolve({ stream: iter as AsyncIterable<{ data: unknown }> }) },
      shutdown: async () => { push(null); },
    };
  });

  await getOpencodeClient({ executablePath: "opencode" });
  expect(spawnCount).toBe(1);

  // Simulate a crash: close the SSE stream so readLoop's for-await ends, then
  // wait long enough for the readLoop to finish its post-crash backoff path.
  crashControl!.close();
  // The supervisor uses a 1000ms backoff for the first crash; wait past it.
  await new Promise((r) => setTimeout(r, 1100));

  await getOpencodeClient({ executablePath: "opencode" });
  expect(spawnCount).toBe(2);

  await shutdownOpencodeServer();
});

test("after exhausting retry budget, queues are closed", async () => {
  __resetOpencodeServerForTests();
  // 5 backoffs: exhaustion fires after the 5th backoff delay (on the 6th crash check).
  __setOpencodeBackoffsForTests([5, 5, 5, 5, 5]);

  let spawnCount = 0;
  __setOpencodeFactoryForTests(async () => {
    spawnCount += 1;
    // The stream is always-already-done: for-await exits immediately, triggering crash logic.
    const stream = {
      [Symbol.asyncIterator]() { return this; },
      async next() { return { done: true as const, value: undefined }; },
    };
    return {
      client: { event: () => Promise.resolve({ stream: stream as AsyncIterable<{ data: unknown }> }) },
      shutdown: async () => {},
    };
  });

  // Subscribe BEFORE spawning so the queue exists and we can verify it gets closed.
  const sub = subscribeSession("ses-1");
  const it = sub[Symbol.asyncIterator]();

  // Drive spawns manually: each getOpencodeClient call triggers a spawn after
  // the previous readLoop finished its backoff sleep and cleared starting/backend.
  // We need enough calls to exhaust the retry budget (5 backoffs => 6 crashes).
  for (let i = 0; i < 6; i++) {
    await getOpencodeClient({ executablePath: "opencode" });
    // Wait for the current readLoop to crash and clear backend/starting.
    await new Promise((r) => setTimeout(r, 20));
  }

  // Pull from the subscription — should be closed (done) after budget exhaustion.
  const result = await it.next();
  expect(result.done).toBe(true);
  expect(spawnCount).toBeGreaterThanOrEqual(5);

  // After exhaustion, starting must have been cleared so that a fresh
  // getOpencodeClient call can spawn a new backend rather than returning
  // the dead cached promise.
  const spawnsBeforeRetry = spawnCount;
  await getOpencodeClient({ executablePath: "opencode" }).catch(() => {});
  expect(spawnCount).toBeGreaterThan(spawnsBeforeRetry);

  await shutdownOpencodeServer();
});
