// packages/dalang/src/orchestrator/orchestrator.ts
import { resolve } from "node:path";
import type { TrackerAdapter } from "../tracker/adapter";
import type { NormalizedIssue, OrchestratorState, RunningEntry } from "../types";
import type { WorkflowFrontMatter } from "../config/schema";
import { createInitialState, addRunning, removeRunning, accumulateTokens } from "./state";
import { sortForDispatch, isEligible } from "./eligibility";
import { scheduleRetry, computeBackoffMs, releaseClaim, CONTINUATION_RETRY_MS } from "./retry";
import { detectStalls, classifyTrackerRefresh } from "./reconcile";
import { WorkspaceManager } from "../workspace/workspace-manager";
import { GitWorktreeManager } from "../workspace/git-worktree";
import { runHook } from "../workspace/hooks";
import { runAttempt, type RunQuery } from "../agent/agent-runner";
import { expandPath } from "../config/env-resolver";
import { resolveEnvValue } from "../config/env-resolver";
import { createLogger, type Logger } from "../logging/logger";

export interface OrchestratorOptions {
  tracker: TrackerAdapter;
  config: WorkflowFrontMatter;
  promptTemplate: string;
  runQuery: RunQuery;
  logger?: Logger;
}

export class Orchestrator {
  state: OrchestratorState;
  private readonly tracker: TrackerAdapter;
  private cfg: WorkflowFrontMatter;
  private promptTemplate: string;
  private readonly runQuery: RunQuery;
  private readonly workspaces: WorkspaceManager;
  private readonly worktrees: GitWorktreeManager | null;
  private readonly log: Logger;
  private inflight: Promise<void>[] = [];

  constructor(opts: OrchestratorOptions) {
    this.tracker = opts.tracker;
    this.cfg = opts.config;
    this.promptTemplate = opts.promptTemplate;
    this.runQuery = opts.runQuery;
    this.log = opts.logger ?? createLogger({ name: "dalang", level: "info" });
    const wsRoot = resolve(expandPath(opts.config.workspace.root));
    this.workspaces = new WorkspaceManager({ root: wsRoot });
    this.worktrees = opts.config.repo
      ? new GitWorktreeManager({
          workspaceRoot: wsRoot,
          repoUrl: opts.config.repo.url,
          defaultBranch: opts.config.repo.default_branch,
          branchPrefix: opts.config.repo.branch_prefix,
        })
      : null;
    this.state = createInitialState({
      poll_interval_ms: opts.config.polling.interval_ms,
      max_concurrent_agents: opts.config.agent.max_concurrent_agents,
    });
  }

  updateConfig(next: WorkflowFrontMatter, promptTemplate: string): void {
    this.cfg = next;
    this.promptTemplate = promptTemplate;
    this.state.poll_interval_ms = next.polling.interval_ms;
    this.state.max_concurrent_agents = next.agent.max_concurrent_agents;
  }

  async tick(): Promise<void> {
    await this.reconcile();
    let candidates: NormalizedIssue[] = [];
    try {
      candidates = await this.tracker.fetchCandidateIssues(this.cfg.tracker.active_states);
    } catch (err) {
      this.log.warn({ err: (err as Error).message }, "candidate fetch failed; skipping dispatch");
      return;
    }
    const sorted = sortForDispatch(candidates);
    for (const issue of sorted) {
      if (
        !isEligible(issue, this.state, {
          active: this.cfg.tracker.active_states,
          terminal: this.cfg.tracker.terminal_states,
          byState: this.cfg.agent.max_concurrent_agents_by_state,
        })
      ) continue;
      this.dispatch(issue, null);
    }
  }

