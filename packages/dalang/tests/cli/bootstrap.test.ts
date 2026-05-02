// packages/dalang/tests/cli/bootstrap.test.ts
import { test, expect } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Bootstrap, sandboxWorkerCommand } from "../../src/cli/bootstrap";

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

const runQueryFactory = () =>
  async function* () {
    yield { type: "system" as const, subtype: "init", session_id: "s" };
    yield { type: "result" as const, subtype: "success", usage: {} };
  };

test("sandboxWorkerCommand defaults to the baked bayang path inside the container", () => {
  expect(sandboxWorkerCommand()).toEqual(["/opt/dalang/bayang"]);
});

test("loads workflow, validates, starts and stops cleanly", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dalang-boot-"));
  process.env.WS_ROOT = join(dir, "ws");
  const path = join(dir, "WORKFLOW.md");
  await writeFile(path, VALID, "utf8");
  const boot = new Bootstrap({ workflowPath: path, port: 0, skipAuthProbe: true, runQueryFactory });
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
    warn: (obj: unknown, msg: string) => {
      warnings.push({ obj, msg });
    },
    info: () => {},
    error: () => {},
    debug: () => {},
    trace: () => {},
    fatal: () => {},
    child: () => fakeLog,
    level: "info",
  } as unknown as import("../../src/logging/logger").Logger;

  const boot = new Bootstrap({
    workflowPath: path,
    port: 0,
    skipAuthProbe: true,
    logger: fakeLog,
    runQueryFactory,
  });
  await boot.start();
  // Snapshot poll_interval_ms via /api/v1/state
  const baseUrl = `http://127.0.0.1:${boot.serverPort()}/api/v1/state`;
  const before = (await fetch(baseUrl).then((r) => r.json())) as { poll_interval_ms: number };

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
  // bump mtime forward so the reload check picks it up
  await new Promise((r) => setTimeout(r, 20));
  await writeFile(path, NEXT, "utf8");
  await boot.checkWorkflowReload();

  const after = (await fetch(baseUrl).then((r) => r.json())) as { poll_interval_ms: number };
  expect(after.poll_interval_ms).toBe(before.poll_interval_ms);

  const provWarn = warnings.find((w) => w.msg.includes("agent_provider"));
  expect(provWarn).toBeDefined();
  expect((provWarn!.obj as { from: string; to: string }).from).toBe("claude");
  expect((provWarn!.obj as { from: string; to: string }).to).toBe("codex");

  await boot.stop();
});

test("uses explicit papan control_plane endpoint and api_key in bootstrap adapter", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dalang-boot-control-plane-"));
  process.env.WS_ROOT = join(dir, "ws");
  const captured: { authHeader: string | null } = { authHeader: null };
  const papan = Bun.serve({
    port: 0,
    fetch: (req) => {
      captured.authHeader = req.headers.get("authorization");
      return Response.json({ issues: [], next_cursor: null });
    },
  });
  const path = join(dir, "WORKFLOW.md");
  const endpoint = `http://127.0.0.1:${papan.port}`;
  await writeFile(
    path,
    `---
control_plane:
  kind: papan
  endpoint: ${endpoint}
  api_key: control-plane-key
  active_states: [Todo]
  terminal_states: [Done]
tracker:
  endpoint: ${endpoint}
  api_key: control-plane-key
  active_states: [Todo]
  terminal_states: [Done]
workspace:
  root: $WS_ROOT
agent:
  max_concurrent_agents: 1
---
Body for {{ issue.identifier }}.`,
    "utf8",
  );

  const boot = new Bootstrap({
    workflowPath: path,
    port: 0,
    skipAuthProbe: true,
    runQueryFactory,
  });
  await boot.start();
  try {
    for (let i = 0; i < 20 && captured.authHeader === null; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(captured.authHeader).toBe("Bearer control-plane-key");
  } finally {
    await boot.stop();
    papan.stop();
  }
});

