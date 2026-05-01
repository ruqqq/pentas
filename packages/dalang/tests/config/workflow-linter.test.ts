import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { lintWorkflow } from "../../src/config/workflow-linter";

async function writeWorkflow(body: string, frontMatter = ""): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dalang-lint-"));
  const path = join(dir, "WORKFLOW.md");
  await writeFile(
    path,
    `---
${frontMatter}
---
${body}
`,
  );
  return path;
}

test("lint accepts known prompt context fields", async () => {
  const path = await writeWorkflow(`
{{ issue.identifier }} {{ issue.title }} {{ issue.project }}
{{ control_plane.kind }} {{ tracker.endpoint }}
{% for comment in recent_comments %}{{ comment.author }} {{ comment.created_at }}{% endfor %}
{% for entry in recent_history %}{{ entry.issue_id }} {{ entry.at }}{% endfor %}
`);

  const result = await lintWorkflow(path);

  expect(result.ok).toBe(true);
  expect(result.diagnostics).toEqual([]);
});

test("lint accepts loops over issue collection fields", async () => {
  const path = await writeWorkflow(`
{% for label in issue.labels %}{{ label }}{% endfor %}
{% for blocker in issue.blocked_by %}{{ blocker }}{% endfor %}
`);

  const result = await lintWorkflow(path);

  expect(result.ok).toBe(true);
  expect(result.diagnostics).toEqual([]);
});

test("lint accepts blocker fields inside issue blocked_by loops", async () => {
  const path = await writeWorkflow(`
{% for blocker in issue.blocked_by %}
{{ blocker.id }} {{ blocker.identifier }} {{ blocker.state }}
{% endfor %}
`);

  const result = await lintWorkflow(path);

  expect(result.ok).toBe(true);
  expect(result.diagnostics).toEqual([]);
});

test("lint accepts Liquid filters exposed by the runtime engine", async () => {
  const path = await writeWorkflow(`
{{ issue.title | json }}
{{ issue.title | base64_encode }}
{{ issue.labels | where_exp: "label", "label contains 'bug'" }}
`);

  const result = await lintWorkflow(path);

  expect(result.ok).toBe(true);
  expect(result.diagnostics).toEqual([]);
});

test("lint accepts assigned Liquid variables", async () => {
  const path = await writeWorkflow(`
{% assign title = issue.title %}
{{ title }}
`);

  const result = await lintWorkflow(path);

  expect(result.ok).toBe(true);
  expect(result.diagnostics).toEqual([]);
});

test("lint accepts assigned aliases to known Liquid objects", async () => {
  const path = await writeWorkflow(`
{% assign alias = issue %}
{{ alias.title }}
`);

  const result = await lintWorkflow(path);

  expect(result.ok).toBe(true);
  expect(result.diagnostics).toEqual([]);
});

test("lint accepts captured Liquid variables after capture blocks", async () => {
  const path = await writeWorkflow(`
{% capture title %}{{ issue.title }}{% endcapture %}
{{ title }}
`);

  const result = await lintWorkflow(path);

  expect(result.ok).toBe(true);
  expect(result.diagnostics).toEqual([]);
});

test("lint rejects unknown prompt context fields", async () => {
  const path = await writeWorkflow(`
{{ issue.not_a_field }}
{{ recent_history.summary }}
{{ project }}
{% if foo %}bad root{% endif %}
{% for entry in recent_history %}{{ entry.summary }}{% endfor %}
`);

  const result = await lintWorkflow(path);

  expect(result.ok).toBe(false);
  expect(result.diagnostics.map((d) => d.message)).toContain(
    "Unknown Liquid variable path `issue.not_a_field`",
  );
  expect(result.diagnostics.map((d) => d.message)).toContain(
    "Unknown Liquid variable path `recent_history.summary`",
  );
  expect(result.diagnostics.map((d) => d.message)).toContain(
    "Unknown Liquid variable path `project`",
  );
  expect(result.diagnostics.map((d) => d.message)).toContain("Unknown Liquid variable path `foo`");
  expect(result.diagnostics.map((d) => d.message)).toContain(
    "Unknown Liquid variable path `entry.summary`",
  );
});

test("lint rejects unknown Liquid references inside assignment tags", async () => {
  const path = await writeWorkflow(`
{% assign title = issue.not_a_field %}
{{ issue.title }}
`);

  const result = await lintWorkflow(path);

  expect(result.ok).toBe(false);
  expect(result.diagnostics.map((d) => d.message)).toContain(
    "Unknown Liquid variable path `issue.not_a_field`",
  );
});

