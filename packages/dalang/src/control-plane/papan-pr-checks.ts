import type { ControlPlaneAdapter, PrChecksPollEntry } from "./adapter";
import type { NormalizedIssue } from "../types";
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
  wait_state?: string | undefined;
  pass_state?: string | undefined;
  fail_state?: string | undefined;
  escalation_state?: string | undefined;
}

export interface ReconcilerArgs {
  issues: NormalizedIssue[];
  polls: Map<string, PrChecksPollEntry>;
  controlPlane: ControlPlaneAdapter;
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
  if (r.exitCode !== 0 && r.stdout.trim() === "")
    throw new Error(`gh pr checks failed: ${r.stderr}`);
  return r.stdout;
}

export async function runPrChecksReconciler(args: ReconcilerArgs): Promise<void> {
  if (!args.cfg.enabled) return;
  const waitState = args.cfg.wait_state ?? "Waiting PR Checks";
  const passState = args.cfg.pass_state ?? "Ready for Human Review";
  const failState = args.cfg.fail_state ?? "In Dev";
  const escalationState = args.cfg.escalation_state ?? "Ready for Human Review";

  for (const issue of args.issues) {
    if (issue.state !== waitState) continue;

    const cached = args.polls.get(issue.id);
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
        const comments = await args.controlPlane.listComments(issue.id);
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
          await args.controlPlane.addComment(issue.id, formatNoPrComment(branch));
          await args.controlPlane.updateState(issue.id, failState);
          lastAction = "no_pr";
          break;
        case "rerun":
          // TODO(v2): invoke `gh run rerun --failed <run-id>` for each failing check before posting this comment.
          await args.controlPlane.addComment(issue.id, formatRerunComment(action.sha, 1));
          lastAction = "rerun";
          break;
        case "failed_bounce":
          await args.controlPlane.addComment(
            issue.id,
            formatFailureComment({
              sha: action.sha,
              attempt: action.attempt,
              budget: args.cfg.failure_budget,
              failures: action.failures,
            }),
          );
          await args.controlPlane.updateState(issue.id, failState);
          lastAction = "failed";
          break;
        case "escalate":
          await args.controlPlane.addComment(
            issue.id,
            formatEscalatedComment({
              sha: action.sha,
              attempt: action.attempt,
              budget: args.cfg.failure_budget,
              failures: action.failures,
            }),
          );
          await args.controlPlane.updateState(issue.id, escalationState);
          lastAction = "escalated";
          break;
        case "passed": {
          // Flip the PR out of draft now that CI is green. Idempotent: gh pr ready
          // on an already-ready PR succeeds. If it fails we still proceed with the
          // state transition — the human can flip the PR manually.
          if (pr) {
            const ready = await runGh(args.cfg.gh_executable, ["pr", "ready", String(pr.number)], {
              cwd: args.cwd,
            });
            if (ready.exitCode !== 0) {
              console.warn(`[pr-checks] gh pr ready ${pr.number} failed: ${ready.stderr}`);
            }
          }
          await args.controlPlane.addComment(issue.id, formatPassedComment(action.sha));
          await args.controlPlane.updateState(issue.id, passState);
          lastAction = "passed";
          break;
        }
      }
    } catch (err) {
      console.warn(`[pr-checks] error polling issue ${issue.id}:`, err);
      // Record the throttle entry with null action so we don't hammer on repeated failures.
      args.polls.set(issue.id, {
        last_polled_at: args.now().toISOString(),
        last_seen_sha: null,
        last_action: null,
      });
      continue;
    }

    args.polls.set(issue.id, {
      last_polled_at: args.now().toISOString(),
      last_seen_sha: lastSeenSha,
      last_action: lastAction,
    });
  }
}
