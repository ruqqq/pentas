// packages/dalang/tests/e2e/pr-checks-e2e.test.ts
import { test, expect } from "bun:test";
import { mkdtemp, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Orchestrator } from "../../src/orchestrator/orchestrator";
import { RestTrackerAdapter } from "../../src/tracker/rest-adapter";
import { applyDefaults } from "../../src/config/schema";
import { runWayang } from "../../../wayang/src/main";
import type { NormalizedIssue } from "../../src/types";

async function ghStub(scriptBody: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "gh-stub-e2e-"));
  const path = join(dir, "gh");
  await writeFile(path, `#!/bin/sh\n${scriptBody}\n`);
  await chmod(path, 0o755);
  return path;
}

test("e2e: pr_checks reconciler bounces an issue back to In Dev with a comment", async () => {
  const wsRoot = await mkdtemp(join(tmpdir(), "dalang-e2e-"));
  const { server, db } = runWayang({ port: 0, dbPath: ":memory:" });

  try {
    // server.url ends with "/" per Bun's URL serialisation
    const baseUrl = server.url;

    // Create the issue via the wayang HTTP API in state "Waiting PR Checks".
    // We use external_ref for the human-readable identifier since the create route
    // auto-allocates the internal identifier.
    const createRes = await fetch(`${baseUrl}api/v1/issues`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "needs CI",
        state: "Waiting PR Checks",
        branch_name: "feat/e2e-1",
        external_ref: "TJ-E2E-1",
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as NormalizedIssue;
    const issueId = created.id;

    const stub = await ghStub(`
    case "$1 $2" in
      "pr list") echo '[{"url":"https://x/pr/1","number":1,"headRefOid":"abc1234567"}]' ;;
      "pr checks") echo '[{"name":"build","state":"FAILURE","bucket":"fail","link":"https://x/run/9"}]' ;;
    esac`);

    // Strip trailing slash for RestTrackerAdapter — it adds its own
    const endpointNoSlash = baseUrl.replace(/\/$/, "");
    const tracker = new RestTrackerAdapter({ endpoint: endpointNoSlash, apiKey: null });

    const cfg = applyDefaults({
      tracker: {
        endpoint: endpointNoSlash,
        active_states: ["Todo"],
        terminal_states: ["Done"],
      },
      workspace: { root: wsRoot },
      agent: { max_concurrent_agents: 1, max_turns: 1 },
      polling: { interval_ms: 1000 },
      pr_checks: {
        enabled: true,
        poll_interval_ms: 1,
        failure_budget: 3,
        rerun_flakes: false,
        gh_executable: stub,
      },
    });

    const orch = new Orchestrator({
      tracker,
      config: cfg,
      promptTemplate: "x",
      runQuery: async function* () {
        yield { type: "system", subtype: "init", session_id: "s" } as const;
        yield {
          type: "result",
          subtype: "success",
          usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
        } as const;
      },
    });

    await orch.tick();

    // Verify state is now "In Dev"
    const issueRes = await fetch(`${baseUrl}api/v1/issues/${issueId}`);
    expect(issueRes.status).toBe(200);
    const issue = (await issueRes.json()) as { state: string };
    expect(issue.state).toBe("In Dev");

    // Verify a [pr_checks_failed] comment was added by the agent author
    const commentsRes = await fetch(`${baseUrl}api/v1/issues/${issueId}/comments`);
    expect(commentsRes.status).toBe(200);
    const { comments } = (await commentsRes.json()) as {
      comments: { author: string; body: string }[];
    };
    const fail = comments.find((c) => c.body.startsWith("[pr_checks_failed]"));
    expect(fail).toBeDefined();
    expect(fail!.body).toContain("sha=abc1234");
    expect(fail!.author).toBe("agent");
  } finally {
    server.stop();
    db.close();
  }
});
