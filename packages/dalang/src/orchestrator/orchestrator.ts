// packages/dalang/src/orchestrator/orchestrator.ts
import { resolve } from "node:path";
import type { ControlPlaneAdapter } from "../control-plane/adapter";
import type { NormalizedIssue, OrchestratorState, RetryEntry, RunningEntry } from "../types";
import type { WorkflowFrontMatter } from "../config/schema";
import { createInitialState, addRunning, removeRunning, accumulateTokens } from "./state";
import { sortForDispatch, isEligible } from "./eligibility";
import { scheduleRetry, computeBackoffMs, releaseClaim, CONTINUATION_RETRY_MS } from "./retry";
import { detectStalls, classifyTrackerRefresh } from "./reconcile";
import { WorkspaceManager } from "../workspace/workspace-manager";
import { GitWorktreeManager } from "../workspace/git-worktree";
import { runHook, truncateLogged } from "../workspace/hooks";
import { runAttempt, type RunQuery, type AgentConfig } from "../agent/agent-runner";
import { transcriptPathFor } from "../agent/transcript";
import { expandPath, resolveGithubToken, resolveTrackerApiKey } from "../config/env-resolver";
import { ValidationError } from "../config/validate";
import { createLogger, type Logger } from "../logging/logger";

export interface OrchestratorOptions {
  controlPlane: ControlPlaneAdapter;
  config: WorkflowFrontMatter;
  promptTemplate: string;
  runQuery: RunQuery;
  logger?: Logger;
}

export class Orchestrator {
  state: OrchestratorState;
  private readonly controlPlane: ControlPlaneAdapter;
  private cfg: WorkflowFrontMatter;
  private promptTemplate: string;
  private readonly runQuery: RunQuery;
  private readonly workspaces: WorkspaceManager;
  private readonly worktrees: GitWorktreeManager | null;
  private readonly log: Logger;
  private inflight: Promise<void>[] = [];

  constructor(opts: OrchestratorOptions) {
    this.controlPlane = opts.controlPlane;
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
    this.validateControlPlaneCapabilities();
  }

  updateConfig(next: WorkflowFrontMatter, promptTemplate: string): void {
    this.validateControlPlaneCapabilities(next);
    this.cfg = next;
    this.promptTemplate = promptTemplate;
    this.state.poll_interval_ms = next.polling.interval_ms;
    this.state.max_concurrent_agents = next.agent.max_concurrent_agents;
  }

  async tick(): Promise<void> {
    await this.reconcile();

    const prChecksConfig = this.buildPrChecksConfig();
    if (prChecksConfig.enabled) {
      let waiting: NormalizedIssue[] = [];
      const waitState = prChecksConfig.wait_state ?? "Waiting PR Checks";
      const reconciliationStates = dedupeStates([
        waitState,
        ...(prChecksConfig.conflict_watch_state ? [prChecksConfig.conflict_watch_state] : []),
      ]);
      try {
        waiting = await this.controlPlane.fetchDispatchableWork({
          activeStates: reconciliationStates,
          ownership: this.cfg.control_plane.ownership,
        });
      } catch (err) {
        this.log.warn({ err: (err as Error).message }, "pr_checks fetch failed; skipping");
      }
      await this.controlPlane.reconcilePrChecks!({
        work: waiting,
        polls: this.state.pr_checks_polls,
        config: prChecksConfig,
        repoCwd: process.cwd(),
        now: () => new Date(),
      }).catch((err) => {
        this.log.warn({ err: (err as Error).message }, "pr_checks reconcile failed");
      });
    }

    let candidates: NormalizedIssue[] = [];
    try {
      candidates = await this.controlPlane.fetchDispatchableWork({
        activeStates: this.cfg.control_plane.active_states,
        ownership: this.cfg.control_plane.ownership,
      });
    } catch (err) {
      this.log.warn({ err: (err as Error).message }, "candidate fetch failed; skipping dispatch");
      return;
    }
    const sorted = sortForDispatch(candidates);
    for (const issue of sorted) {
      if (
        !isEligible(issue, this.state, {
          active: this.cfg.control_plane.active_states,
          terminal: this.cfg.control_plane.terminal_states,
          byState: this.cfg.agent.max_concurrent_agents_by_state,
        })
      )
        continue;
      this.dispatch(issue, null);
    }
  }

