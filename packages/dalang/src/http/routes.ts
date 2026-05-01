// packages/dalang/src/http/routes.ts
import type { OrchestratorState } from "../types";
import { buildStateSnapshot, buildIssueSnapshot } from "./snapshot";
import { findRunningSession, readTranscriptView } from "./session-viewer";

export interface RouteDeps {
  state: OrchestratorState;
  refresh: () => Promise<void>;
}

/**
 * Extends RouteDeps with in-flight coalescing for POST /api/v1/refresh.
 * Concurrent requests share one underlying tick; the second caller gets
 * coalesced: true in its response body.
 */
export interface CoalescingRouteDeps extends RouteDeps {
  /** Internal coalescing entry point consumed by handleRequest */
  _coalescedRefresh: () => Promise<{ coalesced: boolean }>;
}

export function createRouteDeps(
  state: OrchestratorState,
  rawRefresh: () => Promise<void>,
): CoalescingRouteDeps {
  let inflight: Promise<void> | null = null;

  function coalescedRefresh(): Promise<{ coalesced: boolean }> {
    if (inflight !== null) {
      return Promise.resolve({ coalesced: true });
    }
    const p = rawRefresh().finally(() => {
      if (inflight === p) inflight = null;
    });
    inflight = p;
    return Promise.resolve({ coalesced: false });
  }

  return {
    state,
    refresh: rawRefresh,
    _coalescedRefresh: coalescedRefresh,
  };
}

function envelope(code: string, message: string, status: number): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function json(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function handleRequest(req: Request, deps: RouteDeps): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method.toUpperCase();

  if (path === "/api/v1/state") {
    if (method !== "GET") return envelope("method_not_allowed", "use GET for /api/v1/state", 405);
    return json(buildStateSnapshot(deps.state));
  }

  if (path === "/api/v1/refresh") {
    if (method !== "POST")
      return envelope("method_not_allowed", "use POST for /api/v1/refresh", 405);
    const coalescing = deps as CoalescingRouteDeps;
    const { coalesced } =
      typeof coalescing._coalescedRefresh === "function"
        ? await coalescing._coalescedRefresh()
        : (() => {
            void deps.refresh().catch(() => {});
            return { coalesced: false };
          })();
    return json(
      {
        queued: true,
        coalesced,
        requested_at: new Date().toISOString(),
        operations: ["poll", "reconcile"],
      },
      202,
    );
  }

  const sessionTranscriptMatch = path.match(/^\/api\/v1\/sessions\/([^/]+)\/transcript$/);
  if (sessionTranscriptMatch) {
    if (method !== "GET")
      return envelope(
        "method_not_allowed",
        "use GET for /api/v1/sessions/:id/transcript",
        405,
      );
    const id = decodeURIComponent(sessionTranscriptMatch[1]!);
    const entry = findRunningSession(deps.state.running.values(), id);
    if (!entry) return envelope("session_not_found", `no running session for ${id}`, 404);
    const maxLines = parseMaxLines(url.searchParams.get("max_lines"));
    try {
      return json(await readTranscriptView(entry, maxLines));
    } catch (err) {
      return envelope(
        "transcript_unavailable",
        err instanceof Error ? err.message : String(err),
        404,
      );
    }
  }

  // /api/v1/:identifier
  const m = path.match(/^\/api\/v1\/([^/]+)$/);
  if (m) {
    if (method !== "GET")
      return envelope("method_not_allowed", "use GET for /api/v1/:identifier", 405);
    const identifier = decodeURIComponent(m[1]!);
    if (identifier === "state" || identifier === "refresh") {
      return envelope("not_found", `unknown route ${path}`, 404);
    }
    const snap = buildIssueSnapshot(deps.state, identifier);
    if (!snap) return envelope("issue_not_found", `no in-memory entry for ${identifier}`, 404);
    return json(snap);
  }

  return envelope("not_found", `unknown route ${path}`, 404);
}

function parseMaxLines(raw: string | null): number {
  if (!raw) return 1000;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1000;
  return Math.min(parsed, 5000);
}
