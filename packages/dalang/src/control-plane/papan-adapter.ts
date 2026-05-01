// packages/dalang/src/control-plane/papan-adapter.ts
import type { ControlPlaneComment, ControlPlaneHistoryEntry, WorkItem } from "../types";
import { runPrChecksReconciler } from "./papan-pr-checks";
import type { ControlPlaneAdapter, DispatchQuery, PrChecksReconcileArgs } from "./adapter";
import { ControlPlaneError } from "./adapter";
import { normalizeWorkItem } from "./normalize";

export interface PapanControlPlaneConfig {
  endpoint: string;
  apiKey: string | null;
  board?: string | null;
  timeoutMs?: number;
}

interface IssuesPage {
  issues: unknown[];
  next_cursor: string | null;
}

export class PapanControlPlaneAdapter implements ControlPlaneAdapter {
  readonly capabilities = { history: true, prChecks: true } as const;
  private readonly endpoint: string;
  private readonly apiKey: string | null;
  private readonly board: string | null;
  private readonly timeoutMs: number;

  constructor(cfg: PapanControlPlaneConfig) {
    this.endpoint = cfg.endpoint.replace(/\/$/, "");
    this.apiKey = cfg.apiKey;
    this.board = cfg.board ?? null;
    this.timeoutMs = cfg.timeoutMs ?? 30000;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { accept: "application/json" };
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
      throw new ControlPlaneError(
        "control_plane_request_error",
        `${url}: ${(err as Error).message}`,
      );
    } finally {
      clearTimeout(t);
    }
    if (!res.ok) {
      throw new ControlPlaneError("control_plane_status_error", `${url}: HTTP ${res.status}`);
    }
    try {
      return await res.json();
    } catch (err) {
      throw new ControlPlaneError(
        "control_plane_malformed_payload",
        `${url}: ${(err as Error).message}`,
      );
    }
  }

  private withProject(path: string): string {
    if (!this.board) return path;
    const separator = path.includes("?") ? "&" : "?";
    return `${path}${separator}project=${encodeURIComponent(this.board)}`;
  }

  async fetchDispatchableWork(query: DispatchQuery): Promise<WorkItem[]> {
    const work = await this.fetchPaginated(query.activeStates);
    return work.filter((item) => matchesOwnership(item, query.ownership));
  }

  async fetchWorkByStates(states: string[]): Promise<WorkItem[]> {
    if (states.length === 0) return [];
    return this.fetchPaginated(states);
  }

  async refreshWork(ids: string[]): Promise<WorkItem[]> {
    if (ids.length === 0) return [];
    const params = new URLSearchParams();
    for (const id of ids) params.append("id", id);
    const body = await this.getJson(this.withProject(`/api/v1/issues/by-ids?${params.toString()}`));
    if (
      body === null ||
      typeof body !== "object" ||
      !Array.isArray((body as { issues?: unknown }).issues)
    ) {
      throw new ControlPlaneError(
        "control_plane_malformed_payload",
        "by-ids: expected { issues: [] }",
      );
    }
    const out: WorkItem[] = [];
    for (const raw of (body as { issues: unknown[] }).issues) {
      const n = normalizeWorkItem(raw);
      if (n) out.push(n);
    }
    return out;
  }

  async fetchWorkItem(id: string): Promise<WorkItem | null> {
    const body = await this.getJson(this.withProject(`/api/v1/issues/${encodeURIComponent(id)}`));
    return normalizeWorkItem(body);
  }

  async listComments(workItemId: string): Promise<ControlPlaneComment[]> {
    const path = this.withProject(`/api/v1/issues/${encodeURIComponent(workItemId)}/comments`);
    const data = await this.getJson(path);
    if (
      typeof data !== "object" ||
      data === null ||
      !Array.isArray((data as { comments?: unknown }).comments)
    ) {
      throw new ControlPlaneError(
        "control_plane_malformed_payload",
        `${this.endpoint}${path}: comments not array`,
      );
    }
    return (data as { comments: ControlPlaneComment[] }).comments;
  }

  async listHistory(workItemId: string): Promise<ControlPlaneHistoryEntry[]> {
    const path = this.withProject(`/api/v1/issues/${encodeURIComponent(workItemId)}/history`);
    const data = await this.getJson(path);
    if (
      typeof data !== "object" ||
      data === null ||
      !Array.isArray((data as { history?: unknown }).history)
    ) {
      throw new ControlPlaneError(
        "control_plane_malformed_payload",
        `${this.endpoint}${path}: history not array`,
      );
    }
    return (data as { history: ControlPlaneHistoryEntry[] }).history;
  }

  async addComment(
    workItemId: string,
    body: string,
    author: "user" | "agent" = "agent",
  ): Promise<void> {
    await this.writeJson(
      this.withProject(`/api/v1/issues/${encodeURIComponent(workItemId)}/comments`),
      "POST",
      { body, author },
    );
  }

  async updateState(workItemId: string, state: string): Promise<void> {
    await this.writeJson(
      this.withProject(`/api/v1/issues/${encodeURIComponent(workItemId)}`),
      "PATCH",
      {
        state,
      },
    );
  }

  async reconcilePrChecks(args: PrChecksReconcileArgs): Promise<void> {
    await runPrChecksReconciler({
      issues: args.work,
      polls: args.polls,
      controlPlane: this,
      cfg: {
        enabled: args.config.enabled,
        poll_interval_ms: args.config.poll_interval_ms,
        failure_budget: args.config.failure_budget,
        rerun_flakes: args.config.rerun_flakes,
        gh_executable: args.config.gh_executable ?? "gh",
        wait_state: args.config.wait_state,
        pass_state: args.config.pass_state,
        fail_state: args.config.fail_state,
        escalation_state: args.config.escalation_state,
      },
      cwd: args.repoCwd,
      now: args.now,
    });
  }

  private async fetchPaginated(stateParams: string[]): Promise<WorkItem[]> {
    const out: WorkItem[] = [];
    let cursor: string | null = null;
    do {
      const params = new URLSearchParams();
      for (const s of stateParams) params.append("state", s);
      if (cursor) params.append("cursor", cursor);
      const body = await this.getJson(this.withProject(`/api/v1/issues?${params.toString()}`));
      const page = this.assertPage(body);
      for (const raw of page.issues) {
        const norm = normalizeWorkItem(raw);
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
      throw new ControlPlaneError(
        "control_plane_malformed_payload",
        "expected { issues: [], next_cursor }",
      );
    }
    const next = (body as { next_cursor?: unknown }).next_cursor;
    return {
      issues: (body as { issues: unknown[] }).issues,
      next_cursor: typeof next === "string" ? next : null,
    };
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
      throw new ControlPlaneError("control_plane_write_error", `${url}: ${(err as Error).message}`);
    } finally {
      clearTimeout(t);
    }
    if (!res.ok) {
      throw new ControlPlaneError("control_plane_write_error", `${url}: HTTP ${res.status}`);
    }
  }
}

function matchesOwnership(item: WorkItem, ownership: DispatchQuery["ownership"]): boolean {
  if (ownership.mode === "none") return true;
  if (ownership.mode === "label") {
    const wanted = ownership.value.toLowerCase();
    return item.labels.some((label) => label.toLowerCase() === wanted);
  }
  return false;
}