  private buildPrChecksConfig(cfg: WorkflowFrontMatter = this.cfg): {
    enabled: boolean;
    poll_interval_ms: number;
    failure_budget: number;
    rerun_flakes: boolean;
    gh_executable?: string | undefined;
    mark_pr_ready: boolean;
    wait_state?: string | undefined;
    pass_state?: string | undefined;
    fail_state?: string | undefined;
    escalation_state?: string | undefined;
    conflict_watch_state?: string | undefined;
    conflict_target_state?: string | undefined;
  } {
    if (cfg.control_plane.kind === "github-projects" && cfg.control_plane.pr_checks) {
      return {
        enabled: cfg.control_plane.pr_checks.enabled,
        poll_interval_ms: cfg.control_plane.pr_checks.poll_interval_ms,
        failure_budget: cfg.control_plane.pr_checks.failure_budget,
        rerun_flakes: cfg.control_plane.pr_checks.rerun_flakes,
        gh_executable: cfg.control_plane.pr_checks.gh_executable,
        mark_pr_ready: cfg.control_plane.pr_checks.mark_pr_ready,
        wait_state: cfg.control_plane.pr_checks.wait_state,
        pass_state: cfg.control_plane.pr_checks.pass_state,
        fail_state: cfg.control_plane.pr_checks.fail_state,
        escalation_state: cfg.control_plane.pr_checks.escalation_state,
        conflict_watch_state:
          cfg.control_plane.pr_checks.conflict_watch_state ?? "Ready for Human Review",
        conflict_target_state: cfg.control_plane.pr_checks.conflict_target_state ?? "Ready for Dev",
      };
    }
    return cfg.pr_checks;
  }

  private validateControlPlaneCapabilities(cfg: WorkflowFrontMatter = this.cfg): void {
    if (!this.buildPrChecksConfig(cfg).enabled) return;
    if (this.controlPlane.capabilities.prChecks && this.controlPlane.reconcilePrChecks) return;
    throw new ValidationError(
      "unsupported_control_plane_kind",
      `control plane ${cfg.control_plane.kind} does not support pr_checks`,
    );
  }

