import { URLPattern } from "urlpattern-polyfill";
import type { Route } from "../api/server";

const ROOT = new URL("./public/", import.meta.url);

export function staticRoute(): Route {
  return {
    method: "GET",
    pattern: new URLPattern({ pathname: "/static/:rest+" }),
    handler: async (_req, match) => {
      const rel = match.pathname.groups.rest!;
      if (rel.includes("..")) return new Response("Not Found", { status: 404 });
      const file = Bun.file(new URL(rel, ROOT).pathname);
      if (!(await file.exists())) return new Response("Not Found", { status: 404 });
      return new Response(file);
    },
  };
}
