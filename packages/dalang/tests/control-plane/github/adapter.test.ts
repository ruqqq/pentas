import { expect, test } from "bun:test";
import { GithubProjectsControlPlaneAdapter } from "../../../src/control-plane/github/adapter";
import { GithubClient } from "../../../src/control-plane/github/client";

class FakeClient extends GithubClient {
  queries: Array<{ query: string; variables: Record<string, unknown> }> = [];
  restCalls: Array<{ path: string; method: string; payload: unknown }> = [];
  responses: unknown[] = [];
  restResponses: unknown[] = [];

  constructor() {
    super({ token: "token" });
  }

  override async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    this.queries.push({ query, variables });
    return this.responses.shift() as T;
  }

  override async restJson<T>(path: string, method: "GET" | "POST" | "PATCH", payload?: unknown): Promise<T> {
    this.restCalls.push({ path, method, payload });
    return (this.restResponses.length > 0 ? this.restResponses.shift() : { ok: true }) as T;
  }
}

function adapter(
  client: FakeClient,
  prChecks = false,
  prChecksConfig: Partial<NonNullable<ConstructorParameters<typeof GithubProjectsControlPlaneAdapter>[0]["prChecks"]>> = {},
): GithubProjectsControlPlaneAdapter {
  return new GithubProjectsControlPlaneAdapter({
    ownerType: "organization",
    owner: "acme",
    projectNumber: 1,
    repository: "acme/app",
    token: "token",
    statusField: "Status",
    branchField: null,
    branchPrefix: "juara/",
    activeStates: ["Todo"],
    terminalStates: ["Done"],
    ownership: { mode: "label", value: "dalang" },
    prChecks: prChecks ? {
      enabled: true,
      poll_interval_ms: 60000,
      failure_budget: 3,
      rerun_flakes: false,
      wait_state: "Waiting PR Checks",
      pass_state: "Ready for Human Review",
      fail_state: "In Dev",
      escalation_state: "Ready for Human Review",
      ...prChecksConfig,
    } : null,
  }, client);
}

function metadataResponse() {
  return {
    organization: {
      projectV2: {
        id: "PVT_1",
        fields: {
          nodes: [
            { __typename: "ProjectV2SingleSelectField", id: "FIELD_STATUS", name: "Status", options: [{ id: "OPT_TODO", name: "Todo" }, { id: "OPT_DONE", name: "Done" }] },
          ],
        },
      },
    },
  };
}

function itemResponse() {
  return {
    node: {
      items: {
        nodes: [
          {
            id: "PVTI_1",
            updatedAt: "2026-04-30T02:00:00Z",
            fieldValues: { nodes: [{ __typename: "ProjectV2ItemFieldSingleSelectValue", name: "Todo", field: { name: "Status" } }] },
            content: {
              __typename: "Issue",
              id: "ISSUE_1",
              number: 12,
              title: "Fix",
              body: "Body",
              url: "https://github.com/acme/app/issues/12",
              repository: { nameWithOwner: "acme/app" },
              createdAt: "2026-04-30T01:00:00Z",
              updatedAt: "2026-04-30T01:30:00Z",
              labels: { nodes: [{ name: "dalang" }] },
              assignees: { nodes: [] },
            },
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    },
  };
}

test("fetchDispatchableWork resolves metadata and filters by ownership", async () => {
  const client = new FakeClient();
  client.responses.push(metadataResponse(), itemResponse());

  const got = await adapter(client).fetchDispatchableWork({
    activeStates: ["Todo"],
    ownership: { mode: "label", value: "dalang" },
  });

  expect(got).toHaveLength(1);
  expect(got[0]!.identifier).toBe("acme/app#12");
});

test("updateState writes project status option", async () => {
  const client = new FakeClient();
  client.responses.push(metadataResponse(), { updateProjectV2ItemFieldValue: { projectV2Item: { id: "PVTI_1" } } });

  await adapter(client).updateState("PVTI_1", "Done");

  expect(client.queries.at(-1)!.variables).toMatchObject({
    projectId: "PVT_1",
    itemId: "PVTI_1",
    fieldId: "FIELD_STATUS",
    optionId: "OPT_DONE",
  });
});

test("addComment posts to the underlying issue", async () => {
  const client = new FakeClient();
  client.responses.push({
    node: {
      content: { __typename: "Issue", number: 12, repository: { nameWithOwner: "acme/app" } },
    },
  });

  await adapter(client).addComment("PVTI_1", "hello", "agent");

  expect(client.restCalls[0]).toEqual({
    path: "/repos/acme/app/issues/12/comments",
    method: "POST",
    payload: { body: "hello" },
  });
});

test("listComments paginates GitHub issue comments", async () => {
  const client = new FakeClient();
  client.responses.push({
    node: {
      content: { __typename: "Issue", number: 12, repository: { nameWithOwner: "acme/app" } },
    },
  });
  client.restResponses.push(
    Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      user: { login: "agent" },
      body: `comment ${i + 1}`,
      created_at: "2026-04-30T00:00:00Z",
    })),
    [{ id: 101, user: { login: "agent" }, body: "comment 101", created_at: "2026-04-30T00:01:00Z" }],
  );

  const comments = await adapter(client).listComments("PVTI_1");

  expect(comments).toHaveLength(101);
  expect(client.restCalls[0]!.path).toBe("/repos/acme/app/issues/12/comments?per_page=100&page=1");
  expect(client.restCalls[1]!.path).toBe("/repos/acme/app/issues/12/comments?per_page=100&page=2");
});

