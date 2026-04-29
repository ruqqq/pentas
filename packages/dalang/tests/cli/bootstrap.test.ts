// packages/dalang/tests/cli/bootstrap.test.ts
import { test, expect } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Bootstrap } from "../../src/cli/bootstrap";

const VALID = `---
tracker:
  endpoint: http://localhost:9999
  active_states: [Todo]
  terminal_states: [Done]
workspace:
  root: $WS_ROOT
agent:
  max_concurrent_agents: 1
---
Body for {{ issue.identifier }}.`;

test("loads workflow, validates, starts and stops cleanly", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dalang-boot-"));
  process.env.WS_ROOT = join(dir, "ws");
  const path = join(dir, "WORKFLOW.md");
  await writeFile(path, VALID, "utf8");
  const boot = new Bootstrap({ workflowPath: path, port: 0, skipAuthProbe: true,
    runQueryFactory: () => async function* () {
      yield { type: "system", subtype: "init", session_id: "s" };
      yield { type: "result", subtype: "success", usage: {} };
    },
  });
  await boot.start();
  expect(boot.serverPort()).toBeGreaterThan(0);
  await boot.stop();
});
