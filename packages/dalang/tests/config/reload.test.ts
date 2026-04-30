// packages/dalang/tests/config/reload.test.ts
import { test, expect } from "bun:test";
import { writeFile, mkdtemp, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { WorkflowReloader } from "../../src/config/reload";

const VALID = `---
tracker:
  endpoint: http://localhost:3001
  active_states: [Todo]
  terminal_states: [Done]
workspace:
  root: /tmp/dalang
---
Hello {{ issue.identifier }}.`;

const VALID_2 = VALID.replace("Hello", "Howdy");

const INVALID = `---
this: is: bad: [
---
body`;

async function makeFile(content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dalang-reload-"));
  const path = join(dir, "WORKFLOW.md");
  await writeFile(path, content, "utf8");
  return path;
}

test("loads initial workflow on start", async () => {
  const path = await makeFile(VALID);
  const reloader = new WorkflowReloader(path);
  await reloader.start();
  const wf = reloader.current();
  expect(wf.promptTemplate).toContain("Hello");
  await reloader.stop();
});

test("invalid reload keeps last-good config", async () => {
  const path = await makeFile(VALID);
  const reloader = new WorkflowReloader(path);
  await reloader.start();
  await writeFile(path, INVALID, "utf8");
  // bump mtime to ensure detection
  const future = Date.now() / 1000 + 5;
  await utimes(path, future, future);
  await reloader.checkMtimeReload();
  expect(reloader.current().promptTemplate).toContain("Hello"); // unchanged
  await reloader.stop();
});

test("valid reload swaps config", async () => {
  const path = await makeFile(VALID);
  const reloader = new WorkflowReloader(path);
  await reloader.start();
  await writeFile(path, VALID_2, "utf8");
  const future = Date.now() / 1000 + 5;
  await utimes(path, future, future);
  await reloader.checkMtimeReload();
  expect(reloader.current().promptTemplate).toContain("Howdy");
  await reloader.stop();
});

test("mtime polling reloads when an imported workflow file changes", async () => {
  const path = await makeFile(VALID.replace("Hello {{ issue.identifier }}.", "@prompt.md"));
  const dir = dirname(path);
  const importPath = join(dir, "prompt.md");
  await writeFile(importPath, "Hello {{ issue.identifier }}.", "utf8");

  const reloader = new WorkflowReloader(path);
  await reloader.start();
  expect(reloader.current().promptTemplate).toContain("Hello");

  await writeFile(importPath, "Howdy {{ issue.identifier }}.", "utf8");
  const future = Date.now() / 1000 + 5;
  await utimes(importPath, future, future);
  await reloader.checkMtimeReload();

  expect(reloader.current().promptTemplate).toContain("Howdy");
  await reloader.stop();
});