test("lint rejects unknown Liquid references inside case tags", async () => {
  const path = await writeWorkflow(`
{% case issue.not_a_field %}
{% when "x" %}x
{% endcase %}
`);

  const result = await lintWorkflow(path);

  expect(result.ok).toBe(false);
  expect(result.diagnostics.map((d) => d.message)).toContain(
    "Unknown Liquid variable path `issue.not_a_field`",
  );
});

test("lint rejects loop variables used outside their for block", async () => {
  const path = await writeWorkflow(`
{% for comment in recent_comments %}{{ comment.author }}{% endfor %}
{{ comment.author }}
`);

  const result = await lintWorkflow(path);

  expect(result.ok).toBe(false);
  expect(result.diagnostics.map((d) => d.message)).toContain(
    "Unknown Liquid variable path `comment.author`",
  );
});

test("lint accepts filtered Liquid for-loop collections", async () => {
  const path = await writeWorkflow(`
{% for label in issue.labels | sort %}{{ label }}{% endfor %}
`);

  const result = await lintWorkflow(path);

  expect(result.ok).toBe(true);
  expect(result.diagnostics).toEqual([]);
});

test("lint accepts reversed Liquid for-loop collections", async () => {
  const path = await writeWorkflow(`
{% for label in issue.labels reversed %}{{ label }}{% endfor %}
`);

  const result = await lintWorkflow(path);

  expect(result.ok).toBe(true);
  expect(result.diagnostics).toEqual([]);
});

test("lint accepts limit Liquid for-loop collections", async () => {
  const path = await writeWorkflow(`
{% for label in issue.labels limit: 2 %}{{ label }}{% endfor %}
`);

  const result = await lintWorkflow(path);

  expect(result.ok).toBe(true);
  expect(result.diagnostics).toEqual([]);
});

test("lint accepts offset Liquid for-loop collections", async () => {
  const path = await writeWorkflow(`
{% for label in issue.labels offset: 1 %}{{ label }}{% endfor %}
`);

  const result = await lintWorkflow(path);

  expect(result.ok).toBe(true);
  expect(result.diagnostics).toEqual([]);
});

test("lint scans imported prompt body after expansion", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dalang-lint-import-"));
  await writeFile(join(dir, "preamble.md"), "{{ recent_history.summary }}");
  const path = join(dir, "WORKFLOW.md");
  await writeFile(path, "---\n---\n@preamble.md\n");

  const result = await lintWorkflow(path);

  expect(result.ok).toBe(false);
  expect(result.diagnostics.map((d) => d.message)).toContain(
    "Unknown Liquid variable path `recent_history.summary`",
  );
});

test("lint rejects unknown filters and invalid for collections", async () => {
  const path = await writeWorkflow(`
{{ issue.title | not_a_filter }}
{% for item in issue.title %}{{ item.name }}{% endfor %}
`);

  const result = await lintWorkflow(path);

  expect(result.ok).toBe(false);
  expect(result.diagnostics.map((d) => d.message)).toContain(
    "Unknown Liquid filter `not_a_filter`",
  );
  expect(result.diagnostics.map((d) => d.message)).toContain(
    "Invalid Liquid for-loop collection `issue.title`",
  );
});

test("lint validates github-projects pr_checks states", async () => {
  const path = await writeWorkflow(
    "{{ issue.title }}",
    `
control_plane:
  kind: github-projects
  owner_type: user
  owner: ruqqq
  project_number: 1
  repository: ruqqq/pentas
  token: token
  status_field: Status
  active_states: ["In Dev"]
  terminal_states: ["Done"]
  ownership:
    mode: label
    value: dalang
  pr_checks:
    enabled: true
    wait_state: "Waiting PR Checks"
    pass_state: "Ready for Human Review"
    fail_state: "In Dev"
    escalation_state: "Ready for Human Review"
`,
  );

  const result = await lintWorkflow(path);

  expect(result.ok).toBe(false);
  expect(result.diagnostics.map((d) => d.message)).toContain(
    "Unknown pr_checks.wait_state `Waiting PR Checks`; expected one of: In Dev, Done",
  );
  expect(result.diagnostics.map((d) => d.message)).toContain(
    "Unknown pr_checks.pass_state `Ready for Human Review`; expected one of: In Dev, Done",
  );
  expect(result.diagnostics.map((d) => d.message)).toContain(
    "Unknown pr_checks.escalation_state `Ready for Human Review`; expected one of: In Dev, Done",
  );
});