test("fetchDispatchableWork ignores issues from other repositories", async () => {
  const client = new FakeClient();
  const response = itemResponse();
  response.node.items.nodes[0]!.content.repository = { nameWithOwner: "acme/other" };
  client.responses.push(metadataResponse(), response);

  const got = await adapter(client).fetchDispatchableWork({
    activeStates: ["Todo"],
    ownership: { mode: "label", value: "dalang" },
  });

  expect(got).toEqual([]);
});

test("validateConnection fails when configured project field is missing", async () => {
  const client = new FakeClient();
  client.responses.push(metadataResponse());
  const a = new GithubProjectsControlPlaneAdapter({
    ownerType: "organization",
    owner: "acme",
    projectNumber: 1,
    repository: "acme/app",
    token: "token",
    statusField: "Status",
    branchField: "Branch",
    branchPrefix: "juara/",
    activeStates: ["Todo"],
    terminalStates: ["Done"],
    ownership: { mode: "label", value: "dalang" },
    prChecks: null,
  }, client);

  await expect(a.validateConnection()).rejects.toMatchObject({
    code: "control_plane_validation_error",
  });
});

test("validateConnection fails when configured ownership option is missing", async () => {
  const client = new FakeClient();
  const response = metadataResponse();
  response.organization.projectV2.fields.nodes.push({
    __typename: "ProjectV2SingleSelectField",
    id: "FIELD_AGENT",
    name: "Agent",
    options: [{ id: "OPT_OTHER", name: "Other" }],
  });
  client.responses.push(response);
  const a = new GithubProjectsControlPlaneAdapter({
    ownerType: "organization",
    owner: "acme",
    projectNumber: 1,
    repository: "acme/app",
    token: "token",
    statusField: "Status",
    branchField: null,
    branchPrefix: "juara/",
    activeStates: ["Todo"],
    terminalStates: ["Done"],
    ownership: { mode: "project_field", field: "Agent", value: "Dalang" },
    prChecks: null,
  }, client);

  await expect(a.validateConnection()).rejects.toMatchObject({
    code: "control_plane_validation_error",
  });
});

test("validateConnection resolves status field from second metadata page", async () => {
  const client = new FakeClient();
  client.responses.push(
    {
      organization: {
        projectV2: {
          id: "PVT_1",
          fields: {
            nodes: [{ __typename: "ProjectV2Field", id: "FIELD_OTHER", name: "Other" }],
            pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
          },
        },
      },
    },
    metadataResponse(),
  );

  await adapter(client).validateConnection();

  expect(client.queries[1]!.variables.fieldCursor).toBe("cursor-1");
});

