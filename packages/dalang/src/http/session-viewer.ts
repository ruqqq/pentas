import { existsSync } from "node:fs";
import type { RuntimeEvent, RunningEntry } from "../types";
import { mapCodexEvent } from "../agent/codex-event-mapper";
import { mapSdkMessage } from "../agent/event-mapper";
import { mapOpencodeEvent } from "../agent/opencode-event-mapper";
import { transcriptPathFor } from "../agent/transcript";

const DEFAULT_MAX_LINES = 1000;

type Provider = RunningEntry["agent_provider"];

export interface SessionRef {
  issue_id: string;
  issue_identifier: string;
  provider: Provider;
  session_id: string | null;
  transcript_path: string | null;
}

export interface ParsedTranscriptLine {
  line: number;
  raw_type: string | null;
  timestamp: string | null;
  summary: string;
  runtime_event: RuntimeEvent | null;
  raw: unknown;
  parse_error?: string;
}

export interface TranscriptView {
  session: SessionRef;
  line_count: number;
  returned_count: number;
  truncated: boolean;
  events: ParsedTranscriptLine[];
}

export function sessionRefFor(entry: RunningEntry): SessionRef {
  const transcriptPath =
    entry.session?.transcript_path ??
    transcriptPathFor(entry.workspace_path, entry.session?.thread_id, entry.agent_provider);
  return {
    issue_id: entry.issue.id,
    issue_identifier: entry.issue.identifier,
    provider: entry.agent_provider,
    session_id: entry.session?.session_id ?? null,
    transcript_path: transcriptPath,
  };
}

export function findRunningSession(
  entries: Iterable<RunningEntry>,
  id: string,
): RunningEntry | null {
  for (const entry of entries) {
    if (
      entry.issue.id === id ||
      entry.issue.identifier === id ||
      entry.session?.session_id === id ||
      entry.session?.thread_id === id
    ) {
      return entry;
    }
  }
  return null;
}

export async function readTranscriptView(
  entry: RunningEntry,
  maxLines: number = DEFAULT_MAX_LINES,
): Promise<TranscriptView> {
  const session = sessionRefFor(entry);
  if (!session.transcript_path) {
    return {
      session,
      line_count: 0,
      returned_count: 0,
      truncated: false,
      events: [],
    };
  }
  if (!existsSync(session.transcript_path)) {
    throw new Error(`transcript path not found: ${session.transcript_path}`);
  }

  const text = await Bun.file(session.transcript_path).text();
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  const start = Math.max(0, lines.length - maxLines);
  const events = lines.slice(start).map((line, index) =>
    parseTranscriptLine(line, start + index + 1, entry.agent_provider),
  );
  return {
    session,
    line_count: lines.length,
    returned_count: events.length,
    truncated: start > 0,
    events,
  };
}

