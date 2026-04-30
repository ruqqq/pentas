// packages/dalang/tests/workspace/workspace-manager.test.ts
import { test, expect } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceManager } from "../../src/workspace/workspace-manager";

async function tmpRoot(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "dalang-ws-"));
}

test("ensures sanitized directory exists with created_now=true on first call", async () => {
  const root = await tmpRoot();
  const wm = new WorkspaceManager({ root });
  const ws = await wm.ensureWorkspace("PENTAS/1");
  expect(ws.workspace_key).toBe("PENTAS_1");
  expect(ws.path).toBe(join(root, "PENTAS_1"));
  expect(ws.created_now).toBe(true);
  expect(existsSync(ws.path)).toBe(true);
});

test("reuses existing dir with created_now=false", async () => {
  const root = await tmpRoot();
  await mkdir(join(root, "PENTAS-1"), { recursive: true });
  const wm = new WorkspaceManager({ root });
  const ws = await wm.ensureWorkspace("PENTAS-1");
  expect(ws.created_now).toBe(false);
});

test("rejects when path collides with an existing non-directory", async () => {
  const root = await tmpRoot();
  await writeFile(join(root, "PENTAS-2"), "x");
  const wm = new WorkspaceManager({ root });
  await expect(wm.ensureWorkspace("PENTAS-2")).rejects.toMatchObject({
    code: "workspace_create_error",
  });
});

test("rejects path traversal attempt outside root", async () => {
  const root = await tmpRoot();
  const wm = new WorkspaceManager({ root });
  // Identifier "..something" sanitizes to "__something" (no traversal possible),
  // but explicit sanity check: path is always under root.
  const ws = await wm.ensureWorkspace("../escape");
  expect(ws.path.startsWith(root)).toBe(true);
});
