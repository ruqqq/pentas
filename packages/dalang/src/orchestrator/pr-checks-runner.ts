import type { TrackerAdapter } from "../tracker/adapter";
import type { NormalizedIssue, OrchestratorState } from "../types";
import { runGh } from "../lib/gh";
import {
  parseChecks,
  summarise,
  decideAction,
  formatFailureComment,
  formatPassedComment,
  formatEscalatedComment,
  formatNoPrComment,
  formatRerunComment,
} from "./pr-checks";

export interface PrChecksConfig {
  enabled: boolean;
  poll_interval_ms: number;
  failure_budget: number;
  rerun_flakes: boolean;
  gh_executable: string;
}

export interface ReconcilerArgs {
  issues: NormalizedIssue[];
  state: OrchestratorState;
  tracker: TrackerAdapter;
  cfg: PrChecksConfig;
  cwd: string;
  now: () => Date;
}

interface PrInfo {
  url: string;
  number: number;
  sha: string;
}

async function resolvePr(gh: string, branch: string, cwd: string): Promise<PrInfo | null> {
  const r = await runGh(
    gh,
    ["pr", "list", "--head", branch, "--state", "open", "--json", "url,number,headRefOid"],
    { cwd },
  );
  // If the subprocess failed AND produced no output, the binary is likely missing or broken.
  // Distinguish from "gh ran fine but found no PRs" (exit 0, stdout="[]").
  if (r.exitCode !== 0 && r.stdout.trim() === "") {
    throw new Error(`gh pr list failed: ${r.stderr}`);
  }
  try {
    const data = JSON.parse(r.stdout) as Array<{ url: string; number: number; headRefOid: string }>;
    if (!Array.isArray(data) || data.length === 0) return null;
    const first = data[0]!;
    return { url: first.url, number: first.number, sha: first.headRefOid };
  } catch {
    return null;
  }
}

async function fetchChecks(gh: string, prNumber: number, cwd: string): Promise<string> {
  const r = await runGh(
    gh,
    ["pr", "checks", String(prNumber), "--json", "name,state,bucket,link"],
    { cwd },
  );
  // gh pr checks exits non-zero when checks are failing — that's not a runner failure.
  // Only throw if exit was non-zero AND stdout is empty (real error).
  if (r.exitCode !== 0 && r.stdout.trim() === "") throw new Error(`gh pr checks failed: ${r.stderr}`);
  return r.stdout;
}

export async function runPrChecksReconciler(args: ReconcilerArgs): Promise<void> {
  if (!args.cfg.enabled) return;

  for (const issue of args.issues) {
    if (issue.state !== "Waiting PR Checks") continue;

    const cached = args.state.pr_checks_polls.get(issue.id);
    const nowMs = args.now().getTime();
    if (cached) {
      const lastMs = Date.parse(cached.last_polled_at);
      if (Number.isFinite(lastMs) && nowMs - lastMs < args.cfg.poll_interval_ms) continue;
    }

    const branch = issue.branch_name;
    let lastAction: "pending" | "rerun" | "failed" | "passed" | "escalated" | "no_pr" | null = null;
    let lastSeenSha: string | null = null;

    try {
      const pr = branch ? await resolvePr(args.cfg.gh_executable, branch, args.cwd) : null;

      let action;
      if (!pr) {
        action = { kind: "no_pr_bounce" as const };
      } else {
        lastSeenSha = pr.sha;
        const checksJson = await fetchChecks(args.cfg.gh_executable, pr.number, args.cwd);
        const checks = parseChecks(checksJson);
        const summary = summarise(checks);
        const comments = await args.tracker.listComments(issue.id);
        action = decideAction({
          budget: args.cfg.failure_budget,
          rerunFlakes: args.cfg.rerun_flakes,
          prResolved: { sha: pr.sha },
          comments,
          summary,
        });
      }

      switch (action.kind) {
        case "noop":
          lastAction = "pending";
          break;
        case "no_pr_bounce":
          await args.tracker.addComment(issue.id, formatNoPrComment(branch));
          await args.tracker.updateState(issue.id, "In Dev");
          lastAction = "no_pr";
          break;
        case "rerun":
          // TODO(v2): invoke `gh run rerun --failed <run-id>` for each failing check before posting this comment.
          await args.tracker.addComment(issue.id, formatRerunComment(action.sha, 1));
          lastAction = "rerun";
          break;
        case "failed_bounce":
          await args.tracker.addComment(
            issue.id,
            formatFailureComment({
              sha: action.sha,
              attempt: action.attempt,
              budget: args.cfg.failure_budget,
              failures: action.failures,
            }),
          );
          await args.tracker.updateState(issue.id, "In Dev");
          lastAction = "failed";
          break;
        case "escalate":
          await args.tracker.addComment(
            issue.id,
            formatEscalatedComment({
              sha: action.sha,
              attempt: action.attempt,
              budget: args.cfg.failure_budget,
              failures: action.failures,
            }),
          );
          await args.tracker.updateState(issue.id, "Ready for Human Review");
          lastAction = "escalated";
          break;
        case "passed":
          await args.tracker.addComment(issue.id, formatPassedComment(action.sha));
          await args.tracker.updateState(issue.id, "Ready for Human Review");
          lastAction = "passed";
          break;
      }
    } catch (err) {
      console.warn(`[pr-checks] error polling issue ${issue.id}:`, err);
      // Record the throttle entry with null action so we don't hammer on repeated failures.
      args.state.pr_checks_polls.set(issue.id, {
        last_polled_at: args.now().toISOString(),
        last_seen_sha: null,
        last_action: null,
      });
      continue;
    }

    args.state.pr_checks_polls.set(issue.id, {
      last_polled_at: args.now().toISOString(),
      last_seen_sha: lastSeenSha,
      last_action: lastAction,
    });
  }
}
