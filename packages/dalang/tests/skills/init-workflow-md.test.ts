// packages/dalang/tests/skills/init-workflow-md.test.ts
import { expect, test } from "bun:test";

const rootSkillPath = new URL("../../../../.agents/skills/init-workflow-md/SKILL.md", import.meta.url);
const packageSkillPath = new URL("../../skills/init-workflow-md/SKILL.md", import.meta.url);

test("init-workflow-md is packaged as a generic repo-local agents skill", async () => {
  const rootSkill = Bun.file(rootSkillPath);

  expect(await rootSkill.exists()).toBe(true);
  expect(await Bun.file(packageSkillPath).exists()).toBe(false);

  const content = await rootSkill.text();
  expect(content).toContain("name: init-workflow-md");
  expect(content).toContain("control_plane:");
  expect(content).toContain("agent_provider:");
  expect(content).toContain("codex:");
  expect(content).toContain("opencode:");
  expect(content).toContain("Waiting PR Checks");
});
