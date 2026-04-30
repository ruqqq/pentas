// packages/dalang/src/agent/opencode-server.ts
//
// Owns a single shared opencode HTTP server for the whole dalang process.
// - Lazy spawn on first getOpencodeClient() call.
// - Crash supervision with bounded backoff (1s, 2s, 4s, 8s, 8s — max 5 attempts/60s).
// - Single SSE read loop fans out events to per-session queues so each worker
//   sees only its own session's events.
//
// SDK shape notes (verified against @opencode-ai/sdk@1.14.30):
// - createOpencodeServer({ hostname, port }) -> Promise<{ url, close() }>
// - createOpencodeClient({ baseUrl }) -> OpencodeClient
// - OpencodeClient.event.subscribe() -> Promise<ServerSentEventsResult<EventSubscribeResponses>>
//   where stream yields Event objects DIRECTLY (not wrapped in { data }).
// - defaultFactory wraps each yielded Event in { data: event } so that the
//   OpencodeBackendClient.event() contract (which the test fake also satisfies)
//   is uniform: stream items are always { data: unknown }.

interface OpencodeBackendClient {
  event(): Promise<{ stream: AsyncIterable<{ data: unknown }> }>;
  // session.* and other methods are present on the real SDK client and consumed
  // by opencode-runner.ts; we deliberately don't constrain them here.
  [key: string]: unknown;
}

interface OpencodeBackend {
  client: OpencodeBackendClient;
  shutdown(): Promise<void>;
}

type OpencodeFactory = (opts: { executablePath: string }) => Promise<OpencodeBackend>;

const RESTART_BACKOFFS_MS_DEFAULT = [1000, 2000, 4000, 8000, 8000] as const;
const RESTART_WINDOW_MS = 60_000;

let restartBackoffsMs: readonly number[] = RESTART_BACKOFFS_MS_DEFAULT;

let factory: OpencodeFactory = defaultFactory;
let backend: OpencodeBackend | null = null;
let starting: Promise<OpencodeBackend> | null = null;
let queues = new Map<string, Queue<unknown>>();
let restartAt: number[] = [];
let stopped = false;

interface Queue<T> {
  push(v: T): void;
  close(): void;
  iterable(): AsyncIterable<T>;
}

function makeQueue<T>(): Queue<T> {
  const buf: T[] = [];
  const waiters: ((v: T | null) => void)[] = [];
  let closed = false;
  return {
    push(v) {
      if (closed) return;
      if (waiters.length) waiters.shift()!(v);
      else buf.push(v);
    },
    close() {
      if (closed) return;
      closed = true;
      while (waiters.length) waiters.shift()!(null);
    },
    iterable() {
      return {
        [Symbol.asyncIterator]() {
          return {
            async next(): Promise<IteratorResult<T>> {
              if (buf.length) {
                return { done: false, value: buf.shift() as T };
              }
              if (closed) return { done: true, value: undefined as never };
              const v = await new Promise<T | null>((r) => waiters.push(r));
              if (v === null) return { done: true, value: undefined as never };
              return { done: false, value: v };
            },
          };
        },
      };
    },
  };
}

async function defaultFactory(_opts: { executablePath: string }): Promise<OpencodeBackend> {
  // executablePath is reserved for future use; createOpencodeServer doesn't
  // accept a custom binary path today.
  const sdk = await import("@opencode-ai/sdk");
  const server = await sdk.createOpencodeServer({ hostname: "127.0.0.1", port: 0 });
  const sdkClient = sdk.createOpencodeClient({ baseUrl: server.url });

  // The real SDK's event.subscribe() stream yields Event objects directly.
  // We wrap each in { data } so the OpencodeBackendClient contract is uniform
  // with the test fake (which also yields { data: unknown }).
  const wrappedClient: OpencodeBackendClient = {
    // Expose the underlying SDK client properties for opencode-runner.ts.
    // Spread FIRST so our event() override below wins over the SDK's Event class instance.
    ...(sdkClient as unknown as Record<string, unknown>),
    event: async () => {
      const result = await sdkClient.event.subscribe();
      async function* wrapStream() {
        for await (const event of result.stream) {
          yield { data: event as unknown };
        }
      }
      return { stream: wrapStream() };
    },
  };

  return {
    client: wrappedClient,
    shutdown: async () => {
      server.close();
    },
  };
}

