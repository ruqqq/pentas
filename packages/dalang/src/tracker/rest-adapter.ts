// packages/dalang/src/tracker/rest-adapter.ts
import type { NormalizedIssue, TrackerComment, TrackerHistoryEntry } from "../types";
import type { TrackerAdapter } from "./adapter";
import { TrackerError } from "./adapter";
import { normalizeIssue } from "./normalize";

export interface RestAdapterConfig {
  endpoint: string;
  apiKey: string | null;
  timeoutMs?: number;
}

interface IssuesPage {
  issues: unknown[];
  next_cursor: string | null;
}

export class RestTrackerAdapter implements TrackerAdapter {
  private readonly endpoint: string;
  private readonly apiKey: string | null;
  private readonly timeoutMs: number;

  constructor(cfg: RestAdapterConfig) {
    this.endpoint = cfg.endpoint.replace(/\/$/, "");
    this.apiKey = cfg.apiKey;
    this.timeoutMs = cfg.timeoutMs ?? 30000;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "accept": "application/json" };
    if (this.apiKey) h["authorization"] = `Bearer ${this.apiKey}`;
    return h;
  }

  private async getJson(path: string): Promise<unknown> {
    const url = `${this.endpoint}${path}`;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, { headers: this.headers(), signal: controller.signal });
    } catch (err) {
      throw new TrackerError("tracker_request_error", `${url}: ${(err as Error).message}`);
    } finally {
      clearTimeout(t);
    }
    if (!res.ok) {
      throw new TrackerError("tracker_status_error", `${url}: HTTP ${res.status}`);
    }
    try {
      return await res.json();
    } catch (err) {
      throw new TrackerError("tracker_malformed_payload", `${url}: ${(err as Error).message}`);
    }
  }

  private async fetchPaginated(stateParams: string[]): Promise<NormalizedIssue[]> {
    const out: NormalizedIssue[] = [];
    let cursor: string | null = null;
    do {
      const params = new URLSearchParams();
      for (const s of stateParams) params.append("state", s);
      if (cursor) params.append("cursor", cursor);
      const body = await this.getJson(`/api/v1/issues?${params.toString()}`);
      const page = this.assertPage(body);
      for (const raw of page.issues) {
        const norm = normalizeIssue(raw);
        if (norm) out.push(norm);
      }
      cursor = page.next_cursor;
    } while (cursor);
    return out;
  }

  private assertPage(body: unknown): IssuesPage {
    if (
      body === null ||
      typeof body !== "object" ||
      !Array.isArray((body as { issues?: unknown }).issues)
    ) {
      throw new TrackerError("tracker_malformed_payload", "expected { issues: [], next_cursor }");
    }
    const next = (body as { next_cursor?: unknown }).next_cursor;
    return {
      issues: (body as { issues: unknown[] }).issues,
      next_cursor: typeof next === "string" ? next : null,
    };
  }

  async fetchCandidateIssues(activeStates: string[]): Promise<NormalizedIssue[]> {
    return this.fetchPaginated(activeStates);
  }

  async fetchIssuesByStates(states: string[]): Promise<NormalizedIssue[]> {
    if (states.length === 0) return [];
    return this.fetchPaginated(states);
  }

  async fetchIssueStatesByIds(ids: string[]): Promise<NormalizedIssue[]> {
    if (ids.length === 0) return [];
    const params = new URLSearchParams();
    for (const id of ids) params.append("id", id);
    const body = await this.getJson(`/api/v1/issues/by-ids?${params.toString()}`);
    if (
      body === null ||
      typeof body !== "object" ||
      !Array.isArray((body as { issues?: unknown }).issues)
    ) {
      throw new TrackerError("tracker_malformed_payload", "by-ids: expected { issues: [] }");
    }
    const out: NormalizedIssue[] = [];
    for (const raw of (body as { issues: unknown[] }).issues) {
      const n = normalizeIssue(raw);
      if (n) out.push(n);
    }
    return out;
  }

  async fetchIssue(id: string): Promise<NormalizedIssue | null> {
    const body = await this.getJson(`/api/v1/issues/${encodeURIComponent(id)}`);
    return normalizeIssue(body);
  }

  async listComments(issueId: string): Promise<TrackerComment[]> {
    const path = `/api/v1/issues/${encodeURIComponent(issueId)}/comments`;
    const data = await this.getJson(path);
    if (typeof data !== "object" || data === null || !Array.isArray((data as { comments?: unknown }).comments)) {
      throw new TrackerError("tracker_malformed_payload", `${this.endpoint}${path}: comments not array`);
    }
    return (data as { comments: TrackerComment[] }).comments;
  }

  async listHistory(issueId: string): Promise<TrackerHistoryEntry[]> {
    const path = `/api/v1/issues/${encodeURIComponent(issueId)}/history`;
    const data = await this.getJson(path);
    if (typeof data !== "object" || data === null || !Array.isArray((data as { history?: unknown }).history)) {
      throw new TrackerError("tracker_malformed_payload", `${this.endpoint}${path}: history not array`);
    }
    return (data as { history: TrackerHistoryEntry[] }).history;
  }

  async addComment(issueId: string, body: string, author: "user" | "agent" = "agent"): Promise<void> {
    await this.writeJson(`/api/v1/issues/${encodeURIComponent(issueId)}/comments`, "POST", { body, author });
  }

  async updateState(issueId: string, state: string): Promise<void> {
    await this.writeJson(`/api/v1/issues/${encodeURIComponent(issueId)}`, "PATCH", { state });
  }

  private async writeJson(path: string, method: "POST" | "PATCH", payload: unknown): Promise<void> {
    const url = `${this.endpoint}${path}`;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: { ...this.headers(), "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      throw new TrackerError("tracker_write_error", `${url}: ${(err as Error).message}`);
    } finally {
      clearTimeout(t);
    }
    if (!res.ok) {
      throw new TrackerError("tracker_write_error", `${url}: HTTP ${res.status}`);
    }
  }
}
