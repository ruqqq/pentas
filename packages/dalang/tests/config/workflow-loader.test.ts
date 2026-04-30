// packages/dalang/tests/config/workflow-loader.test.ts
import { test, expect } from "bun:test";
import { loadWorkflow, WorkflowError } from "../../src/config/workflow-loader";
import { validateForDispatch, ValidationError } from "../../src/config/validate";
import { mkdtemp, mkdir, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const fix = (n: string) => resolve(import.meta.dir, "../fixtures", n);

async function tempWorkflowDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "dalang-workflow-loader-"));
}

async function writeValidWorkflow(dir: string, body: string): Promise<string> {
  const path = join(dir, "WORKFLOW.md");
  await writeFile(path, `---\ntracker:\n  endpoint: http://localhost:3001\n---\n${body}`, "utf8");
  return path;
}

test("loads valid workflow with front matter and prompt body", async () => {
  const wf = await loadWorkflow(fix("workflow-valid.md"));
  expect(wf.config.tracker.kind).toBe("papan");
  expect(wf.config.control_plane.kind).toBe("papan");
  expect(wf.config.control_plane.active_states).toEqual(wf.config.tracker.active_states);
  expect(wf.promptTemplate).toContain("Work on");
  expect(wf.mtimeMs).toBeGreaterThan(0);
});

test("tracker-only missing api_key preserves legacy validation code through loader path", async () => {
  const dir = await tempWorkflowDir();
  const path = join(dir, "WORKFLOW.md");
  await writeFile(
    path,
    `---
tracker:
  endpoint: http://localhost:3001
  api_key: $MISSING_LEGACY_TRACKER_TOKEN_FOR_LOADER_TEST
  active_states: [Todo]
  terminal_states: [Done]
---
Body for {{ issue.identifier }}.`,
    "utf8",
  );
  delete process.env.MISSING_LEGACY_TRACKER_TOKEN_FOR_LOADER_TEST;

  const wf = await loadWorkflow(path);
  expect(() => validateForDispatch(wf.config)).toThrow(ValidationError);
  try {
    validateForDispatch(wf.config);
  } catch (err) {
    expect((err as ValidationError).code).toBe("missing_tracker_api_key");
  }
});

test("control_plane-only missing api_key preserves control_plane validation code through loader path", async () => {
  const dir = await tempWorkflowDir();
  const path = join(dir, "WORKFLOW.md");
  await writeFile(
    path,
    `---
control_plane:
  kind: papan
  endpoint: http://localhost:3001
  api_key: $MISSING_CONTROL_PLANE_TOKEN_FOR_LOADER_TEST
  active_states: [Todo]
  terminal_states: [Done]
  ownership:
    mode: none
---
Body for {{ issue.identifier }}.`,
    "utf8",
  );
  delete process.env.MISSING_CONTROL_PLANE_TOKEN_FOR_LOADER_TEST;

  const wf = await loadWorkflow(path);
  expect(() => validateForDispatch(wf.config)).toThrow(ValidationError);
  try {
    validateForDispatch(wf.config);
  } catch (err) {
    expect((err as ValidationError).code).toBe("missing_control_plane_api_key");
  }
});

test("rejects file with no front matter (front matter required for typed config)", async () => {
  await expect(loadWorkflow(fix("workflow-no-frontmatter.md"))).rejects.toThrow(WorkflowError);
});

test("rejects file with empty prompt body", async () => {
  await expect(loadWorkflow(fix("workflow-empty-prompt.md"))).rejects.toMatchObject({
    code: "workflow_empty_prompt",
  });
});

test("rejects malformed YAML front matter", async () => {
  await expect(loadWorkflow(fix("workflow-malformed.md"))).rejects.toMatchObject({
    code: "workflow_parse_error",
  });
});

test("rejects missing file", async () => {
  await expect(loadWorkflow(fix("nonexistent.md"))).rejects.toMatchObject({
    code: "missing_workflow_file",
  });
});

test("expands same-directory markdown imports before Liquid rendering", async () => {
  const dir = await tempWorkflowDir();
  await writeFile(join(dir, "preamble.md"), "Hello {{ issue.identifier }}", "utf8");
  const path = await writeValidWorkflow(dir, "@preamble.md\n\nWork on {{ issue.title }}");

  const wf = await loadWorkflow(path);

  expect(wf.promptTemplate).toBe("Hello {{ issue.identifier }}\n\nWork on {{ issue.title }}");
  expect(wf.importedPaths).toEqual([await realpath(join(dir, "preamble.md"))]);
});

test("expands nested relative imports from the importing file directory", async () => {
  const dir = await tempWorkflowDir();
  await mkdir(join(dir, "workflow", "states"), { recursive: true });
  await writeFile(join(dir, "workflow", "states", "plan.md"), "Plan state", "utf8");
  await writeFile(join(dir, "workflow", "index.md"), "Before\n@states/plan.md\nAfter", "utf8");
  const path = await writeValidWorkflow(dir, "@workflow/index.md");

  const wf = await loadWorkflow(path);

  expect(wf.promptTemplate).toBe("Before\nPlan state\nAfter");
  expect(wf.importedPaths).toEqual([
    await realpath(join(dir, "workflow", "index.md")),
    await realpath(join(dir, "workflow", "states", "plan.md")),
  ]);
});

test("rejects imports that resolve outside the workflow root", async () => {
  const dir = await tempWorkflowDir();
  const path = await writeValidWorkflow(dir, "@../outside.md");

  await expect(loadWorkflow(path)).rejects.toMatchObject({
    code: "workflow_import_error",
  });
});

test("rejects non-markdown and absolute imports", async () => {
  const dir = await tempWorkflowDir();
  await writeFile(join(dir, "secrets.txt"), "secret", "utf8");
  const nonMarkdown = await writeValidWorkflow(dir, "@secrets.txt");
  await expect(loadWorkflow(nonMarkdown)).rejects.toMatchObject({
    code: "workflow_import_error",
  });

  const absolute = await writeValidWorkflow(dir, "@/tmp/prompt.md");
  await expect(loadWorkflow(absolute)).rejects.toMatchObject({
    code: "workflow_import_error",
  });
});

test("rejects cyclic imports with an import error", async () => {
  const dir = await tempWorkflowDir();
  await writeFile(join(dir, "a.md"), "@b.md", "utf8");
  await writeFile(join(dir, "b.md"), "@a.md", "utf8");
  const path = await writeValidWorkflow(dir, "@a.md");

  await expect(loadWorkflow(path)).rejects.toMatchObject({
    code: "workflow_import_error",
  });
});
