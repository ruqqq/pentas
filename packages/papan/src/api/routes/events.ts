import { URLPattern } from "urlpattern-polyfill";
import type { Route } from "../server";

export function eventsRoute(): Route {
  return {
    method: "GET",
    pattern: new URLPattern({ pathname: "/api/v1/events" }),
    handler: (_req, _match, { bus }) => {
      const stream = new ReadableStream({
        start(controller) {
          const enc = new TextEncoder();
          const off = bus.subscribe((e) => {
            try {
              const payload = `event: ${e.name}\ndata: ${JSON.stringify(e.data)}\n\n`;
              controller.enqueue(enc.encode(payload));
            } catch {
              off();
            }
          });
          controller.enqueue(enc.encode(": connected\n\n"));
        },
      });

      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        },
      });
    },
  };
}