function extractSessionId(raw: unknown): string | null {
  if (raw === null || typeof raw !== "object") return null;
  const e = raw as { type?: unknown; properties?: unknown };
  const props = e.properties as Record<string, unknown> | undefined;
  if (!props) return null;
  if (e.type === "session.created") {
    const info = props.info as { id?: unknown } | undefined;
    return info && typeof info.id === "string" ? info.id : null;
  }
  // Most events carry sessionID directly in properties.
  // For message.part.updated the real SDK has it on properties.part.sessionID,
  // but we also accept properties.sessionID for test fakes and future-proofing.
  if (typeof props.sessionID === "string") return props.sessionID;
  const part = props.part as { sessionID?: unknown } | undefined;
  if (part && typeof part.sessionID === "string") return part.sessionID;
  return null;
}

async function readLoop(b: OpencodeBackend): Promise<void> {
  try {
    const { stream } = await b.client.event();
    for await (const sse of stream) {
      const data = sse.data;
      const id = extractSessionId(data);
      if (id !== null) {
        const q = queues.get(id);
        if (q) q.push(data);
      }
    }
  } catch {
    // fall through to crash handling
  }
  if (stopped) return;
  const now = Date.now();
  restartAt = restartAt.filter((t) => now - t < RESTART_WINDOW_MS);
  if (restartAt.length >= restartBackoffsMs.length) {
    for (const q of queues.values()) q.close();
    queues = new Map();
    backend = null;
    starting = null;
    return;
  }
  const delay = restartBackoffsMs[Math.min(restartAt.length, restartBackoffsMs.length - 1)]!;
  restartAt.push(now);
  backend = null;
  starting = null;
  await new Promise((r) => setTimeout(r, delay));
  // Lazy-restart on next getOpencodeClient call. Existing subscribers' queues
  // stay open and will receive events when the next opencode session emits them.
}

async function spawn(opts: { executablePath: string }): Promise<OpencodeBackend> {
  if (starting) return starting;
  starting = (async () => {
    const b = await factory(opts);
    backend = b;
    void readLoop(b);
    return b;
  })();
  return starting;
}

export async function getOpencodeClient(opts: {
  executablePath: string;
}): Promise<OpencodeBackendClient> {
  if (stopped) throw new Error("opencode_server_unavailable");
  if (backend) return backend.client;
  const b = await spawn(opts);
  return b.client;
}

export function subscribeSession(sessionId: string): AsyncIterable<unknown> {
  let q = queues.get(sessionId);
  if (!q) {
    q = makeQueue<unknown>();
    queues.set(sessionId, q);
  }
  return q.iterable();
}

export function unsubscribeSession(sessionId: string): void {
  const q = queues.get(sessionId);
  if (q) q.close();
  queues.delete(sessionId);
}

export async function shutdownOpencodeServer(): Promise<void> {
  stopped = true;
  for (const q of queues.values()) q.close();
  queues = new Map();
  if (backend) {
    const b = backend;
    backend = null;
    starting = null;
    try {
      await b.shutdown();
    } catch {
      /* swallow */
    }
  }
}

// Test hooks (NOT for production callers)
export function __setOpencodeFactoryForTests(f: OpencodeFactory): void {
  factory = f;
}
export function __setOpencodeBackoffsForTests(backoffs: readonly number[]): void {
  restartBackoffsMs = backoffs;
}
export function __resetOpencodeServerForTests(): void {
  stopped = false;
  backend = null;
  starting = null;
  queues = new Map();
  restartAt = [];
  factory = defaultFactory;
  restartBackoffsMs = RESTART_BACKOFFS_MS_DEFAULT;
}
