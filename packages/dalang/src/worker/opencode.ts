// packages/dalang/src/worker/opencode.ts
//
// Per-invocation opencode provider for the worker shim. Unlike opencode-server.ts
// (which manages a shared long-lived server for the dalang daemon), this module
// spawns a fresh opencode server for each invocation and tears it down on exit.
import type { WorkerInvocation } from "./protocol";

interface OpencodeClient {
  event: {
    subscribe(): Promise<{ stream: AsyncIterable<unknown> }>;
  };
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

function extractSessionId(raw: unknown): string | null {
  if (raw === null || typeof raw !== "object") return null;
  const e = raw as { type?: unknown; properties?: unknown };
  const props = e.properties as Record<string, unknown> | undefined;
  if (!props) return null;
  if (e.type === "session.created") {
    const info = props.info as { id?: unknown } | undefined;
    return info && typeof info.id === "string" ? info.id : null;
  }
  if (typeof props.sessionID === "string") return props.sessionID;
  const part = props.part as { sessionID?: unknown } | undefined;
  if (part && typeof part.sessionID === "string") return part.sessionID;
  return null;
}

export async function* runOpencode(
  inv: Extract<WorkerInvocation, { provider: "opencode" }>,
  abortSignal: AbortSignal,
): AsyncGenerator<unknown> {
  // executablePath is accepted but not used: the SDK always invokes `opencode`
  // from PATH (same behaviour as opencode-server.ts defaultFactory).
  const sdk = await import("@opencode-ai/sdk");
  const server = await sdk.createOpencodeServer({
    hostname: "127.0.0.1",
    port: 0,
    signal: abortSignal,
    timeout: 30_000,
  });

  try {
    const sdkClient = sdk.createOpencodeClient({ baseUrl: server.url });
    const client = sdkClient as unknown as OpencodeClient;

    const session = inv.resumeSessionId
      ? { data: { id: inv.resumeSessionId } }
      : await client.session.create({
          body: { directory: inv.cwd, permission: HARDCODED_PERMISSION },
        });
    const sessionId = session.data.id;

    const { providerID, modelID } = parseProviderModel(inv.model);

    // Subscribe to the event stream before sending the prompt to avoid
    // missing events that arrive while promptAsync is in flight.
    const { stream } = await client.event.subscribe();

    const promptPromise = client.session.promptAsync({
      path: { id: sessionId },
      body: {
        model: { providerID, modelID },
        parts: [{ type: "text", text: inv.prompt }],
        mode: "build",
      },
    });

    for await (const ev of stream) {
      if (abortSignal.aborted) break;
      const id = extractSessionId(ev);
      if (id !== null && id !== sessionId) continue;
      const e = ev as { type?: string };
      yield ev;
      if (e.type === "session.idle" || e.type === "session.error") break;
    }

    await promptPromise.catch(() => {});
  } finally {
    server.close();
  }
}
