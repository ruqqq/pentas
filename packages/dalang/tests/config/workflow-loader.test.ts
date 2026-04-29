// packages/dalang/tests/config/workflow-loader.test.ts
import { test, expect } from "bun:test";
import { loadWorkflow, WorkflowError } from "../../src/config/workflow-loader";
import { resolve } from "node:path";

const fix = (n: string) => resolve(import.meta.dir, "../fixtures", n);

test("loads valid workflow with front matter and prompt body", async () => {
  const wf = await loadWorkflow(fix("workflow-valid.md"));
  expect(wf.config.tracker.kind).toBe("tok-juara");
  expect(wf.promptTemplate).toContain("Work on");
  expect(wf.mtimeMs).toBeGreaterThan(0);
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