test("reconcilePrChecks observes status contexts from rollup", async () => {
  const client = new FakeClient();
  client.restResponses.push(
    [{ number: 9, html_url: "https://github.com/acme/app/pull/9", node_id: "PR_1", head: { sha: "abc123" } }],
    [],
    { ok: true },
  );
  client.responses.push(
    {
      node: {
        commits: {
          nodes: [{
            commit: {
              oid: "abc123",
              statusCheckRollup: {
                contexts: {
                  nodes: [
                    { __typename: "CheckRun", name: "build", status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: "https://ci/build" },
                    { __typename: "StatusContext", context: "legacy", state: "FAILURE", targetUrl: "https://ci/legacy" },
                  ],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            },
          }],
        },
      },
    },
    { node: { content: { __typename: "Issue", number: 12, repository: { nameWithOwner: "acme/app" } } } },
    {
      organization: {
        projectV2: {
          id: "PVT_1",
          fields: {
            nodes: [
              { __typename: "ProjectV2SingleSelectField", id: "FIELD_STATUS", name: "Status", options: [{ id: "OPT_DEV", name: "In Dev" }] },
            ],
          },
        },
      },
    },
    { updateProjectV2ItemFieldValue: { projectV2Item: { id: "PVTI_1" } } },
    { node: { content: { __typename: "Issue", number: 12, repository: { nameWithOwner: "acme/app" } } } },
  );

  await adapter(client, true).reconcilePrChecks({
    work: [{
      id: "PVTI_1",
      identifier: "acme/app#12",
      title: "Fix",
      description: null,
      priority: null,
      state: "Waiting PR Checks",
      branch_name: "juara/acme-app-12",
      url: "https://github.com/acme/app/issues/12",
      external_ref: "acme/app#12",
      internal_ref: "ISSUE_1",
      labels: [],
      blocked_by: [],
      created_at: null,
      updated_at: null,
    }],
    polls: new Map(),
    config: { enabled: true, poll_interval_ms: 60000, failure_budget: 3, rerun_flakes: false },
    repoCwd: process.cwd(),
    now: () => new Date("2026-04-30T00:00:00Z"),
  });

  const posted = client.restCalls.find((c) => c.path === "/repos/acme/app/issues/12/comments" && c.method === "POST");
  const postedBody = (posted!.payload as { body: string }).body;
  expect(postedBody).toContain("[pr_checks_failed]");
  expect(postedBody).toContain("legacy");
});

test("reconcilePrChecks reruns failed workflow runs from rollup", async () => {
  const client = new FakeClient();
  client.restResponses.push(
    [{ number: 9, html_url: "https://github.com/acme/app/pull/9", node_id: "PR_1", head: { sha: "abc123" } }],
    [],
    { ok: true },
    { ok: true },
  );
  client.responses.push(
    {
      node: {
        commits: {
          nodes: [{
            commit: {
              oid: "abc123",
              statusCheckRollup: {
                contexts: {
                  nodes: [
                    {
                      __typename: "CheckRun",
                      name: "build",
                      status: "COMPLETED",
                      conclusion: "FAILURE",
                      detailsUrl: "https://ci/build",
                      checkSuite: { workflowRun: { databaseId: 123 } },
                    },
                  ],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            },
          }],
        },
      },
    },
    { node: { content: { __typename: "Issue", number: 12, repository: { nameWithOwner: "acme/app" } } } },
    { node: { content: { __typename: "Issue", number: 12, repository: { nameWithOwner: "acme/app" } } } },
  );

  await adapter(client, true, { rerun_flakes: true }).reconcilePrChecks({
    work: [{
      id: "PVTI_1",
      identifier: "acme/app#12",
      title: "Fix",
      description: null,
      priority: null,
      state: "Waiting PR Checks",
      branch_name: "juara/acme-app-12",
      url: "https://github.com/acme/app/issues/12",
      external_ref: "acme/app#12",
      internal_ref: "ISSUE_1",
      labels: [],
      blocked_by: [],
      created_at: null,
      updated_at: null,
    }],
    polls: new Map(),
    config: { enabled: true, poll_interval_ms: 60000, failure_budget: 3, rerun_flakes: true },
    repoCwd: process.cwd(),
    now: () => new Date("2026-04-30T00:00:00Z"),
  });

  expect(client.restCalls.some((c) => c.path === "/repos/acme/app/actions/runs/123/rerun-failed-jobs" && c.method === "POST")).toBe(true);
  const posted = client.restCalls.find((c) => c.path === "/repos/acme/app/issues/12/comments" && c.method === "POST");
  expect((posted!.payload as { body: string }).body).toContain("Re-triggered 1 failed check");
});

test("reconcilePrChecks deduplicates reruns by workflow run", async () => {
  const client = new FakeClient();
  client.restResponses.push(
    [{ number: 9, html_url: "https://github.com/acme/app/pull/9", node_id: "PR_1", head: { sha: "abc123" } }],
    [],
    { ok: true },
    { ok: true },
  );
  client.responses.push(
    {
      node: {
        commits: {
          nodes: [{
            commit: {
              oid: "abc123",
              statusCheckRollup: {
                contexts: {
                  nodes: [
                    {
                      __typename: "CheckRun",
                      name: "build-1",
                      status: "COMPLETED",
                      conclusion: "FAILURE",
                      detailsUrl: "https://ci/build-1",
                      checkSuite: { workflowRun: { databaseId: 123 } },
                    },
                    {
                      __typename: "CheckRun",
                      name: "build-2",
                      status: "COMPLETED",
                      conclusion: "FAILURE",
                      detailsUrl: "https://ci/build-2",
                      checkSuite: { workflowRun: { databaseId: 123 } },
                    },
                  ],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            },
          }],
        },
      },
    },
    { node: { content: { __typename: "Issue", number: 12, repository: { nameWithOwner: "acme/app" } } } },
    { node: { content: { __typename: "Issue", number: 12, repository: { nameWithOwner: "acme/app" } } } },
  );

  await adapter(client, true, { rerun_flakes: true }).reconcilePrChecks({
    work: [{
      id: "PVTI_1",
      identifier: "acme/app#12",
      title: "Fix",
      description: null,
      priority: null,
      state: "Waiting PR Checks",
      branch_name: "juara/acme-app-12",
      url: "https://github.com/acme/app/issues/12",
      external_ref: "acme/app#12",
      internal_ref: "ISSUE_1",
      labels: [],
      blocked_by: [],
      created_at: null,
      updated_at: null,
    }],
    polls: new Map(),
    config: { enabled: true, poll_interval_ms: 60000, failure_budget: 3, rerun_flakes: true },
    repoCwd: process.cwd(),
    now: () => new Date("2026-04-30T00:00:00Z"),
  });

  const reruns = client.restCalls.filter((c) => c.path === "/repos/acme/app/actions/runs/123/rerun-failed-jobs");
  expect(reruns).toHaveLength(1);
});
