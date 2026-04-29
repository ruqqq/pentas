// packages/dalang/src/http/dashboard.ts
import type { OrchestratorState } from "../types";

export function renderDashboardHtml(state: OrchestratorState): string {
  const running = Array.from(state.running.values());
  const retrying = Array.from(state.retry_attempts.values());

  const rows = (cells: string[][]) => cells
    .map((row) => `<tr>${row.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`)
    .join("");

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
<table><thead><tr><th>Issue</th><th>State</th><th>Session</th><th>Turn</th><th>Last event</th></tr></thead>
<tbody>${rows(running.map((e) => [
  e.issue.identifier, e.issue.state,
  e.session?.session_id ?? "—", String(e.session?.turn_count ?? 0),
  e.session?.last_event ?? "—",
]))}</tbody></table>
<h2>Retrying</h2>
<table><thead><tr><th>Issue</th><th>Attempt</th><th>Due</th><th>Error</th></tr></thead>
<tbody>${rows(retrying.map((r) => [
  r.identifier, String(r.attempt),
  new Date(r.due_at_ms).toISOString(), r.error ?? "—",
]))}</tbody></table>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
