import { describe, expect, test } from "bun:test";
import { parseChecks, summarise } from "../../src/control-plane/pr-checks";
import {
  countFailureComments,
  latestActionForSha,
  formatFailureComment,
  formatPassedComment,
  formatEscalatedComment,
  formatNoPrComment,
  formatRerunComment,
} from "../../src/control-plane/pr-checks";
import type { TrackerComment } from "../../src/types";

describe("parseChecks", () => {
  test("parses a gh pr checks --json result", () => {
    const json = JSON.stringify([
      { name: "build", state: "SUCCESS", bucket: "pass", link: "https://x/1" },
      { name: "test", state: "FAILURE", bucket: "fail", link: "https://x/2" },
    ]);
    const checks = parseChecks(json);
    expect(checks).toEqual([
      { name: "build", state: "SUCCESS", bucket: "pass", link: "https://x/1" },
      { name: "test", state: "FAILURE", bucket: "fail", link: "https://x/2" },
    ]);
  });

  test("rejects non-array JSON", () => {
    expect(() => parseChecks("{}")).toThrow();
  });

  test("coerces missing fields to defaults", () => {
    const json = JSON.stringify([{ name: "x" }]);
    const checks = parseChecks(json);
    expect(checks).toEqual([{ name: "x", state: "", bucket: "pending", link: "" }]);
  });
});

describe("summarise", () => {
  test("all pass → passed", () => {
    expect(summarise([{ name: "a", state: "S", bucket: "pass", link: "l" }])).toEqual({
      kind: "passed",
      failures: [],
    });
  });

  test("any pending and no fail → pending", () => {
    expect(
      summarise([
        { name: "a", state: "S", bucket: "pass", link: "l" },
        { name: "b", state: "Q", bucket: "pending", link: "l" },
      ]),
    ).toEqual({ kind: "pending", failures: [] });
  });

  test("any fail/cancel → failed with all failure entries", () => {
    const checks = [
      { name: "a", state: "F", bucket: "fail" as const, link: "l1" },
      { name: "b", state: "C", bucket: "cancel" as const, link: "l2" },
      { name: "c", state: "S", bucket: "pass" as const, link: "l3" },
    ];
    expect(summarise(checks)).toEqual({
      kind: "failed",
      failures: [
        { name: "a", state: "F", bucket: "fail", link: "l1" },
        { name: "b", state: "C", bucket: "cancel", link: "l2" },
      ],
    });
  });

  test("empty checks list → pending (PR exists but no checks yet)", () => {
    expect(summarise([])).toEqual({ kind: "pending", failures: [] });
  });
});

describe("countFailureComments", () => {
  test("counts comments tagged [pr_checks_failed]", () => {
    const comments: TrackerComment[] = [
      { id: "1", author: "agent", body: "[pr_checks_failed] sha=a attempt=1/3", created_at: "" },
      { id: "2", author: "user", body: "looks bad", created_at: "" },
      { id: "3", author: "agent", body: "[pr_checks_passed] sha=b", created_at: "" },
      { id: "4", author: "agent", body: "[pr_checks_failed] sha=c attempt=2/3", created_at: "" },
    ];
    expect(countFailureComments(comments)).toBe(2);
  });
});