export async function renderSessionViewerHtml(entry: RunningEntry): Promise<string> {
  let view: TranscriptView;
  let error: string | null = null;
  try {
    view = await readTranscriptView(entry);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    view = {
      session: sessionRefFor(entry),
      line_count: 0,
      returned_count: 0,
      truncated: false,
      events: [],
    };
  }

  const rows = view.events
    .map((event) => {
      const runtime = event.runtime_event
        ? [event.runtime_event.event, event.runtime_event.message, event.runtime_event.reason]
            .filter((part): part is string => typeof part === "string" && part.length > 0)
            .join(": ")
        : "—";
      return `<tr>
<td>${event.line}</td>
<td>${escapeHtml(event.timestamp ?? "—")}</td>
<td>${escapeHtml(event.raw_type ?? "—")}</td>
<td>${escapeHtml(runtime)}</td>
<td><details><summary>${escapeHtml(event.summary)}</summary><pre>${escapeHtml(
        JSON.stringify(event.raw, null, 2),
      )}</pre></details></td>
</tr>`;
    })
    .join("");

  const apiPath = `/api/v1/sessions/${encodeURIComponent(view.session.issue_id)}/transcript`;
  const status = error
    ? `<p class="error">${escapeHtml(error)}</p>`
    : view.session.transcript_path
      ? `<p>${view.returned_count}/${view.line_count} lines${view.truncated ? " (tail)" : ""}</p>`
      : `<p class="empty">No transcript path is available for this session yet.</p>`;

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>dalang session</title>
<style>
body { font: 14px system-ui, sans-serif; margin: 1rem; color: #1f2328; }
a { color: #0969da; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid #d0d7de; padding: 5px 8px; text-align: left; vertical-align: top; }
th { background: #f6f8fa; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 36rem; overflow: auto; }
.meta { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; margin: 1rem 0; }
.error { color: #b42318; }
.empty { color: #57606a; }
</style></head><body>
<p><a href="/">Dashboard</a> · <a href="${apiPath}">JSON</a></p>
<h1>${escapeHtml(view.session.issue_identifier)}</h1>
<div class="meta">
<strong>provider</strong><span>${view.session.provider}</span>
<strong>session</strong><span>${escapeHtml(view.session.session_id ?? "—")}</span>
<strong>transcript</strong><span>${escapeHtml(view.session.transcript_path ?? "—")}</span>
</div>
${status}
<table><thead><tr><th>Line</th><th>Time</th><th>Raw type</th><th>Parsed event</th><th>Raw</th></tr></thead>
<tbody>${rows}</tbody></table>
</body></html>`;
}

export function parseTranscriptLine(
  line: string,
  lineNumber: number,
  provider: Provider,
): ParsedTranscriptLine {
  try {
    const raw = JSON.parse(line) as unknown;
    return {
      line: lineNumber,
      raw_type: rawType(raw),
      timestamp: rawTimestamp(raw),
      summary: summarizeRaw(raw),
      runtime_event: mapProviderEvent(provider, raw),
      raw,
    };
  } catch (err) {
    return {
      line: lineNumber,
      raw_type: null,
      timestamp: null,
      summary: "malformed jsonl line",
      runtime_event: null,
      raw: line,
      parse_error: err instanceof Error ? err.message : String(err),
    };
  }
}

function mapProviderEvent(provider: Provider, raw: unknown): RuntimeEvent | null {
  if (provider === "codex") return mapCodexEvent(raw);
  if (provider === "opencode") return mapOpencodeEvent(raw);
  return mapSdkMessage(raw);
}

function rawType(raw: unknown): string | null {
  if (!isRecord(raw)) return null;
  if (raw.type === "event_msg" && isRecord(raw.payload) && typeof raw.payload.type === "string") {
    return `event_msg:${raw.payload.type}`;
  }
  return typeof raw.type === "string" ? raw.type : null;
}

function rawTimestamp(raw: unknown): string | null {
  if (!isRecord(raw)) return null;
  for (const key of ["timestamp", "created_at", "time"]) {
    const value = raw[key];
    if (typeof value === "string" || typeof value === "number") return String(value);
  }
  return null;
}

function summarizeRaw(raw: unknown): string {
  if (!isRecord(raw)) return truncate(String(raw));
  const type = rawType(raw) ?? "unknown";
  const text = extractText(raw);
  return text ? `${type}: ${truncate(text)}` : type;
}

function extractText(raw: unknown): string | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.message === "string") return raw.message;
  if (isRecord(raw.payload)) {
    if (typeof raw.payload.message === "string") return raw.payload.message;
    if (typeof raw.payload.last_agent_message === "string") return raw.payload.last_agent_message;
  }
  if (isRecord(raw.properties) && isRecord(raw.properties.part)) {
    const part = raw.properties.part;
    if (typeof part.text === "string") return part.text;
    if (typeof part.tool === "string") return `tool:${part.tool}`;
  }
  if (isRecord(raw.message)) {
    const content = raw.message.content;
    if (Array.isArray(content)) {
      const parts = content
        .map((part) => {
          if (!isRecord(part)) return null;
          if (typeof part.text === "string") return part.text;
          if (typeof part.name === "string") return `tool:${part.name}`;
          return null;
        })
        .filter((part): part is string => part !== null);
      if (parts.length > 0) return parts.join(" ");
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function truncate(value: string, max: number = 500): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
