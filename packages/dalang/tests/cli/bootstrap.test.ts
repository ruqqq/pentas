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

test("ignores workflow reload that changes agent_provider", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dalang-boot-prov-"));
  process.env.WS_ROOT = join(dir, "ws");
  const path = join(dir, "WORKFLOW.md");
  // initial workflow uses default provider (claude) and interval_ms=30000 (default)
  await writeFile(path, VALID, "utf8");

  const warnings: Array<{ obj: unknown; msg: string }> = [];
  const fakeLog = {
    warn: (obj: unknown, msg: string) => { warnings.push({ obj, msg }); },
    info: () => {}, error: () => {}, debug: () => {}, trace: () => {}, fatal: () => {},
    child: () => fakeLog,
    level: "info",
  } as unknown as import("../../src/logging/logger").Logger;

  const boot = new Bootstrap({
    workflowPath: path, port: 0, skipAuthProbe: true,
    logger: fakeLog,
    runQueryFactory: () => async function* () {
      yield { type: "system", subtype: "init", session_id: "s" };
      yield { type: "result", subtype: "success", usage: {} };
    },
  });
  await boot.start();
  // Snapshot poll_interval_ms via /api/v1/state
  const baseUrl = `http://127.0.0.1:${boot.serverPort()}/api/v1/state`;
  const before = await fetch(baseUrl).then((r) => r.json()) as { poll_interval_ms: number };

  // Hot-edit: switch provider to codex AND change interval — both should be ignored.
  const NEXT = `---
tracker:
  endpoint: http://localhost:9999
  active_states: [Todo]
  terminal_states: [Done]
workspace:
  root: $WS_ROOT
agent:
  max_concurrent_agents: 1
agent_provider: codex
codex:
  executable_path: codex
polling:
  interval_ms: 12345
---
Body for {{ issue.identifier }}.`;
  // bump mtime forward so checkMtimeReload picks it up
  await new Promise((r) => setTimeout(r, 20));
  await writeFile(path, NEXT, "utf8");
  // Trigger reload via internal reloader
  await (boot as unknown as { reloader: { checkMtimeReload: () => Promise<void> } })
    .reloader.checkMtimeReload();

  const after = await fetch(baseUrl).then((r) => r.json()) as { poll_interval_ms: number };
  expect(after.poll_interval_ms).toBe(before.poll_interval_ms);

  const provWarn = warnings.find((w) => w.msg.includes("agent_provider"));
  expect(provWarn).toBeDefined();
  expect((provWarn!.obj as { from: string; to: string }).from).toBe("claude");
  expect((provWarn!.obj as { from: string; to: string }).to).toBe("codex");

  await boot.stop();
});