describe("latestActionForSha", () => {
  test("returns the most recent tagged action for a given sha", () => {
    const comments: TrackerComment[] = [
      {
        id: "1",
        author: "agent",
        body: "[pr_checks_failed] sha=abc attempt=1/3",
        created_at: "2026-01-01T00:00:00Z",
      },
      {
        id: "2",
        author: "agent",
        body: "[pr_checks_rerun] sha=abc",
        created_at: "2026-01-01T00:01:00Z",
      },
      {
        id: "3",
        author: "agent",
        body: "[pr_checks_failed] sha=def attempt=2/3",
        created_at: "2026-01-01T00:02:00Z",
      },
    ];
    expect(latestActionForSha(comments, "abc")).toBe("rerun");
    expect(latestActionForSha(comments, "def")).toBe("failed");
    expect(latestActionForSha(comments, "ghi")).toBeNull();
  });

  test("ignores comments without a sha tag", () => {
    const comments: TrackerComment[] = [
      { id: "1", author: "agent", body: "[pr_checks_no_pr]", created_at: "2026-01-01T00:00:00Z" },
    ];
    expect(latestActionForSha(comments, "abc")).toBeNull();
  });

  test("matches full-length sha against short-sha tag in comment", () => {
    const fullSha = "abc1234567890abcdef0123456789012345678901";
    const comments: TrackerComment[] = [
      {
        id: "1",
        author: "agent",
        body: "[pr_checks_failed] sha=abc1234 attempt=1/3",
        created_at: "2026-01-01T00:00:00Z",
      },
    ];
    expect(latestActionForSha(comments, fullSha)).toBe("failed");
  });
});

describe("comment formatters", () => {
  test("formatFailureComment includes tag, attempt, and failures", () => {
    const body = formatFailureComment({
      sha: "abc1234567890",
      attempt: 1,
      budget: 3,
      failures: [{ name: "build", state: "F", bucket: "fail", link: "https://x/1" }],
    });
    expect(body).toContain("[pr_checks_failed] sha=abc1234 attempt=1/3");
    expect(body).toContain("- build: fail — https://x/1");
    expect(body).toContain("Bouncing back to In Dev");
  });

  test("formatPassedComment", () => {
    expect(formatPassedComment("abc1234567890")).toBe(
      "[pr_checks_passed] sha=abc1234\nAll checks passed. Ready for human review.",
    );
  });

  test("formatEscalatedComment includes attempt + failures", () => {
    const body = formatEscalatedComment({
      sha: "abc1234567890",
      attempt: 3,
      budget: 3,
      failures: [{ name: "build", state: "F", bucket: "fail", link: "https://x/1" }],
    });
    expect(body).toContain("[pr_checks_escalated] sha=abc1234 attempt=3/3");
    expect(body).toContain("Failure budget exhausted");
    expect(body).toContain("- build: fail — https://x/1");
  });

  test("formatNoPrComment names the branch when present and falls back when null", () => {
    expect(formatNoPrComment("feat/x")).toContain("branch feat/x");
    expect(formatNoPrComment(null)).toContain("(none set)");
  });

  test("formatRerunComment pluralises", () => {
    expect(formatRerunComment("abc1234567890", 1)).toContain("Re-triggered 1 failed check.");
    expect(formatRerunComment("abc1234567890", 2)).toContain("Re-triggered 2 failed checks.");
  });
});

import { decideAction } from "../../src/control-plane/pr-checks";

