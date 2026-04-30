// packages/dalang/src/tracker/normalize.ts
import type { BlockerRef, NormalizedIssue } from "../types";

function isString(v: unknown): v is string { return typeof v === "string"; }

function coerceLabels(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.filter(isString).map((s) => s.toLowerCase());
}

function coercePriority(input: unknown): number | null {
  if (typeof input !== "number") return null;
  if (!Number.isInteger(input)) return null;
  return input;
}

function coerceTimestamp(input: unknown): string | null {
  if (!isString(input)) return null;
  const t = Date.parse(input);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString();
}

function coerceBlockers(input: unknown): BlockerRef[] {
  if (!Array.isArray(input)) return [];
  const out: BlockerRef[] = [];
  for (const raw of input) {
    if (raw === null || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const id = isString(r.id) ? r.id : null;
    const identifier = isString(r.identifier) ? r.identifier : null;
    const state = isString(r.state) ? r.state : null;
    if (id === null && identifier === null) continue;
    out.push({ id, identifier, state });
  }
  return out;
}

/** Returns null if the issue is malformed (caller logs `tracker_malformed_payload`). */
export function normalizeIssue(raw: unknown): NormalizedIssue | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = isString(r.id) ? r.id : null;
  const identifier = isString(r.identifier) ? r.identifier : null;
  const title = isString(r.title) ? r.title : null;
  const state = isString(r.state) ? r.state : null;
  if (!id || !identifier || !title || !state) return null;
  return {
    id,
    identifier,
    title,
    description: isString(r.description) ? r.description : null,
    priority: coercePriority(r.priority),
    state,
    branch_name: isString(r.branch_name) ? r.branch_name : null,
    url: isString(r.url) ? r.url : null,
    external_ref: isString(r.external_ref) ? r.external_ref : null,
    labels: coerceLabels(r.labels),
    blocked_by: coerceBlockers(r.blocked_by),
    created_at: coerceTimestamp(r.created_at),
    updated_at: coerceTimestamp(r.updated_at),
  };
}
