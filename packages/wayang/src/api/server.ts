import type { Database } from "bun:sqlite";
import type { URLPattern as PolyfillURLPattern } from "urlpattern-polyfill";

type URLPatternInstance = InstanceType<typeof PolyfillURLPattern>;
type URLPatternResult = NonNullable<ReturnType<URLPatternInstance["exec"]>>;
import { authMiddleware } from "./auth";
import { EventBus } from "../lib/sse";

export interface ServerOptions {
  db: Database;
  apiToken: string | undefined;
  port: number;
  hostname?: string;
}

export interface RunningServer {
  url: string;
  port: number;
  bus: EventBus;
  stop(): void;
}

export type RouteHandler = (
  req: Request,
  match: URLPatternResult,
  ctx: { db: Database; bus: EventBus },
) => Response | Promise<Response>;

export interface Route {
  method: string;
  pattern: URLPatternInstance;
  handler: RouteHandler;
}

export function startServer(opts: ServerOptions, routes: Route[]): RunningServer {
  const auth = authMiddleware(opts.apiToken);
  const bus = new EventBus();
  const ctx = { db: opts.db, bus };

  const server = Bun.serve({
    hostname: opts.hostname ?? "127.0.0.1",
    port: opts.port,
    async fetch(req) {
      const guard = auth(req);
      if (guard) return guard;

      for (const r of routes) {
        if (r.method !== req.method) continue;
        const match = r.pattern.exec(req.url);
        if (!match) continue;
        try {
          return await r.handler(req, match, ctx);
        } catch (err) {
          console.error("handler error", err);
          return Response.json(
            { error: { code: "internal_error", message: "unexpected error" } },
            { status: 500 },
          );
        }
      }
      return new Response("Not Found", { status: 404 });
    },
  });

  return {
    url: server.url.toString(),
    port: server.port!,
    bus,
    stop: () => server.stop(true),
  };
}
