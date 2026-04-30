export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · wayang</title>
<link rel="stylesheet" href="/static/style.css">
<script src="/static/htmx.min.js" defer></script>
<script src="/static/sse.js" defer></script>
<script src="/static/json-enc.js" defer></script>
</head>
<body>
<header>
  <a href="/"><strong>wayang</strong></a>
  <a href="/new">+ New issue</a>
</header>
<main hx-ext="sse" sse-connect="/api/v1/events">
${body}
</main>
</body>
</html>`;
}
