import type { ControlPlaneComment, WorkItem } from "../../types";
import type { PrChecksPollEntry } from "../adapter";
import {
  decideAction,
  formatEscalatedComment,
  formatFailureComment,
  formatNoPrComment,
  formatPassedComment,
  formatRerunComment,
  type Check,
  type Summary,
} from "../pr-checks";

export interface GithubCheck {
  name: string;
  state: string;
  bucket: "pass" | "fail" | "pending" | "skipping" | "cancel";
  link: string | null;
  runId?: number | null | undefined;
}

export interface GithubPullRequestRef {
  number: number;
  url: string;
  sha: string;
  nodeId?: string | null | undefined;
}

export type Mergeability = "conflicted" | "clean" | "unknown";

export interface GithubPrChecksArgs {
  work: WorkItem[];
  polls: Map<string, PrChecksPollEntry>;
  config: {
    enabled: boolean;
    poll_interval_ms: number;
    failure_budget: number;
    rerun_flakes: boolean;
    wait_state: string;
    pass_state: string;
    fail_state: string;
    escalation_state: string;
    conflict_watch_state?: string | undefined;
    conflict_target_state?: string | undefined;
  };
  now: () => Date;
  listComments: (id: string) => Promise<ControlPlaneComment[]>;
  addComment: (id: string, body: string) => Promise<void>;
  updateState: (id: string, state: string) => Promise<void>;
  resolvePullRequest: (work: WorkItem) => Promise<GithubPullRequestRef | null>;
  fetchChecks: (pr: GithubPullRequestRef) => Promise<GithubCheck[]>;
  fetchMergeability: (pr: GithubPullRequestRef) => Promise<Mergeability>;
  rerunFailedChecks: (pr: GithubPullRequestRef, checks: GithubCheck[]) => Promise<number>;
  markReady: (pr: GithubPullRequestRef) => Promise<void>;
}

function toCheck(c: GithubCheck): Check {
  return {
    name: c.name,
    state: c.state,
    bucket: c.bucket,
    link: c.link ?? "",
  };
}

function summaryFromGithubChecks(checks: GithubCheck[]): Summary {
  const normalised = checks.map(toCheck);
  const failures = normalised.filter((c) => c.bucket === "fail" || c.bucket === "cancel");
  if (failures.length > 0) return { kind: "failed", failures };
  const anyPending = normalised.some((c) => c.bucket === "pending");
  if (anyPending) return { kind: "pending", failures: [] };
  return { kind: "passed", failures: [] };
}

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

export function formatConflictComment(args: {
  sha: string;
  prNumber: number;
  targetState: string;
}): string {
  return [
    "[AGENT MESSAGE]",
    "",
    `[pr_conflicts_detected] sha=${shortSha(args.sha)}`,
    `PR #${args.prNumber} is currently conflicted with the base branch. Moving this item back to ${args.targetState} so the conflict can be resolved.`,
  ].join("\n");
}

function hasConflictCommentForSha(comments: ControlPlaneComment[], sha: string): boolean {
  const target = `[pr_conflicts_detected] sha=${shortSha(sha)}`;
  return comments.some((c) => c.body.includes(target));
}

export async function reconcileGithubPrChecks(args: GithubPrChecksArgs): Promise<void> {
  if (!args.config.enabled) return;

  for (const item of args.work) {
    const conflictWatchState = args.config.conflict_watch_state ?? "Ready for Human Review";
    const conflictTargetState = args.config.conflict_target_state ?? "Ready for Dev";
    if (item.state.toLowerCase() === conflictWatchState.toLowerCase()) {
      try {
        const pr = await args.resolvePullRequest(item);
        if (!pr) continue;
        const mergeability = await args.fetchMergeability(pr);
        if (mergeability !== "conflicted") continue;
        const comments = await args.listComments(item.id);
        if (!hasConflictCommentForSha(comments, pr.sha)) {
          await args.addComment(
            item.id,
            formatConflictComment({
              sha: pr.sha,
              prNumber: pr.number,
              targetState: conflictTargetState,
            }),
          );
        }
        await args.updateState(item.id, conflictTargetState);
      } catch {
        continue;
      }
      continue;
    }

    if (item.state.toLowerCase() !== args.config.wait_state.toLowerCase()) continue;
    const cached = args.polls.get(item.id);
    const nowMs = args.now().getTime();
    if (cached) {
      const lastMs = Date.parse(cached.last_polled_at);
      if (Number.isFinite(lastMs) && nowMs - lastMs < args.config.poll_interval_ms) continue;
    }

    const polledAt = args.now().toISOString();
    let lastAction: PrChecksPollEntry["last_action"] = null;
    let lastSeenSha: string | null = null;
    try {
      const pr = await args.resolvePullRequest(item);
      if (!pr) {
        await args.updateState(item.id, args.config.fail_state);
        await args.addComment(item.id, formatNoPrComment(item.branch_name));
        lastAction = "no_pr";
        continue;
      }

      lastSeenSha = pr.sha;
      const checks = await args.fetchChecks(pr);
      const comments = await args.listComments(item.id);
      const action = decideAction({
        budget: args.config.failure_budget,
        rerunFlakes: args.config.rerun_flakes,
        prResolved: { sha: pr.sha },
        comments,
        summary: summaryFromGithubChecks(checks),
      });

      if (action.kind === "noop") {
        lastAction = "pending";
      } else if (action.kind === "rerun") {
        const count = await args.rerunFailedChecks(
          pr,
          checks.filter((c) => c.bucket === "fail" || c.bucket === "cancel"),
        );
        await args.addComment(item.id, formatRerunComment(action.sha, count));
        lastAction = "rerun";
      } else if (action.kind === "failed_bounce") {
        await args.updateState(item.id, args.config.fail_state);
        await args.addComment(
          item.id,
          formatFailureComment({
            sha: action.sha,
            attempt: action.attempt,
            budget: args.config.failure_budget,
            failures: action.failures,
          }),
        );
        lastAction = "failed";
      } else if (action.kind === "escalate") {
        await args.updateState(item.id, args.config.escalation_state);
        await args.addComment(
          item.id,
          formatEscalatedComment({
            sha: action.sha,
            attempt: action.attempt,
            budget: args.config.failure_budget,
            failures: action.failures,
          }),
        );
        lastAction = "escalated";
      } else if (action.kind === "passed") {
        await args.markReady(pr).catch(() => {});
        await args.updateState(item.id, args.config.pass_state);
        await args.addComment(item.id, formatPassedComment(action.sha));
        lastAction = "passed";
      }
    } catch {
      lastAction = null;
    } finally {
      args.polls.set(item.id, {
        last_polled_at: polledAt,
        last_seen_sha: lastSeenSha,
        last_action: lastAction,
      });
    }
  }
}
