// packages/dalang/src/agent/agent-runner.ts
import type { NormalizedIssue, RuntimeEvent } from "../types";
import {
  buildFirstTurnPrompt,
  buildContinuationPrompt,
  type ControlPlanePromptContext,
  type RecentActivity,
} from "./prompt-builder";
import { mapSdkMessage } from "./event-mapper";
import { mapCodexEvent } from "./codex-event-mapper";
import { mapOpencodeEvent } from "./opencode-event-mapper";

export interface CommonAgentConfig {
  model: string;
  executablePath: string;
  turnTimeoutMs: number;
  readTimeoutMs: number;
  stallTimeoutMs: number;
  maxTurns: number;
}

export interface ClaudeAgentConfig extends CommonAgentConfig {
  provider: "claude";
  permissionMode: "auto" | "default" | "plan" | "bypassPermissions";
}

export interface CodexAgentConfig extends CommonAgentConfig {
  provider: "codex";
  sandboxMode: "read-only" | "workspace-write" | "danger-full-access";
  approvalPolicy: "untrusted" | "on-failure" | "on-request" | "never";
}

export interface OpencodeAgentConfig extends CommonAgentConfig {
  provider: "opencode";
}

export type AgentConfig = ClaudeAgentConfig | CodexAgentConfig | OpencodeAgentConfig;

interface CommonRunQueryOptions {
  prompt: string;
  cwd: string;
  model: string;
  executablePath: string;
  abortSignal?: AbortSignal;
  resumeSessionId?: string;
}

export type ClaudeRunQueryOptions = CommonRunQueryOptions & {
  claude: { permissionMode: ClaudeAgentConfig["permissionMode"] };
  codex?: never;
  opencode?: never;
};

export type CodexRunQueryOptions = CommonRunQueryOptions & {
  codex: {
    sandboxMode: CodexAgentConfig["sandboxMode"];
    approvalPolicy: CodexAgentConfig["approvalPolicy"];
  };
  claude?: never;
  opencode?: never;
};

export type OpencodeRunQueryOptions = CommonRunQueryOptions & {
  opencode: Record<string, never>;
  claude?: never;
  codex?: never;
};

export type RunQueryOptions = ClaudeRunQueryOptions | CodexRunQueryOptions | OpencodeRunQueryOptions;

export type RunQuery = (opts: RunQueryOptions) => AsyncIterable<unknown>;

export interface RunAttemptDeps {
  issue: NormalizedIssue;
  attempt: number | null;
  promptTemplate: string;
  workspacePath: string;
  config: AgentConfig;
  controlPlane: ControlPlanePromptContext;
  trackerRefresh: (id: string) => Promise<NormalizedIssue | null>;
  fetchRecentActivity?: (issue: NormalizedIssue) => Promise<RecentActivity>;
  isActiveState: (s: string) => boolean;
  runQuery: RunQuery;
  onEvent: (e: RuntimeEvent) => void;
  abortSignal?: AbortSignal;
}

export interface RunAttemptResult {
  success: boolean;
  reason?: string;
  thread_id: string | null;
  turn_count: number;
  tokens: { input_tokens: number; output_tokens: number; total_tokens: number };
}

export async function runAttempt(deps: RunAttemptDeps): Promise<RunAttemptResult> {
  let threadId: string | null = null;
  let turnCount = 0;
  const tokens = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  let issue = deps.issue;

  while (true) {
    turnCount += 1;
    let prompt: string;
    if (turnCount === 1) {
      const activity = deps.fetchRecentActivity
        ? await deps.fetchRecentActivity(issue).catch(() => ({ comments: [], history: [] }))
        : { comments: [], history: [] };
      prompt = await buildFirstTurnPrompt(deps.promptTemplate, issue, deps.attempt, deps.controlPlane, activity);
    } else {
      prompt = buildContinuationPrompt(issue, turnCount, deps.config.maxTurns);
    }

    const turn = await driveOneTurn({
      prompt,
      workspacePath: deps.workspacePath,
      config: deps.config,
      runQuery: deps.runQuery,
      onEvent: deps.onEvent,
      abortSignal: deps.abortSignal,
      resumeSessionId: threadId ?? undefined,
    });

    if (turn.thread_id) threadId = turn.thread_id;
    tokens.input_tokens += turn.tokens.input_tokens;
    tokens.output_tokens += turn.tokens.output_tokens;
    tokens.total_tokens += turn.tokens.total_tokens;

    if (!turn.success) {
      return { success: false, reason: turn.reason, thread_id: threadId, turn_count: turnCount, tokens };
    }

    const refreshed = await deps.trackerRefresh(issue.id).catch(() => null);
    if (!refreshed) break;
    issue = refreshed;
    if (!deps.isActiveState(issue.state)) break;
    if (turnCount >= deps.config.maxTurns) break;
  }

  return { success: true, thread_id: threadId, turn_count: turnCount, tokens };
}