  private async reconcile(): Promise<void> {
    const stallTimeoutMs =
      this.cfg.agent_provider === "codex"
        ? this.cfg.codex!.stall_timeout_ms
        : this.cfg.agent_provider === "opencode"
          ? this.cfg.opencode!.stall_timeout_ms
          : this.cfg.claude!.stall_timeout_ms;
    const stalls = detectStalls(this.state, stallTimeoutMs);
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
      refreshed = await this.controlPlane.refreshWork(ids);
    } catch (err) {
      this.log.warn({ err: (err as Error).message }, "state refresh failed; keeping workers");
      return;
    }
    for (const next of refreshed) {
      const entry = this.state.running.get(next.id);
      if (!entry) continue;
      const cls = classifyTrackerRefresh(next, {
        active: this.cfg.control_plane.active_states,
        terminal: this.cfg.control_plane.terminal_states,
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

  private dispatch(issue: NormalizedIssue, attempt: number | null, resumeSessionId?: string): void {
    const controller = new AbortController();
    const entry: RunningEntry = {
      issue,
      identifier: issue.identifier,
      workspace_path: this.workspaces.pathFor(issue.identifier),
      agent_provider: this.cfg.agent_provider,
      started_at: new Date().toISOString(),
      abort_controller: controller,
      retry_attempt: attempt,
      session: null,
    };
    addRunning(this.state, issue.id, entry);
    this.log.info(
      {
        issue_id: issue.id,
        identifier: issue.identifier,
        state: issue.state,
        workspace_path: entry.workspace_path,
        retry_attempt: attempt,
      },
      "task picked up",
    );
    const work = this.runWorker(issue, attempt, controller, resumeSessionId).catch((err) => {
      this.log.error({ issue_id: issue.id, err: (err as Error).message }, "worker crashed");
    });
    this.inflight.push(work);
  }

  private async runWorker(
    issue: NormalizedIssue,
    attempt: number | null,
    controller: AbortController,
    resumeSessionId?: string,
  ): Promise<void> {
    const cwd = this.workspaces.pathFor(issue.identifier);
    const ws = await this.workspaces.ensureWorkspace(issue.identifier);
    if (this.worktrees) {
      const branch =
        issue.branch_name ??
        this.worktrees.branchName({
          externalRef: issue.external_ref,
          title: issue.title,
        });
      await this.worktrees.ensureWorktree(cwd, branch);
      await this.assertGitWorkspace(cwd);
    }
    const env = {
      WORKSPACE_PATH: cwd,
      ISSUE_ID: issue.id,
      ISSUE_IDENTIFIER: issue.identifier,
      ISSUE_STATE: issue.state,
      ATTEMPT: attempt === null ? "" : String(attempt),
    };
    if (ws.created_now && this.cfg.hooks.after_create) {
      await this.runHookLogged("after_create", this.cfg.hooks.after_create, cwd, env, issue);
    }
    if (this.cfg.hooks.before_run) {
      await this.runHookLogged("before_run", this.cfg.hooks.before_run, cwd, env, issue);
    }

    this.log.info(
      { issue_id: issue.id, identifier: issue.identifier, workspace_path: cwd, attempt },
      "spawning agent",
    );
    const result = await runAttempt({
      issue,
      attempt,
      promptTemplate: this.promptTemplate,
      workspacePath: cwd,
      controlPlane: this.buildControlPlanePromptContext(),
      config: this.buildAgentConfig(),
      trackerRefresh: async (id) => {
        const r = await this.controlPlane.refreshWork([id]).catch(() => []);
        return r[0] ?? null;
      },
      fetchRecentActivity: async (iss) => {
        const comments = await this.controlPlane.listComments(iss.id).catch((err) => {
          this.log.warn(
            { issue_id: iss.id, err: (err as Error).message },
            "control-plane comments fetch failed",
          );
          return [];
        });
        let history: Awaited<ReturnType<NonNullable<typeof this.controlPlane.listHistory>>> = [];
        if (this.controlPlane.capabilities.history && this.controlPlane.listHistory) {
          history = await this.controlPlane.listHistory(iss.id).catch((err) => {
            this.log.warn(
              { issue_id: iss.id, err: (err as Error).message },
              "control-plane history fetch failed",
            );
            return [];
          });
        }
        return { comments, history };
      },
      isActiveState: (s) =>
        this.cfg.control_plane.active_states.some((x) => x.toLowerCase() === s.toLowerCase()),
      runQuery: this.runQuery,
      onEvent: (e) => {
        const entry = this.state.running.get(issue.id);
        if (!entry) return;
        if (entry.session === null) {
          const transcriptPath = transcriptPathFor(
            entry.workspace_path,
            e.thread_id,
            entry.agent_provider,
          );
          entry.session = {
            session_id: e.thread_id ? `${e.thread_id}-1` : "?-1",
            thread_id: e.thread_id ?? "?",
            turn_id: "1",
            transcript_path: transcriptPath,
            claude_session_pid: null,
            last_event: e.event,
            last_event_at: e.timestamp,
            last_message: e.message ?? null,
            input_tokens: 0,
            output_tokens: 0,
            total_tokens: 0,
            last_reported_input_tokens: 0,
            last_reported_output_tokens: 0,
            last_reported_total_tokens: 0,
            turn_count: 1,
          };
          this.log.info(
            {
              issue_id: issue.id,
              identifier: issue.identifier,
              session_id: entry.session.session_id,
              transcript_path: transcriptPath,
            },
            "session started",
          );
        }
        // Once the SDK reveals a real session id (it's on every message but the
        // very first event we receive may not have been routed through us as a
        // system/init), upgrade the placeholder.
        if (e.thread_id && entry.session.thread_id !== e.thread_id) {
          entry.session.thread_id = e.thread_id;
          entry.session.session_id = `${e.thread_id}-1`;
          entry.session.transcript_path = transcriptPathFor(
            entry.workspace_path,
            e.thread_id,
            entry.agent_provider,
          );
          this.log.info(
            {
              issue_id: issue.id,
              identifier: issue.identifier,
              session_id: entry.session.session_id,
              transcript_path: entry.session.transcript_path,
            },
            "session started",
          );
        }
        if (!entry.session.transcript_path) {
          const transcriptPath = transcriptPathFor(
            entry.workspace_path,
            entry.session.thread_id,
            entry.agent_provider,
          );
          if (transcriptPath) {
            entry.session.transcript_path = transcriptPath;
            this.log.info(
              {
                issue_id: issue.id,
                identifier: issue.identifier,
                session_id: entry.session.session_id,
                transcript_path: transcriptPath,
              },
              "session transcript available",
            );
          }
        }
        if (e.usage) {
          entry.session.input_tokens += e.usage.input_tokens ?? 0;
          entry.session.output_tokens += e.usage.output_tokens ?? 0;
          entry.session.total_tokens += e.usage.total_tokens ?? 0;
        }
        entry.session.last_event = e.event;
        entry.session.last_event_at = e.timestamp;
        entry.session.last_message = e.message ?? null;
      },
      abortSignal: controller.signal,
      ...(resumeSessionId !== undefined ? { resumeSessionId } : {}),
    });

    accumulateTokens(this.state, result.tokens);
    if (this.cfg.hooks.after_run) {
      await this.runHookLogged("after_run", this.cfg.hooks.after_run, cwd, env, issue).catch(
        () => {},
      );
    }
    removeRunning(this.state, issue.id);

    if (result.success) {
      this.state.completed.add(issue.id);
      this.log.info(
        {
          issue_id: issue.id,
          identifier: issue.identifier,
          turn_count: result.turn_count,
          tokens: result.tokens,
        },
        "task completed",
      );
      scheduleRetry(this.state, {
        issue_id: issue.id,
        identifier: issue.identifier,
        attempt: 1,
        delayMs: CONTINUATION_RETRY_MS,
        error: null,
        workflowState: issue.state,
        resumeSessionId: null,
        onFire: (retry) => this.handleRetryFire(retry),
      });
    } else {
      const nextAttempt = (attempt ?? 0) + 1;
      const delay = computeBackoffMs(nextAttempt, this.cfg.agent.max_retry_backoff_ms);
      this.log.warn(
        {
          issue_id: issue.id,
          identifier: issue.identifier,
          reason: result.reason ?? "worker_failed",
          next_attempt: nextAttempt,
          retry_in_ms: delay,
        },
        "task failed; scheduling retry",
      );
      scheduleRetry(this.state, {
        issue_id: issue.id,
        identifier: issue.identifier,
        attempt: nextAttempt,
        delayMs: delay,
        error: result.reason ?? "worker_failed",
        workflowState: issue.state,
        resumeSessionId: result.thread_id,
        onFire: (retry) => this.handleRetryFire(retry),
      });
    }
  }

  private async handleRetryFire(retry: RetryEntry): Promise<void> {
    const issueId = retry.issue_id;
    const identifier = retry.identifier;
    let candidates: NormalizedIssue[] = [];
    try {
      candidates = await this.controlPlane.fetchDispatchableWork({
        activeStates: this.cfg.control_plane.active_states,
        ownership: this.cfg.control_plane.ownership,
      });
    } catch {
      const next = retry.attempt + 1;
      scheduleRetry(this.state, {
        issue_id: issueId,
        identifier,
        attempt: next,
        delayMs: computeBackoffMs(next, this.cfg.agent.max_retry_backoff_ms),
        error: "retry poll failed",
        workflowState: retry.workflow_state,
        resumeSessionId: retry.resume_session_id,
        onFire: (nextRetry) => this.handleRetryFire(nextRetry),
      });
      return;
    }
    const issue = candidates.find((c) => c.id === issueId);
    if (!issue) {
      await this.cleanupByIdentifier({ id: issueId, identifier, state: "" }).catch((err) => {
        this.log.warn(
          { issue_id: issueId, identifier, err: (err as Error).message },
          "post-completion cleanup failed",
        );
      });
      releaseClaim(this.state, issueId);
      return;
    }

    const isSuccessfulContinuation = retry.error === null && retry.resume_session_id === null;
    if (isSuccessfulContinuation && retry.workflow_state !== null) {
      if (issue.state.toLowerCase() === retry.workflow_state.toLowerCase()) {
        releaseClaim(this.state, issueId);
        this.log.warn(
          {
            issue_id: issueId,
            identifier: issue.identifier,
            state: issue.state,
          },
          "task completed but tracker state is unchanged; stopping continuation retry",
        );
        return;
      }
      this.state.completed.delete(issueId);
    }

    releaseClaim(this.state, issueId);
    if (
      !isEligible(issue, this.state, {
        active: this.cfg.control_plane.active_states,
        terminal: this.cfg.control_plane.terminal_states,
        byState: this.cfg.agent.max_concurrent_agents_by_state,
      })
    ) {
      const next = retry.attempt + 1;
      scheduleRetry(this.state, {
        issue_id: issueId,
        identifier: issue.identifier,
        attempt: next,
        delayMs: computeBackoffMs(next, this.cfg.agent.max_retry_backoff_ms),
        error: "no available orchestrator slots",
        workflowState: retry.workflow_state,
        resumeSessionId: retry.resume_session_id,
        onFire: (nextRetry) => this.handleRetryFire(nextRetry),
      });
      return;
    }
    const resumeSessionId =
      retry.workflow_state !== null && issue.state === retry.workflow_state
        ? (retry.resume_session_id ?? undefined)
        : undefined;
    this.dispatch(issue, retry.attempt, resumeSessionId);
  }

  private buildAgentConfig(): AgentConfig {
    const common = {
      maxTurns: this.cfg.agent.max_turns,
    };
    if (this.cfg.agent_provider === "codex") {
      if (!this.cfg.codex) throw new Error("codex block missing despite agent_provider=codex");
      return {
        provider: "codex",
        ...common,
        model: this.cfg.codex.model,
        executablePath: this.cfg.codex.executable_path,
        turnTimeoutMs: this.cfg.codex.turn_timeout_ms,
        readTimeoutMs: this.cfg.codex.read_timeout_ms,
        stallTimeoutMs: this.cfg.codex.stall_timeout_ms,
        sandboxMode: this.cfg.codex.sandbox_mode,
        approvalPolicy: this.cfg.codex.approval_policy,
        networkAccessEnabled: this.cfg.codex.network_access_enabled,
        env: this.buildCodexEnv(),
      };
    }
    if (this.cfg.agent_provider === "opencode") {
      if (!this.cfg.opencode)
        throw new Error("opencode block missing despite agent_provider=opencode");
      const oc = this.cfg.opencode;
      return {
        provider: "opencode",
        ...common,
        model: oc.model,
        executablePath: oc.executable_path,
        turnTimeoutMs: oc.turn_timeout_ms,
        readTimeoutMs: oc.read_timeout_ms,
        stallTimeoutMs: oc.stall_timeout_ms,
      };
    }
    if (!this.cfg.claude) throw new Error("claude block missing despite agent_provider=claude");
    return {
      provider: "claude",
      ...common,
      model: this.cfg.claude.model,
      executablePath: this.cfg.claude.executable_path,
      turnTimeoutMs: this.cfg.claude.turn_timeout_ms,
      readTimeoutMs: this.cfg.claude.read_timeout_ms,
      stallTimeoutMs: this.cfg.claude.stall_timeout_ms,
      permissionMode: this.cfg.claude.permission_mode,
    };
  }

  private async assertGitWorkspace(cwd: string): Promise<void> {
    const proc = Bun.spawn(["git", "status", "--short"], {
      cwd,
      stdout: "ignore",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    if (exitCode === 0) return;
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`workspace is not a usable git checkout at ${cwd}: ${stderr.trim()}`);
  }

  private buildCodexEnv(): Record<string, string> | undefined {
    if (this.cfg.control_plane.kind !== "github-projects") return undefined;
    const token = resolveGithubToken(this.cfg.control_plane.token);
    if (!token) return undefined;
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) env[key] = value;
    }
    env.GITHUB_TOKEN = token;
    env.GH_TOKEN = token;
    return env;
  }

  private buildControlPlanePromptContext(): {
    kind: string;
    endpoint: string;
    api_key: string | null;
  } {
    const cp = this.cfg.control_plane;
    if (cp.kind === "papan") {
      return {
        kind: "papan",
        endpoint: cp.endpoint,
        api_key: resolveTrackerApiKey(cp.api_key ?? null),
      };
    }
    return {
      kind: cp.kind,
      endpoint: "",
      api_key: null,
    };
  }

  private async cleanupWorkspace(entry: RunningEntry): Promise<void> {
    await this.cleanupByIdentifier({
      id: entry.issue.id,
      identifier: entry.issue.identifier,
      state: entry.issue.state,
    });
  }

  private async cleanupByIdentifier(opts: {
    id: string;
    identifier: string;
    state: string;
  }): Promise<void> {
    const cwd = this.workspaces.pathFor(opts.identifier);
    const env = {
      WORKSPACE_PATH: cwd,
      ISSUE_ID: opts.id,
      ISSUE_IDENTIFIER: opts.identifier,
      ISSUE_STATE: opts.state,
      ATTEMPT: "",
    };
    if (this.cfg.hooks.before_remove) {
      await this.runHookLogged("before_remove", this.cfg.hooks.before_remove, cwd, env, {
        id: opts.id,
        identifier: opts.identifier,
      }).catch(() => {});
    }
    if (this.worktrees) await this.worktrees.removeWorktree(cwd);
    else await this.workspaces.removeWorkspace(opts.identifier);
  }

  private async runHookLogged(
    name: "after_create" | "before_run" | "after_run" | "before_remove",
    script: string,
    cwd: string,
    env: Record<string, string>,
    issue: { id: string; identifier: string },
  ): Promise<void> {
    const startedAt = Date.now();
    this.log.info(
      { hook: name, issue_id: issue.id, identifier: issue.identifier, cwd },
      "running hook",
    );
    const result = await runHook({ name, script, cwd, env, timeoutMs: this.cfg.hooks.timeout_ms });
    const duration_ms = Date.now() - startedAt;
    if (result.skipped) return;
    if (result.ok) {
      this.log.info(
        { hook: name, issue_id: issue.id, identifier: issue.identifier, duration_ms },
        "hook completed",
      );
    } else {
      this.log.warn(
        {
          hook: name,
          issue_id: issue.id,
          identifier: issue.identifier,
          duration_ms,
          exit_code: result.exitCode ?? null,
          timed_out: result.timedOut ?? false,
          stderr: result.stderr ? truncateLogged(result.stderr) : undefined,
        },
        "hook failed",
      );
    }
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

function dedupeStates(states: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const state of states) {
    const key = state.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(state);
  }
  return out;
}

export { resolveTrackerApiKey } from "../config/env-resolver";
