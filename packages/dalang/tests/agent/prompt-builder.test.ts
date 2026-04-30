// packages/dalang/tests/agent/prompt-builder.test.ts
import { test, expect } from "bun:test";
import { buildFirstTurnPrompt, buildContinuationPrompt } from "../../src/agent/prompt-builder";
import type { NormalizedIssue, TrackerComment, TrackerHistoryEntry } from "../../src/types";

const issue: NormalizedIssue = {
  id: "i_1", identifier: "JUARA-1", title: "Fix bug", description: "details",
  priority: 1, state: "Todo", branch_name: null, url: null, external_ref: null, internal_ref: null,
  labels: ["bug", "p1"], blocked_by: [],
  created_at: null, updated_at: null,
};

const tracker = { kind: "wayang", endpoint: "http://localhost:3002", api_key: null };

test("first turn prepends issue metadata header", async () => {
  const out = await buildFirstTurnPrompt("Body for {{ issue.identifier }}", issue, null, tracker);
  expect(out).toContain("# Working on JUARA-1: Fix bug");
  expect(out).toContain("Body for JUARA-1");
});

test("first turn renders attempt variable", async () => {
  const out = await buildFirstTurnPrompt("Attempt: {{ attempt }}", issue, 3, tracker);
  expect(out).toContain("Attempt: 3");
});

test("first turn renders tracker endpoint and api_key", async () => {
  const tpl = "PATCH {{ tracker.endpoint }}/api/v1/issues/{{ issue.id }}{% if tracker.api_key %} bearer={{ tracker.api_key }}{% endif %}";
  const out = await buildFirstTurnPrompt(tpl, issue, null, {
    kind: "wayang",
    endpoint: "http://localhost:3002",
    api_key: "secret",
  });
  expect(out).toContain("PATCH http://localhost:3002/api/v1/issues/i_1 bearer=secret");
});

test("first turn exposes control_plane context", async () => {
  const tpl = "{{ control_plane.kind }} {{ control_plane.endpoint }}";
  const out = await buildFirstTurnPrompt(tpl, issue, null, {
    kind: "github-projects",
    endpoint: "",
    api_key: null,
  });
  expect(out).toContain("github-projects");
});

test("first turn fails on unknown variable", async () => {
  await expect(buildFirstTurnPrompt("{{ unknown_var }}", issue, null, tracker)).rejects.toThrow();
});

test("first turn fails on unknown filter", async () => {
  await expect(buildFirstTurnPrompt("{{ issue.title | bogus_filter }}", issue, null, tracker)).rejects.toThrow();
});

test("first turn iterates labels", async () => {
  const tpl = "{% for l in issue.labels %}[{{ l }}]{% endfor %}";
  const out = await buildFirstTurnPrompt(tpl, issue, null, tracker);
  expect(out).toContain("[bug][p1]");
});

test("first turn exposes recent_comments newest-first, capped to 5", async () => {
  const comments: TrackerComment[] = Array.from({ length: 7 }, (_, i) => ({
    id: `c${i + 1}`,
    author: i % 2 === 0 ? "agent" : "user",
    body: `body ${i + 1}`,
    created_at: `2026-01-0${i + 1}T00:00:00Z`,
  }));
  const tpl = "{% for c in recent_comments %}<{{ c.id }}:{{ c.author }}:{{ c.body }}>{% endfor %}";
  const out = await buildFirstTurnPrompt(tpl, issue, null, tracker, { comments, history: [] });
  // Newest first, only last 5 ids: c7 c6 c5 c4 c3
  expect(out).toContain("<c7:agent:body 7>");
  expect(out).toContain("<c3:agent:body 3>");
  expect(out).not.toContain("c2:");
  expect(out).not.toContain("c1:");
});

test("first turn exposes recent_history newest-first, capped to 5", async () => {
  const history: TrackerHistoryEntry[] = Array.from({ length: 6 }, (_, i) => ({
    id: `h${i + 1}`,
    issue_id: "i_1",
    kind: "state_changed",
    from_value: `S${i}`,
    to_value: `S${i + 1}`,
    actor: "agent",
    at: `2026-01-0${i + 1}T00:00:00Z`,
  }));
  const tpl = "{% for h in recent_history %}<{{ h.id }}:{{ h.kind }}:{{ h.from_value }}->{{ h.to_value }}>{% endfor %}";
  const out = await buildFirstTurnPrompt(tpl, issue, null, tracker, { comments: [], history });
  expect(out).toContain("<h6:state_changed:S5->S6>");
  expect(out).toContain("<h2:state_changed:S1->S2>");
  expect(out).not.toContain("<h1:");
});

test("first turn defaults recent_comments and recent_history to empty arrays", async () => {
  const tpl = "comments={{ recent_comments.size }} history={{ recent_history.size }}";
  const out = await buildFirstTurnPrompt(tpl, issue, null, tracker);
  expect(out).toContain("comments=0 history=0");
});

test("continuation prompt mentions identifier and turn number, omits original prompt", async () => {
  const out = buildContinuationPrompt(issue, 2, 20);
  expect(out).toContain("JUARA-1");
  expect(out).toContain("turn 2");
  expect(out).not.toContain("Body for");
});