  private async reconcile(): Promise<void> {
    const stalls = detectStalls(this.state, this.cfg.claude.stall_timeout_ms);
    for (const id of stalls) {
      const entry = this.state.running.get(id);
      if (entry) {
        entry.abort_controller.abort();
        this.log.warn({ issue_id: id }, "stall detected; aborting worker");
      }
    }
    const ids = Array.from(this.state.running.keys());
    if (ids.length === 0) return;
    let refreshed: NormalizedIssue[] = [];
    try {
      refreshed = await this.tracker.fetchIssueStatesByIds(ids);
    } catch (err) {
      this.log.warn({ err: (err as Error).message }, "state refresh failed; keeping workers");
      return;
    }
    for (const next of refreshed) {
      const entry = this.state.running.get(next.id);
      if (!entry) continue;
      const cls = classifyTrackerRefresh(next, {
        active: this.cfg.tracker.active_states,
        terminal: this.cfg.tracker.terminal_states,
      });
      if (cls.kind === "update_snapshot") entry.issue = next;
      else if (cls.kind === "terminate_with_cleanup") {
        entry.abort_controller.abort();
        await this.cleanupWorkspace(entry).catch(() => {});
      } else {
        entry.abort_controller.abort();
      }
    }
  }

  private dispatch(issue: NormalizedIssue, attempt: number | null): void {
    const controller = new AbortController();
    const entry: RunningEntry = {
      issue, identifier: issue.identifier,
      workspace_path: this.workspaces.pathFor(issue.identifier),
      started_at: new Date().toISOString(),
      abort_controller: controller,
      retry_attempt: attempt, session: null,
    };
    addRunning(this.state, issue.id, entry);
    const work = this.runWorker(issue, attempt, controller).catch((err) => {
      this.log.error({ issue_id: issue.id, err: (err as Error).message }, "worker crashed");
    });
    this.inflight.push(work);
  }

  private async runWorker(
    issue: NormalizedIssue,
    attempt: number | null,
    controller: AbortController,
  ): Promise<void> {
    const cwd = this.workspaces.pathFor(issue.identifier);
    const ws = await this.workspaces.ensureWorkspace(issue.identifier);
    if (this.worktrees) {
      const branch = this.worktrees.branchName(ws.workspace_key);
      await this.worktrees.ensureWorktree(cwd, branch);
    }
    const env = {
      WORKSPACE_PATH: cwd,
      ISSUE_ID: issue.id,
      ISSUE_IDENTIFIER: issue.identifier,
      ISSUE_STATE: issue.state,
      ATTEMPT: attempt === null ? "" : String(attempt),
    };
    if (ws.created_now && this.cfg.hooks.after_create) {
      await runHook({ name: "after_create", script: this.cfg.hooks.after_create, cwd, env, timeoutMs: this.cfg.hooks.timeout_ms });
    }
    if (this.cfg.hooks.before_run) {
      await runHook({ name: "before_run", script: this.cfg.hooks.before_run, cwd, env, timeoutMs: this.cfg.hooks.timeout_ms });
    }

    const result = await runAttempt({
      issue, attempt,
      promptTemplate: this.promptTemplate,
      workspacePath: cwd,
      config: {
        permissionMode: this.cfg.claude.permission_mode,
        model: this.cfg.claude.model,
        executablePath: this.cfg.claude.executable_path,
        turnTimeoutMs: this.cfg.claude.turn_timeout_ms,
        readTimeoutMs: this.cfg.claude.read_timeout_ms,
        stallTimeoutMs: this.cfg.claude.stall_timeout_ms,
        maxTurns: this.cfg.agent.max_turns,
      },
      trackerRefresh: async (id) => {
        const r = await this.tracker.fetchIssueStatesByIds([id]).catch(() => []);
        return r[0] ?? null;
      },
      isActiveState: (s) => this.cfg.tracker.active_states.some((x) => x.toLowerCase() === s.toLowerCase()),
      runQuery: this.runQuery,
      onEvent: (e) => {
        const entry = this.state.running.get(issue.id);
        if (!entry) return;
        if (entry.session === null) {
          entry.session = {
            session_id: e.thread_id ? `${e.thread_id}-1` : "?-1",
            thread_id: e.thread_id ?? "?", turn_id: "1",
            claude_session_pid: null, last_event: e.event,
            last_event_at: e.timestamp, last_message: e.message ?? null,
            input_tokens: 0, output_tokens: 0, total_tokens: 0,
            last_reported_input_tokens: 0, last_reported_output_tokens: 0, last_reported_total_tokens: 0,
            turn_count: 1,
          };
        }
        // Once the SDK reveals a real session id (it's on every message but the
        // very first event we receive may not have been routed through us as a
        // system/init), upgrade the placeholder.
        if (e.thread_id && entry.session.thread_id !== e.thread_id) {
          entry.session.thread_id = e.thread_id;
          entry.session.session_id = `${e.thread_id}-1`;
        }
        entry.session.last_event = e.event;
        entry.session.last_event_at = e.timestamp;
        entry.session.last_message = e.message ?? null;
      },
      abortSignal: controller.signal,
    });

    accumulateTokens(this.state, result.tokens);
    if (this.cfg.hooks.after_run) {
      await runHook({ name: "after_run", script: this.cfg.hooks.after_run, cwd, env, timeoutMs: this.cfg.hooks.timeout_ms })
        .catch(() => {});
    }
    removeRunning(this.state, issue.id);

    if (result.success) {
      this.state.completed.add(issue.id);
      scheduleRetry(this.state, {
        issue_id: issue.id, identifier: issue.identifier,
        attempt: 1, delayMs: CONTINUATION_RETRY_MS, error: null,
        onFire: () => this.handleRetryFire(issue.id),
      });
    } else {
      const nextAttempt = (attempt ?? 0) + 1;
      const delay = computeBackoffMs(nextAttempt, this.cfg.agent.max_retry_backoff_ms);
      scheduleRetry(this.state, {
        issue_id: issue.id, identifier: issue.identifier,
        attempt: nextAttempt, delayMs: delay, error: result.reason ?? "worker_failed",
        onFire: () => this.handleRetryFire(issue.id),
      });
    }
  }

