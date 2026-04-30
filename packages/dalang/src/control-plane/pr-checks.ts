export type CheckBucket = "pass" | "fail" | "pending" | "cancel" | "skipping";

export interface Check {
  name: string;
  state: string;
  bucket: CheckBucket;
  link: string;
}

export interface Summary {
  kind: "passed" | "pending" | "failed";
  failures: Check[];
}

export function parseChecks(stdout: string): Check[] {
  const data: unknown = JSON.parse(stdout);
  if (!Array.isArray(data)) throw new Error("gh pr checks: expected JSON array");
  return data.map((c) => {
    const o = c as Record<string, unknown>;
    return {
      name: String(o.name ?? ""),
      state: String(o.state ?? ""),
      bucket: String(o.bucket ?? "pending") as CheckBucket,
      link: String(o.link ?? ""),
    };
  });
}

export function summarise(checks: Check[]): Summary {
  const failures = checks.filter((c) => c.bucket === "fail" || c.bucket === "cancel");
  if (failures.length > 0) return { kind: "failed", failures };
  const anyPending = checks.some((c) => c.bucket === "pending");
  if (anyPending || checks.length === 0) return { kind: "pending", failures: [] };
  return { kind: "passed", failures: [] };
}

import type { TrackerComment } from "../types";

export type ActionTag = "failed" | "passed" | "escalated" | "rerun" | "no_pr";

const TAG_REGEX = /^\[pr_checks_(failed|passed|escalated|rerun|no_pr)\](?:\s+sha=([a-f0-9]+))?/;

export function countFailureComments(comments: TrackerComment[]): number {
  return comments.filter((c) => c.body.startsWith("[pr_checks_failed]")).length;
}

export function latestActionForSha(comments: TrackerComment[], sha: string): ActionTag | null {
  const target = shortSha(sha);
  const sorted = [...comments].sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (let i = sorted.length - 1; i >= 0; i--) {
    const m = TAG_REGEX.exec(sorted[i]!.body);
    if (m && m[2] === target) return m[1] as ActionTag;
  }
  return null;
}

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

export function formatFailureComment(args: {
  sha: string;
  attempt: number;
  budget: number;
  failures: Check[];
}): string {
  const lines = [
    `[pr_checks_failed] sha=${shortSha(args.sha)} attempt=${args.attempt}/${args.budget}`,
  ];
  for (const f of args.failures) lines.push(`- ${f.name}: ${f.bucket} — ${f.link}`);
  lines.push("", "Bouncing back to In Dev. Read this comment and fix the failures.");
  return lines.join("\n");
}

export function formatPassedComment(sha: string): string {
  return `[pr_checks_passed] sha=${shortSha(sha)}\nAll checks passed. Ready for human review.`;
}

export function formatEscalatedComment(args: {
  sha: string;
  attempt: number;
  budget: number;
  failures: Check[];
}): string {
  const lines = [
    `[pr_checks_escalated] sha=${shortSha(args.sha)} attempt=${args.attempt}/${args.budget}`,
    "Failure budget exhausted. Parking for human review.",
  ];
  for (const f of args.failures) lines.push(`- ${f.name}: ${f.bucket} — ${f.link}`);
  return lines.join("\n");
}

export function formatNoPrComment(branchName: string | null): string {
  return `[pr_checks_no_pr]\nNo open PR found for branch ${branchName ?? "(none set)"}. Did the agent run \`gh pr create\`?`;
}

export function formatRerunComment(sha: string, count: number): string {
  return `[pr_checks_rerun] sha=${shortSha(sha)}\nRe-triggered ${count} failed check${count === 1 ? "" : "s"}.`;
}

export type Action =
  | { kind: "noop" }
  | { kind: "no_pr_bounce" }
  | { kind: "rerun"; sha: string }
  | { kind: "failed_bounce"; attempt: number; sha: string; failures: Check[] }
  | { kind: "escalate"; attempt: number; sha: string; failures: Check[] }
  | { kind: "passed"; sha: string };

export function decideAction(args: {
  budget: number;
  rerunFlakes: boolean;
  prResolved: { sha: string } | null;
  comments: TrackerComment[];
  summary: Summary | null;
}): Action {
  if (args.prResolved === null) return { kind: "no_pr_bounce" };
  const { sha } = args.prResolved;
  const summary = args.summary;
  if (!summary || summary.kind === "pending") return { kind: "noop" };

  const lastForThisSha = latestActionForSha(args.comments, sha);

  if (summary.kind === "passed") {
    if (lastForThisSha === "passed") return { kind: "noop" };
    return { kind: "passed", sha };
  }

  // failed branch
  if (lastForThisSha === "failed" || lastForThisSha === "escalated") return { kind: "noop" };
  if (args.rerunFlakes && lastForThisSha === null) return { kind: "rerun", sha };

  const priorFailures = countFailureComments(args.comments);
  const attempt = priorFailures + 1;
  if (attempt >= args.budget) {
    return { kind: "escalate", attempt, sha, failures: summary.failures };
  }
  return { kind: "failed_bounce", attempt, sha, failures: summary.failures };
}
