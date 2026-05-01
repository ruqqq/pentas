export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

import type { Project } from "../domain/project";
import { DEFAULT_PROJECT_SLUG } from "../domain/project";

export interface LayoutOptions {
  projects?: Project[];
  activeProject?: Project | null;
}

export function layout(title: string, body: string, opts: LayoutOptions = {}): string {
  const activeSlug = opts.activeProject?.slug ?? DEFAULT_PROJECT_SLUG;
  const projectLinks = (opts.projects ?? [])
    .map(
      (p) =>
        `<a href="/projects/${escapeHtml(p.slug)}"${p.slug === activeSlug ? ' aria-current="page"' : ""}>${escapeHtml(p.name)}</a>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · papan</title>
<link rel="stylesheet" href="/static/style.css">
<script src="/static/htmx.min.js" defer></script>
<script src="/static/sse.js" defer></script>
<script src="/static/json-enc.js" defer></script>
</head>
<body>
<header>
  <a href="/"><strong>papan</strong></a>
  <nav class="project-switcher">
    <a href="/projects">Projects</a>
    ${projectLinks}
  </nav>
  <a href="/projects/${escapeHtml(activeSlug)}/new">+ New issue</a>
</header>
<main hx-ext="sse" sse-connect="/api/v1/events">
${body}
</main>
</body>
</html>`;
}
