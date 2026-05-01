// packages/dalang/src/http/server.ts
import type { OrchestratorState } from "../types";
import { handleRequest, createRouteDeps } from "./routes";
import { renderDashboardHtml } from "./dashboard";
import { findRunningSession, renderSessionViewerHtml } from "./session-viewer";

export interface ServerOptions {
  state: OrchestratorState;
  refresh: () => Promise<void>;
  host?: string;
  port: number;
}

export interface ServerHandle {
  port: number;
  hostname: string;
  stop: () => void;
}

export function startServer(opts: ServerOptions): ServerHandle {
  const host = opts.host ?? "127.0.0.1";
  const deps = createRouteDeps(opts.state, opts.refresh);
  const server = Bun.serve({
    hostname: host,
    port: opts.port,
    fetch: async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/") {
        return new Response(renderDashboardHtml(opts.state), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      const sessionMatch = url.pathname.match(/^\/sessions\/([^/]+)$/);
      if (sessionMatch) {
        const id = decodeURIComponent(sessionMatch[1]!);
        const entry = findRunningSession(opts.state.running.values(), id);
        if (!entry) {
          return new Response("session not found", { status: 404 });
        }
        return new Response(await renderSessionViewerHtml(entry), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      return handleRequest(req, deps);
    },
  });
  return {
    port: server.port!,
    hostname: host,
    stop: () => {
      server.stop();
    },
  };
}