interface DriveOneTurnOptions {
  prompt: string;
  workspacePath: string;
  config: AgentConfig;
  runQuery: RunQuery;
  onEvent: (e: RuntimeEvent) => void;
  abortSignal?: AbortSignal;
  resumeSessionId?: string;
}

interface DriveOneTurnResult {
  success: boolean;
  reason?: string;
  thread_id: string | null;
  tokens: { input_tokens: number; output_tokens: number; total_tokens: number };
}

async function driveOneTurn(opts: DriveOneTurnOptions): Promise<DriveOneTurnResult> {
  let threadId: string | null = null;
  const tokens = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  const turnAbort = new AbortController();
  const onAbort = () => turnAbort.abort();
  if (opts.abortSignal) opts.abortSignal.addEventListener("abort", onAbort, { once: true });

  const turnTimeout = setTimeout(() => turnAbort.abort(), opts.config.turnTimeoutMs);

  try {
    const baseOpts = {
      prompt: opts.prompt,
      cwd: opts.workspacePath,
      model: opts.config.model,
      executablePath: opts.config.executablePath,
      abortSignal: turnAbort.signal,
      ...(opts.resumeSessionId !== undefined ? { resumeSessionId: opts.resumeSessionId } : {}),
    };
    const queryOpts: RunQueryOptions =
      opts.config.provider === "claude"
        ? { ...baseOpts, claude: { permissionMode: opts.config.permissionMode } }
        : opts.config.provider === "codex"
          ? {
              ...baseOpts,
              codex: {
                sandboxMode: opts.config.sandboxMode,
                approvalPolicy: opts.config.approvalPolicy,
              },
            }
          : { ...baseOpts, opencode: {} };
    const iter = opts.runQuery(queryOpts);

    for await (const raw of iter) {
      if (turnAbort.signal.aborted) {
        return { success: false, reason: "turn_cancelled", thread_id: threadId, tokens };
      }
      const evt =
        opts.config.provider === "codex"    ? mapCodexEvent(raw) :
        opts.config.provider === "opencode" ? mapOpencodeEvent(raw) :
        mapSdkMessage(raw);
      if (!evt) continue;
      if (evt.event === "session_started" && evt.thread_id) threadId = evt.thread_id;
      if (evt.event === "turn_completed" && evt.usage) {
        tokens.input_tokens += evt.usage.input_tokens ?? 0;
        tokens.output_tokens += evt.usage.output_tokens ?? 0;
        tokens.total_tokens += evt.usage.total_tokens ?? 0;
      }
      opts.onEvent(evt);
      if (evt.event === "turn_completed") return { success: true, thread_id: threadId, tokens };
      if (evt.event === "turn_ended_with_error") return { success: false, reason: "turn_failed", thread_id: threadId, tokens };
      if (evt.event === "turn_input_required") return { success: false, reason: "turn_input_required", thread_id: threadId, tokens };
    }
    // If the outer abort signal is present, wait for any pending abort timer to fire
    // before deciding if this is a cancellation or a subprocess exit.
    if (opts.abortSignal && !opts.abortSignal.aborted) {
      await new Promise<void>((resolve) => {
        const done = () => resolve();
        opts.abortSignal!.addEventListener("abort", done, { once: true });
        // Fallback: resolve after a short window so we don't block forever
        setTimeout(() => { opts.abortSignal!.removeEventListener("abort", done); resolve(); }, 50);
      });
    }
    if (turnAbort.signal.aborted) {
      return { success: false, reason: "turn_cancelled", thread_id: threadId, tokens };
    }
    return { success: false, reason: "subprocess_exit", thread_id: threadId, tokens };
  } catch (err) {
    if (turnAbort.signal.aborted) return { success: false, reason: "turn_cancelled", thread_id: threadId, tokens };
    return { success: false, reason: "turn_failed", thread_id: threadId, tokens };
  } finally {
    clearTimeout(turnTimeout);
    if (opts.abortSignal) opts.abortSignal.removeEventListener("abort", onAbort);
  }
}
