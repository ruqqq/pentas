// packages/dalang/tests/agent/prompt-builder.test.ts
import { test, expect } from "bun:test";
import { buildFirstTurnPrompt, buildContinuationPrompt } from "../../src/agent/prompt-builder";
import type { NormalizedIssue } from "../../src/types";

const issue: NormalizedIssue = {
  id: "i_1", identifier: "JUARA-1", title: "Fix bug", description: "details",
  priority: 1, state: "Todo", branch_name: null, url: null, external_ref: null, internal_ref: null,
  labels: ["bug", "p1"], blocked_by: [],
  created_at: null, updated_at: null,
};

const tracker = { endpoint: "http://localhost:3002", api_key: null };

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
  const out = await buildFirstTurnPrompt(tpl, issue, null, { endpoint: "http://localhost:3002", api_key: "secret" });
  expect(out).toContain("PATCH http://localhost:3002/api/v1/issues/i_1 bearer=secret");
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

test("continuation prompt mentions identifier and turn number, omits original prompt", async () => {
  const out = buildContinuationPrompt(issue, 2, 20);
  expect(out).toContain("JUARA-1");
  expect(out).toContain("turn 2");
  expect(out).not.toContain("Body for");
});
