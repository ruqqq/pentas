import { escapeHtml } from "../layout";

export function renderStateBadge(state: string): string {
  const safe = escapeHtml(state);
  return `<span class="state-badge" data-state="${safe}">${safe}</span>`;
}