describe("decideAction", () => {
  const base = { budget: 3, rerunFlakes: true };

  test("no PR resolved → no_pr_bounce", () => {
    expect(decideAction({ ...base, prResolved: null, comments: [], summary: null })).toEqual({
      kind: "no_pr_bounce",
    });
  });

  test("pending → noop", () => {
    expect(
      decideAction({
        ...base,
        prResolved: { sha: "abc" },
        comments: [],
        summary: { kind: "pending", failures: [] },
      }),
    ).toEqual({ kind: "noop" });
  });

  test("passed and not yet acted on this sha → emit passed", () => {
    expect(
      decideAction({
        ...base,
        prResolved: { sha: "abc" },
        comments: [],
        summary: { kind: "passed", failures: [] },
      }),
    ).toEqual({ kind: "passed", sha: "abc" });
  });

  test("passed but already posted for this sha → noop", () => {
    expect(
      decideAction({
        ...base,
        prResolved: { sha: "abc" },
        comments: [
          {
            id: "1",
            author: "agent",
            body: "[pr_checks_passed] sha=abc",
            created_at: "2026-01-01T00:00:00Z",
          },
        ],
        summary: { kind: "passed", failures: [] },
      }),
    ).toEqual({ kind: "noop" });
  });

  test("failed first time on a sha and rerun_flakes → rerun", () => {
    expect(
      decideAction({
        ...base,
        prResolved: { sha: "abc" },
        comments: [],
        summary: {
          kind: "failed",
          failures: [{ name: "x", state: "F", bucket: "fail", link: "l" }],
        },
      }),
    ).toMatchObject({ kind: "rerun" });
  });

  test("failed and rerun already done for this sha → count failure", () => {
    const comments = [
      {
        id: "1",
        author: "agent",
        body: "[pr_checks_rerun] sha=abc",
        created_at: "2026-01-01T00:00:00Z",
      },
    ];
    expect(
      decideAction({
        ...base,
        prResolved: { sha: "abc" },
        comments,
        summary: {
          kind: "failed",
          failures: [{ name: "x", state: "F", bucket: "fail", link: "l" }],
        },
      }),
    ).toMatchObject({ kind: "failed_bounce", attempt: 1 });
  });

  test("failed under budget → failed_bounce", () => {
    const comments = [
      {
        id: "1",
        author: "agent",
        body: "[pr_checks_failed] sha=old1 attempt=1/3",
        created_at: "2026-01-01T00:00:00Z",
      },
      {
        id: "2",
        author: "agent",
        body: "[pr_checks_rerun] sha=abc",
        created_at: "2026-01-01T00:00:01Z",
      },
    ];
    const r = decideAction({
      ...base,
      prResolved: { sha: "abc" },
      comments,
      summary: { kind: "failed", failures: [{ name: "x", state: "F", bucket: "fail", link: "l" }] },
    });
    expect(r).toMatchObject({ kind: "failed_bounce", attempt: 2 });
  });

  test("failed at budget → escalate", () => {
    const comments = [
      {
        id: "1",
        author: "agent",
        body: "[pr_checks_failed] sha=a attempt=1/3",
        created_at: "2026-01-01T00:00:00Z",
      },
      {
        id: "2",
        author: "agent",
        body: "[pr_checks_failed] sha=b attempt=2/3",
        created_at: "2026-01-01T00:00:01Z",
      },
      {
        id: "3",
        author: "agent",
        body: "[pr_checks_rerun] sha=abc",
        created_at: "2026-01-01T00:00:02Z",
      },
    ];
    const r = decideAction({
      ...base,
      prResolved: { sha: "abc" },
      comments,
      summary: { kind: "failed", failures: [{ name: "x", state: "F", bucket: "fail", link: "l" }] },
    });
    expect(r).toMatchObject({ kind: "escalate", attempt: 3 });
  });

  test("failed but already bounced for this sha → noop (waiting for agent fix)", () => {
    const comments = [
      {
        id: "1",
        author: "agent",
        body: "[pr_checks_failed] sha=abc attempt=1/3",
        created_at: "2026-01-01T00:00:00Z",
      },
    ];
    expect(
      decideAction({
        ...base,
        prResolved: { sha: "abc" },
        comments,
        summary: {
          kind: "failed",
          failures: [{ name: "x", state: "F", bucket: "fail", link: "l" }],
        },
      }),
    ).toEqual({ kind: "noop" });
  });

  test("rerun_flakes=false → bounce immediately on first failure for sha", () => {
    expect(
      decideAction({
        budget: 3,
        rerunFlakes: false,
        prResolved: { sha: "abc" },
        comments: [],
        summary: {
          kind: "failed",
          failures: [{ name: "x", state: "F", bucket: "fail", link: "l" }],
        },
      }),
    ).toMatchObject({ kind: "failed_bounce", attempt: 1 });
  });

  test("dedupes correctly when prResolved.sha is a full git sha", () => {
    const fullSha = "abc1234567890abcdef0123456789012345678901";
    const comments = [
      {
        id: "1",
        author: "agent",
        body: "[pr_checks_passed] sha=abc1234",
        created_at: "2026-01-01T00:00:00Z",
      },
    ];
    expect(
      decideAction({
        budget: 3,
        rerunFlakes: true,
        prResolved: { sha: fullSha },
        comments,
        summary: { kind: "passed", failures: [] },
      }),
    ).toEqual({ kind: "noop" });
  });
});