  private async handleRetryFire(issueId: string): Promise<void> {
    let candidates: NormalizedIssue[] = [];
    try {
      candidates = await this.tracker.fetchCandidateIssues(this.cfg.tracker.active_states);
    } catch {
      const e = this.state.retry_attempts.get(issueId);
      const next = (e?.attempt ?? 1) + 1;
      scheduleRetry(this.state, {
        issue_id: issueId, identifier: e?.identifier ?? issueId,
        attempt: next, delayMs: computeBackoffMs(next, this.cfg.agent.max_retry_backoff_ms),
        error: "retry poll failed",
        onFire: () => this.handleRetryFire(issueId),
      });
      return;
    }
    const issue = candidates.find((c) => c.id === issueId);
    if (!issue) {
      releaseClaim(this.state, issueId);
      return;
    }
    if (!isEligible(issue, this.state, {
      active: this.cfg.tracker.active_states,
      terminal: this.cfg.tracker.terminal_states,
      byState: this.cfg.agent.max_concurrent_agents_by_state,
    })) {
      const e = this.state.retry_attempts.get(issueId);
      const next = (e?.attempt ?? 1) + 1;
      scheduleRetry(this.state, {
        issue_id: issueId, identifier: issue.identifier,
        attempt: next, delayMs: computeBackoffMs(next, this.cfg.agent.max_retry_backoff_ms),
        error: "no available orchestrator slots",
        onFire: () => this.handleRetryFire(issueId),
      });
      return;
    }
    this.dispatch(issue, this.state.retry_attempts.get(issueId)?.attempt ?? null);
  }

  private async cleanupWorkspace(entry: RunningEntry): Promise<void> {
    const cwd = entry.workspace_path;
    const env = {
      WORKSPACE_PATH: cwd, ISSUE_ID: entry.issue.id,
      ISSUE_IDENTIFIER: entry.issue.identifier, ISSUE_STATE: entry.issue.state,
      ATTEMPT: "",
    };
    if (this.cfg.hooks.before_remove) {
      await runHook({ name: "before_remove", script: this.cfg.hooks.before_remove, cwd, env, timeoutMs: this.cfg.hooks.timeout_ms })
        .catch(() => {});
    }
    if (this.worktrees) await this.worktrees.removeWorktree(cwd);
    else await this.workspaces.removeWorkspace(entry.issue.identifier);
  }

  /** Used by tests to await all background workers spawned during a tick. */
  async drainPendingForTest(): Promise<void> {
    while (this.inflight.length > 0) {
      const all = this.inflight.slice();
      this.inflight = [];
      await Promise.allSettled(all);
    }
  }
}

// Helper export so callers can resolve env-backed api_key
export function resolveTrackerApiKey(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.startsWith("$")) return resolveEnvValue(value);
  return value;
}
