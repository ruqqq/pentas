import { URLPattern } from "urlpattern-polyfill";
import type { Route } from "../api/server";
import styleCss from "./public/style.css" with { type: "file" };
import htmxJs from "./public/htmx.min.js" with { type: "file" };
import sseJs from "./public/sse.js" with { type: "file" };
import jsonEncJs from "./public/json-enc.js" with { type: "file" };

// Embedded so the compiled papan binary ships these assets. Keys are the
// public URL suffix (after /static/); values are the bundler-rewritten paths.
const ASSETS: Record<string, string> = {
  "style.css": styleCss,
  "htmx.min.js": htmxJs,
  "sse.js": sseJs,
  "json-enc.js": jsonEncJs,
};

export function staticRoute(): Route {
  return {
    method: "GET",
    pattern: new URLPattern({ pathname: "/static/:rest+" }),
    handler: async (_req, match) => {
      const rel = match.pathname.groups.rest!;
      const path = ASSETS[rel];
      if (path === undefined) return new Response("Not Found", { status: 404 });
      const file = Bun.file(path);
      if (!(await file.exists())) return new Response("Not Found", { status: 404 });
      return new Response(file);
    },
  };
}