test("ignores workflow reload that changes control_plane config", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dalang-boot-cp-reload-"));
  process.env.WS_ROOT = join(dir, "ws");
  const papan = Bun.serve({
    port: 0,
    fetch: () => Response.json({ issues: [], next_cursor: null }),
  });
  const endpoint = `http://127.0.0.1:${papan.port}`;
  const path = join(dir, "WORKFLOW.md");
  await writeFile(
    path,
    `---
control_plane:
  kind: papan
  endpoint: ${endpoint}
  active_states: [Todo]
  terminal_states: [Done]
tracker:
  endpoint: ${endpoint}
  active_states: [Todo]
  terminal_states: [Done]
workspace:
  root: $WS_ROOT
agent:
  max_concurrent_agents: 1
---
Body for {{ issue.identifier }}.`,
    "utf8",
  );

  const warnings: Array<{ obj: unknown; msg: string }> = [];
  const fakeLog = {
    warn: (obj: unknown, msg: string) => {
      warnings.push({ obj, msg });
    },
    info: () => {},
    error: () => {},
    debug: () => {},
    trace: () => {},
    fatal: () => {},
    child: () => fakeLog,
    level: "info",
  } as unknown as import("../../src/logging/logger").Logger;

  const boot = new Bootstrap({
    workflowPath: path,
    port: 0,
    skipAuthProbe: true,
    logger: fakeLog,
    runQueryFactory,
  });
  await boot.start();
  try {
    const baseUrl = `http://127.0.0.1:${boot.serverPort()}/api/v1/state`;
    const before = (await fetch(baseUrl).then((r) => r.json())) as { poll_interval_ms: number };

    await new Promise((r) => setTimeout(r, 20));
    await writeFile(
      path,
      `---
control_plane:
  kind: papan
  endpoint: http://127.0.0.1:9
  active_states: [Todo]
  terminal_states: [Done]
tracker:
  endpoint: http://127.0.0.1:9
  active_states: [Todo]
  terminal_states: [Done]
workspace:
  root: $WS_ROOT
agent:
  max_concurrent_agents: 1
polling:
  interval_ms: 12345
---
Body for {{ issue.identifier }}.`,
      "utf8",
    );
    await boot.checkWorkflowReload();

    const after = (await fetch(baseUrl).then((r) => r.json())) as { poll_interval_ms: number };
    expect(after.poll_interval_ms).toBe(before.poll_interval_ms);
    expect(warnings.some((w) => w.msg.includes("control_plane config"))).toBe(true);
  } finally {
    await boot.stop();
    papan.stop();
  }
});

test("starts with github-projects control_plane through adapter factory", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dalang-boot-github-cp-"));
  process.env.WS_ROOT = join(dir, "ws");
  const path = join(dir, "WORKFLOW.md");
  await writeFile(
    path,
    `---
control_plane:
  kind: github-projects
  owner_type: organization
  owner: acme
  project_number: 1
  repository: acme/app
  token: literal-token
  status_field: Status
  active_states: [Todo]
  terminal_states: [Done]
  ownership:
    mode: none
    allow_unowned_dispatch: true
workspace:
  root: $WS_ROOT
agent:
  max_concurrent_agents: 1
---
Body for {{ issue.identifier }}.`,
    "utf8",
  );

  const boot = new Bootstrap({
    workflowPath: path,
    port: 0,
    skipAuthProbe: true,
    runQueryFactory,
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return Response.json({
      data: {
        organization: {
          projectV2: {
            id: "PVT_1",
            fields: {
              nodes: [
                {
                  __typename: "ProjectV2SingleSelectField",
                  id: "FIELD_STATUS",
                  name: "Status",
                  options: [
                    { id: "OPT_TODO", name: "Todo" },
                    { id: "OPT_DONE", name: "Done" },
                  ],
                },
              ],
            },
          },
        },
      },
    });
  }) as unknown as typeof fetch;
  try {
    await boot.start();
    expect(boot.serverPort()).toBeGreaterThan(0);
  } finally {
    globalThis.fetch = originalFetch;
    await boot.stop();
  }
});

test("fails startup when github-projects metadata probe fails", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dalang-boot-github-probe-"));
  process.env.WS_ROOT = join(dir, "ws");
  const path = join(dir, "WORKFLOW.md");
  await writeFile(
    path,
    `---
control_plane:
  kind: github-projects
  owner_type: organization
  owner: acme
  project_number: 1
  repository: acme/app
  token: literal-token
  status_field: Status
  active_states: [Todo]
  terminal_states: [Done]
  ownership:
    mode: none
    allow_unowned_dispatch: true
workspace:
  root: $WS_ROOT
agent:
  max_concurrent_agents: 1
---
Body for {{ issue.identifier }}.`,
    "utf8",
  );

  const boot = new Bootstrap({
    workflowPath: path,
    port: 0,
    skipAuthProbe: true,
    runQueryFactory,
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("bad", { status: 500 })) as unknown as typeof fetch;
  try {
    await expect(boot.start()).rejects.toMatchObject({ code: "control_plane_status_error" });
  } finally {
    globalThis.fetch = originalFetch;
    await boot.stop();
  }
});
