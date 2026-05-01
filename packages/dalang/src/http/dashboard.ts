// packages/dalang/src/http/dashboard.ts
import type { OrchestratorState } from "../types";
import { sessionRefFor } from "./session-viewer";

export function renderDashboardHtml(state: OrchestratorState): string {
  const running = Array.from(state.running.values());
  const retrying = Array.from(state.retry_attempts.values());

  const rows = (cells: string[][]) =>
    cells.map((row) => `<tr>${row.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("");

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>dalang</title>
<style>
body { font: 14px system-ui, sans-serif; margin: 1rem; }
table { border-collapse: collapse; margin-bottom: 1rem; }
th, td { border: 1px solid #ccc; padding: 4px 8px; text-align: left; }
th { background: #f3f3f3; }
h1, h2 { margin: 0.5rem 0; }
</style></head><body>
<h1>dalang</h1>
<p>running=${running.length} retrying=${retrying.length} input_tokens=${state.claude_totals.input_tokens} output_tokens=${state.claude_totals.output_tokens} total_tokens=${state.claude_totals.total_tokens}</p>
<h2>Running</h2>
<table><thead><tr><th>Issue</th><th>State</th><th>Provider</th><th>Session</th><th>Turn</th><th>Last event</th></tr></thead>
<tbody>${rows(
    running.map((e) => {
      const session = sessionRefFor(e);
      return [
        `<a href="/sessions/${encodeURIComponent(e.issue.id)}">${escapeHtml(e.issue.identifier)}</a>`,
        escapeHtml(e.issue.state),
        escapeHtml(e.agent_provider),
        escapeHtml(session.session_id ?? "—"),
        escapeHtml(String(e.session?.turn_count ?? 0)),
        escapeHtml(e.session?.last_event ?? "—"),
      ];
    }),
  )}</tbody></table>
<h2>Retrying</h2>
<table><thead><tr><th>Issue</th><th>Attempt</th><th>Due</th><th>Error</th></tr></thead>
<tbody>${rows(
    retrying.map((r) => [
      escapeHtml(r.identifier),
      escapeHtml(String(r.attempt)),
      escapeHtml(new Date(r.due_at_ms).toISOString()),
      escapeHtml(r.error ?? "—"),
    ]),
  )}</tbody></table>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
