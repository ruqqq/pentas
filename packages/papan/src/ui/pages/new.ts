import { layout, escapeHtml } from "../layout";
import { ALL_STATES } from "../../domain/issue";

export interface NewPageInput {
  error?: string;
  values?: { title?: string; description?: string; linear_url?: string; labels?: string };
}

export function renderNewPage({ error, values = {} }: NewPageInput): string {
  const stateOptions = ALL_STATES.map(
    (s) => `<option value="${s}"${s === "Todo" ? " selected" : ""}>${s}</option>`,
  ).join("");
  const body = `
${error ? `<div class="error">${escapeHtml(error)}</div>` : ""}
<form method="post" action="/new">
  <label>Paste Linear URL (optional)
    <input type="url" name="linear_url" value="${escapeHtml(values.linear_url ?? "")}" placeholder="https://linear.app/...">
  </label>
  <label>Title
    <input type="text" name="title" required value="${escapeHtml(values.title ?? "")}">
  </label>
  <label>Description (markdown)
    <textarea name="description">${escapeHtml(values.description ?? "")}</textarea>
  </label>
  <label>State
    <select name="state">${stateOptions}</select>
  </label>
  <label>Priority
    <select name="priority">
      <option value="">—</option>
      <option value="1">1 (highest)</option>
      <option value="2">2</option>
      <option value="3">3</option>
      <option value="4">4</option>
    </select>
  </label>
  <label>Labels (comma-separated)
    <input type="text" name="labels" value="${escapeHtml(values.labels ?? "")}">
  </label>
  <button type="submit">Create issue</button>
</form>`;
  return layout("New issue", body);
}
