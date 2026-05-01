// packages/dalang/src/agent/opencode-runner.ts
import type { RunQuery, RunQueryOptions } from "./agent-runner";
import { getOpencodeClient, subscribeSession, unsubscribeSession } from "./opencode-server";

interface OpencodeClient {
  event(): Promise<unknown>;
  session: {
    create(args: {
      body: { directory: string; permission?: unknown };
    }): Promise<{ data: { id: string } }>;
    promptAsync(args: {
      path: { id: string };
      body: {
        model: { providerID: string; modelID: string };
        parts: Array<{ type: "text"; text: string }>;
        mode?: string;
      };
    }): Promise<unknown>;
  };
}

const HARDCODED_PERMISSION = {
  edit: "allow",
  bash: "allow",
  webfetch: "allow",
  doom_loop: "allow",
} as const;

function parseProviderModel(model: string): { providerID: string; modelID: string } {
  const slash = model.indexOf("/");
  if (slash <= 0 || slash === model.length - 1) {
    throw new Error(`opencode model "${model}" must be in providerID/modelID form`);
  }
  return { providerID: model.slice(0, slash), modelID: model.slice(slash + 1) };
}

export const opencodeRunQuery: RunQuery = (opts: RunQueryOptions) => {
  if (!opts.opencode) {
    throw new Error("opencodeRunQuery requires opts.opencode (provider mismatch)");
  }

  async function* iterate(): AsyncGenerator<unknown> {
    const { providerID, modelID } = parseProviderModel(opts.model);

    // For resume, register the session queue before spawning/accessing the
    // backend so no events are dropped if readLoop starts racing ahead.
    if (opts.resumeSessionId) {
      subscribeSession(opts.resumeSessionId);
    }

    const rawClient = await getOpencodeClient({ executablePath: opts.executablePath });
    const client = rawClient as unknown as OpencodeClient;

    let sessionId: string;
    if (opts.resumeSessionId) {
      sessionId = opts.resumeSessionId;
    } else {
      const created = await client.session.create({
        body: { directory: opts.cwd, permission: HARDCODED_PERMISSION },
      });
      sessionId = created.data.id;
    }

    // subscribeSession is idempotent — for resume this returns the same queue
    // created above; for create this registers the queue.
    const sub = subscribeSession(sessionId);

    // Register an abort listener that closes the per-session queue so that a
    // blocked queue.next() wakes up immediately with null (done), terminating
    // the for-await below without waiting for the next event to arrive.
    const onAbort = () => unsubscribeSession(sessionId);
    if (opts.abortSignal) {
      if (opts.abortSignal.aborted) {
        // Already aborted before we started iterating — bail out immediately.
        unsubscribeSession(sessionId);
        return;
      }
      opts.abortSignal.addEventListener("abort", onAbort, { once: true });
    }

    try {
      await client.session.promptAsync({
        path: { id: sessionId },
        body: {
          model: { providerID, modelID },
          parts: [{ type: "text", text: opts.prompt }],
          mode: "build",
        },
      });

      for await (const evt of sub) {
        yield evt;
      }
    } finally {
      if (opts.abortSignal) opts.abortSignal.removeEventListener("abort", onAbort);
      unsubscribeSession(sessionId);
    }
  }

  return iterate();
};
