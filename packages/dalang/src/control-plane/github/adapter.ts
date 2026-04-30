import { ControlPlaneError, type ControlPlaneAdapter, type DispatchQuery, type PrChecksReconcileArgs } from "../adapter";
import type { ControlPlaneComment, WorkItem } from "../../types";
import { GithubClient } from "./client";
import { githubItemMatchesOwnership, githubProjectItemToWorkItem } from "./normalize";
import { reconcileGithubPrChecks, type GithubCheck, type GithubPullRequestRef } from "./pr-checks";
import type { GithubProjectMetadata } from "./types";

const PROJECT_METADATA_FIELDS = `
  projectV2(number: $number) {
    id
    fields(first: 50, after: $fieldCursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        ... on ProjectV2Field { id name }
        ... on ProjectV2FieldCommon { id name }
        ... on ProjectV2SingleSelectField { id name options { id name } }
      }
    }
  }
`;

const PROJECT_METADATA_QUERY = `
  query ProjectMetadata($owner: String!, $number: Int!, $fieldCursor: String) {
    organization(login: $owner) {
      ${PROJECT_METADATA_FIELDS}
    }
  }
`;

const USER_PROJECT_METADATA_QUERY = `
  query ProjectMetadata($owner: String!, $number: Int!, $fieldCursor: String) {
    user(login: $owner) {
      ${PROJECT_METADATA_FIELDS}
    }
  }
`;

const PROJECT_ITEMS_QUERY = `
  query ProjectItems($projectId: ID!, $cursor: String) {
    node(id: $projectId) {
      ... on ProjectV2 {
        items(first: 50, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            updatedAt
            fieldValues(first: 100) {
              pageInfo { hasNextPage endCursor }
              nodes {
                ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { name } } }
                ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } }
              }
            }
            content {
              ... on Issue {
                __typename
                id
                number
                title
                body
                url
                repository { nameWithOwner }
                createdAt
                updatedAt
                labels(first: 30) { nodes { name } }
                assignees(first: 20) { nodes { login } }
              }
              ... on PullRequest { __typename }
              ... on DraftIssue { __typename }
            }
          }
        }
      }
    }
  }
`;

const UPDATE_STATUS_MUTATION = `
  mutation UpdateStatus($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $projectId,
      itemId: $itemId,
      fieldId: $fieldId,
      value: { singleSelectOptionId: $optionId }
    }) {
      projectV2Item { id }
    }
  }
`;

const PROJECT_ITEM_CONTENT_QUERY = `
  query ProjectItemContent($itemId: ID!) {
    node(id: $itemId) {
      ... on ProjectV2Item {
        content {
          ... on Issue { __typename number repository { nameWithOwner } }
        }
      }
    }
  }
`;

const MARK_READY_MUTATION = `
  mutation MarkReady($pullRequestId: ID!) {
    markPullRequestReadyForReview(input: { pullRequestId: $pullRequestId }) {
      pullRequest { id }
    }
  }
`;

const STATUS_CHECK_ROLLUP_QUERY = `
  query StatusCheckRollup($pullRequestId: ID!, $cursor: String) {
    node(id: $pullRequestId) {
      ... on PullRequest {
        commits(last: 1) {
          nodes {
            commit {
              oid
              statusCheckRollup {
                contexts(first: 100, after: $cursor) {
                  pageInfo { hasNextPage endCursor }
                  nodes {
                    ... on CheckRun {
                      __typename
                      name
                      status
                      conclusion
                      detailsUrl
                      checkSuite {
                        workflowRun { databaseId }
                      }
                    }
                    ... on StatusContext {
                      __typename
                      context
                      state
                      targetUrl
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

export interface GithubProjectsAdapterConfig {
  ownerType: "organization" | "user";
  owner: string;
  projectNumber: number;
  repository: string;
  token: string;
  statusField: string;
  branchField: string | null;
  branchPrefix: string;
  activeStates: string[];
  terminalStates: string[];
  ownership: DispatchQuery["ownership"];
  prChecks: {
    enabled: boolean;
    poll_interval_ms: number;
    failure_budget: number;
    rerun_flakes: boolean;
    wait_state: string;
    pass_state: string;
    fail_state: string;
    escalation_state: string;
  } | null;
}

export class GithubProjectsControlPlaneAdapter implements ControlPlaneAdapter {
  readonly capabilities: ControlPlaneAdapter["capabilities"];
  private readonly client: GithubClient;
  private metadata: GithubProjectMetadata | null = null;

  constructor(readonly cfg: GithubProjectsAdapterConfig, client?: GithubClient) {
    this.capabilities = cfg.prChecks?.enabled ? { prChecks: true } : {};
    this.client = client ?? new GithubClient({ token: cfg.token });
  }

  async validateConnection(): Promise<void> {
    const meta = await this.resolveMetadata();
    const requiredStates = [
      ...this.cfg.activeStates,
      ...this.cfg.terminalStates,
      ...(this.cfg.prChecks?.enabled ? [
        this.cfg.prChecks.wait_state,
        this.cfg.prChecks.pass_state,
        this.cfg.prChecks.fail_state,
        this.cfg.prChecks.escalation_state,
      ] : []),
    ];
    for (const state of requiredStates) {
      if (!meta.statusOptions.has(state.toLowerCase())) {
        throw new ControlPlaneError("control_plane_validation_error", `github project status option not found: ${state}`);
      }
    }
    const [owner, repo] = this.repoParts();
    await this.client.restJson(`/repos/${owner}/${repo}`, "GET");
  }

  async fetchDispatchableWork(query: DispatchQuery): Promise<WorkItem[]> {
    const all = await this.fetchProjectItems();
    return all.flatMap((raw) => {
      if (!githubItemMatchesOwnership(raw, query.ownership)) return [];
      const item = this.toWorkItem(raw);
      return item && query.activeStates.some((s) => s.toLowerCase() === item.state.toLowerCase()) ? [item] : [];
    });
  }

  async fetchWorkByStates(states: string[]): Promise<WorkItem[]> {
    if (states.length === 0) return [];
    const wanted = states.map((s) => s.toLowerCase());
    const all = await this.fetchProjectItems();
    return all.flatMap((raw) => {
      const item = this.toWorkItem(raw);
      return item && wanted.includes(item.state.toLowerCase()) ? [item] : [];
    });
  }

  async refreshWork(ids: string[]): Promise<WorkItem[]> {
    if (ids.length === 0) return [];
    const wanted = new Set(ids);
    const all = await this.fetchProjectItems();
    return all.flatMap((raw) => {
      const item = this.toWorkItem(raw);
      return item && wanted.has(item.id) ? [item] : [];
    });
  }

  async fetchWorkItem(id: string): Promise<WorkItem | null> {
    return (await this.refreshWork([id]))[0] ?? null;
  }

  async listComments(workItemId: string): Promise<ControlPlaneComment[]> {
    const { number, repository } = await this.issueRefForProjectItem(workItemId);
    const [owner, repo] = splitRepository(repository);
    const comments: unknown[] = [];
    for (let page = 1; ; page += 1) {
      const batch = await this.client.restJson<unknown[]>(
        `/repos/${owner}/${repo}/issues/${number}/comments?per_page=100&page=${page}`,
        "GET",
      );
      if (!Array.isArray(batch)) {
        throw new ControlPlaneError("control_plane_malformed_payload", "github issue comments: expected array");
      }
      comments.push(...batch);
      if (batch.length < 100) break;
    }
    return comments.map((raw) => {
      const c = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      const user = c.user && typeof c.user === "object" ? c.user as { login?: unknown } : {};
      return {
        id: String(c.id ?? ""),
        author: typeof user.login === "string" ? user.login : null,
        body: typeof c.body === "string" ? c.body : "",
        created_at: typeof c.created_at === "string" ? new Date(c.created_at).toISOString() : new Date(0).toISOString(),
      };
    });
  }

  async addComment(workItemId: string, body: string, _author: "user" | "agent" = "agent"): Promise<void> {
    const { number, repository } = await this.issueRefForProjectItem(workItemId);
    const [owner, repo] = splitRepository(repository);
    await this.client.restJson(`/repos/${owner}/${repo}/issues/${number}/comments`, "POST", { body });
  }

  async updateState(workItemId: string, state: string): Promise<void> {
    const meta = await this.resolveMetadata();
    const optionId = meta.statusOptions.get(state.toLowerCase());
    if (!optionId) {
      throw new ControlPlaneError("control_plane_validation_error", `github project status option not found: ${state}`);
    }
    await this.client.graphql(UPDATE_STATUS_MUTATION, {
      projectId: meta.projectId,
      itemId: workItemId,
      fieldId: meta.statusFieldId,
      optionId,
    });
  }

  async reconcilePrChecks(_args: PrChecksReconcileArgs): Promise<void> {
    if (!this.cfg.prChecks?.enabled) return;
    await reconcileGithubPrChecks({
      work: _args.work,
      polls: _args.polls,
      config: this.cfg.prChecks,
      now: _args.now,
      listComments: (id) => this.listComments(id),
      addComment: (id, body) => this.addComment(id, body, "agent"),
      updateState: (id, state) => this.updateState(id, state),
      resolvePullRequest: (item) => this.resolvePullRequest(item),
      fetchChecks: (pr) => this.fetchChecks(pr),
      rerunFailedChecks: (pr, checks) => this.rerunFailedChecks(pr, checks),
      markReady: (pr) => this.markReady(pr),
    });
  }

  private async resolveMetadata(): Promise<GithubProjectMetadata> {
    if (this.metadata) return this.metadata;
    const { projectId, fields } = await this.fetchProjectFields();
    const statusField = fields.find((f) => f.name === this.cfg.statusField);
    if (!statusField || typeof statusField.id !== "string") {
      throw new ControlPlaneError("control_plane_validation_error", `github project status field not found: ${this.cfg.statusField}`);
    }

    const statusOptions = optionsByLowerName(statusField.options);
    const ownershipFieldName = this.cfg.ownership.mode === "project_field" ? this.cfg.ownership.field : null;
    const branchFieldId = fieldId(fields, this.cfg.branchField);
    if (this.cfg.branchField && !branchFieldId) {
      throw new ControlPlaneError("control_plane_validation_error", `github project branch field not found: ${this.cfg.branchField}`);
    }
    const ownershipFieldId = ownershipFieldName ? fieldId(fields, ownershipFieldName) : null;
    if (ownershipFieldName && !ownershipFieldId) {
      throw new ControlPlaneError("control_plane_validation_error", `github project ownership field not found: ${ownershipFieldName}`);
    }
    const ownershipOptions = ownershipFieldName
      ? optionsByLowerName(fields.find((f) => f.name === ownershipFieldName)?.options)
      : new Map();
    if (this.cfg.ownership.mode === "project_field" && !ownershipOptions.has(this.cfg.ownership.value.toLowerCase())) {
      throw new ControlPlaneError("control_plane_validation_error", `github project ownership option not found: ${this.cfg.ownership.value}`);
    }
    this.metadata = {
      projectId,
      statusFieldId: statusField.id,
      statusOptions,
      branchFieldId,
      ownershipFieldId,
      ownershipOptions,
    };
    return this.metadata;
  }

  private async fetchProjectFields(): Promise<{ projectId: string; fields: Array<Record<string, unknown>> }> {
    const query = this.cfg.ownerType === "organization" ? PROJECT_METADATA_QUERY : USER_PROJECT_METADATA_QUERY;
    const fields: Array<Record<string, unknown>> = [];
    let projectId: string | null = null;
    let fieldCursor: string | null = null;
    do {
      const data = await this.client.graphql<Record<string, unknown>>(query, {
        owner: this.cfg.owner,
        number: this.cfg.projectNumber,
        fieldCursor,
      });
      const ownerNode = this.cfg.ownerType === "organization" ? data.organization : data.user;
      const project = ownerNode && typeof ownerNode === "object"
        ? (ownerNode as { projectV2?: unknown }).projectV2
        : null;
      if (!project || typeof project !== "object") {
        throw new ControlPlaneError("control_plane_validation_error", "github project not found");
      }
      const projectObj = project as Record<string, unknown>;
      if (typeof projectObj.id !== "string") {
        throw new ControlPlaneError("control_plane_malformed_payload", "github project metadata missing id");
      }
      projectId = projectObj.id;
      const fieldConnection = projectObj.fields && typeof projectObj.fields === "object"
        ? projectObj.fields as Record<string, unknown>
        : null;
      fields.push(...nodes(fieldConnection).filter((x): x is Record<string, unknown> => x !== null && typeof x === "object"));
      const pageInfo = fieldConnection?.pageInfo && typeof fieldConnection.pageInfo === "object"
        ? fieldConnection.pageInfo as { hasNextPage?: unknown; endCursor?: unknown }
        : null;
      if (!pageInfo || pageInfo.hasNextPage !== true) break;
      fieldCursor = typeof pageInfo.endCursor === "string" ? pageInfo.endCursor : null;
      if (fieldCursor === null) {
        throw new ControlPlaneError("control_plane_missing_pagination_cursor", "github project fields missing next cursor");
      }
    } while (fieldCursor);
    if (!projectId) throw new ControlPlaneError("control_plane_validation_error", "github project not found");
    return { projectId, fields };
  }

  private async fetchProjectItems(): Promise<unknown[]> {
    const meta = await this.resolveMetadata();
    const out: unknown[] = [];
    let cursor: string | null = null;
    do {
      const data: { node?: unknown } = await this.client.graphql(PROJECT_ITEMS_QUERY, { projectId: meta.projectId, cursor });
      const project: { items?: unknown } | null = data.node && typeof data.node === "object"
        ? data.node as { items?: unknown }
        : null;
      const items: Record<string, unknown> | null = project?.items && typeof project.items === "object"
        ? project.items as Record<string, unknown>
        : null;
      out.push(...nodes(items));
      const pageInfo: { hasNextPage?: unknown; endCursor?: unknown } | null = items?.pageInfo && typeof items.pageInfo === "object"
        ? items.pageInfo as { hasNextPage?: unknown; endCursor?: unknown }
        : null;
      if (!pageInfo) break;
      cursor = typeof pageInfo.endCursor === "string" ? pageInfo.endCursor : null;
      if (pageInfo.hasNextPage === true && cursor === null) {
        throw new ControlPlaneError("control_plane_missing_pagination_cursor", "github project items missing next cursor");
      }
      if (pageInfo.hasNextPage !== true) break;
    } while (cursor);
    return out;
  }

  private async issueRefForProjectItem(itemId: string): Promise<{ number: number; repository: string }> {
    const data = await this.client.graphql<{ node?: unknown }>(PROJECT_ITEM_CONTENT_QUERY, { itemId });
    const item = data.node && typeof data.node === "object" ? data.node as { content?: unknown } : null;
    const content = item?.content && typeof item.content === "object" ? item.content as Record<string, unknown> : null;
    if (!content || content.__typename !== "Issue" || typeof content.number !== "number") {
      throw new ControlPlaneError("control_plane_validation_error", `github project item is not an issue: ${itemId}`);
    }
    return {
      number: content.number,
      repository: repositoryNameWithOwner(content) ?? this.cfg.repository,
    };
  }

  private toWorkItem(raw: unknown): WorkItem | null {
    const repository = itemRepositoryNameWithOwner(raw);
    if (repository !== this.cfg.repository) return null;
    return githubProjectItemToWorkItem(raw, {
      repository,
      statusField: this.cfg.statusField,
      branchField: this.cfg.branchField,
      branchPrefix: this.cfg.branchPrefix,
    });
  }

  private repoParts(): [string, string] {
    const parts = this.cfg.repository.split("/");
    return [parts[0]!, parts[1]!];
  }

  private async resolvePullRequest(item: WorkItem): Promise<GithubPullRequestRef | null> {
    const branch = item.branch_name;
    if (!branch) return null;
    const [owner, repo] = this.repoParts();
    const prs = await this.client.restJson<Array<{
      number: number;
      html_url: string;
      node_id?: string;
      head: { sha: string };
    }>>(
      `/repos/${owner}/${repo}/pulls?head=${encodeURIComponent(`${owner}:${branch}`)}&state=open`,
      "GET",
    );
    const pr = prs[0];
    return pr ? { number: pr.number, url: pr.html_url, sha: pr.head.sha, nodeId: pr.node_id ?? null } : null;
  }

  private async fetchChecks(pr: GithubPullRequestRef): Promise<GithubCheck[]> {
    if (pr.nodeId) return await this.fetchStatusCheckRollup(pr);
    const [owner, repo] = this.repoParts();
    const prData = await this.client.restJson<{ head: { sha: string } }>(`/repos/${owner}/${repo}/pulls/${pr.number}`, "GET");
    const runs = await this.client.restJson<{
      check_runs: Array<{ name: string; status: string; conclusion: string | null; html_url: string | null; run_id?: number | null }>;
    }>(
      `/repos/${owner}/${repo}/commits/${prData.head.sha}/check-runs`,
      "GET",
    );
    return runs.check_runs.map((r) => ({
      name: r.name,
      state: r.conclusion ?? r.status,
      bucket: r.status !== "completed"
        ? "pending"
        : r.conclusion === "success" || r.conclusion === "neutral" || r.conclusion === "skipped"
          ? "pass"
          : r.conclusion === "cancelled"
            ? "cancel"
            : "fail",
      link: r.html_url,
      runId: typeof r.run_id === "number" ? r.run_id : null,
    }));
  }

  private async fetchStatusCheckRollup(pr: GithubPullRequestRef): Promise<GithubCheck[]> {
    const out: GithubCheck[] = [];
    let cursor: string | null = null;
    do {
      const data = await this.client.graphql<{ node?: unknown }>(STATUS_CHECK_ROLLUP_QUERY, {
        pullRequestId: pr.nodeId,
        cursor,
      });
      const prNode = data.node && typeof data.node === "object" ? data.node as { commits?: unknown } : null;
      const commitNode = firstNode(prNode?.commits);
      const commitContainer = commitNode && typeof commitNode === "object" ? commitNode as { commit?: unknown } : null;
      const commit = commitContainer?.commit && typeof commitContainer.commit === "object"
        ? commitContainer.commit as { statusCheckRollup?: unknown }
        : null;
      const rollup = commit?.statusCheckRollup && typeof commit.statusCheckRollup === "object"
        ? commit.statusCheckRollup as { contexts?: unknown }
        : null;
      const contexts = rollup?.contexts && typeof rollup.contexts === "object" ? rollup.contexts as Record<string, unknown> : null;
      for (const raw of nodes(contexts)) {
        const c = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
        if (c.__typename === "CheckRun") {
          const checkSuite = c.checkSuite && typeof c.checkSuite === "object" ? c.checkSuite as { workflowRun?: unknown } : null;
          const workflowRun = checkSuite?.workflowRun && typeof checkSuite.workflowRun === "object"
            ? checkSuite.workflowRun as { databaseId?: unknown }
            : null;
          out.push({
            name: typeof c.name === "string" ? c.name : "",
            state: typeof c.conclusion === "string" ? c.conclusion : String(c.status ?? ""),
            bucket: checkRunBucket(c.status, c.conclusion),
            link: typeof c.detailsUrl === "string" ? c.detailsUrl : null,
            runId: typeof workflowRun?.databaseId === "number" ? workflowRun.databaseId : null,
          });
        } else if (c.__typename === "StatusContext") {
          out.push({
            name: typeof c.context === "string" ? c.context : "",
            state: typeof c.state === "string" ? c.state : "",
            bucket: statusContextBucket(c.state),
            link: typeof c.targetUrl === "string" ? c.targetUrl : null,
          });
        }
      }
      const pageInfo = contexts?.pageInfo && typeof contexts.pageInfo === "object"
        ? contexts.pageInfo as { hasNextPage?: unknown; endCursor?: unknown }
        : null;
      if (!pageInfo || pageInfo.hasNextPage !== true) break;
      cursor = typeof pageInfo.endCursor === "string" ? pageInfo.endCursor : null;
      if (cursor === null) {
        throw new ControlPlaneError("control_plane_missing_pagination_cursor", "github status check rollup missing next cursor");
      }
    } while (cursor);
    return out;
  }

  private async rerunFailedChecks(_pr: GithubPullRequestRef, checks: GithubCheck[]): Promise<number> {
    const [owner, repo] = this.repoParts();
    let count = 0;
    const seen = new Set<number>();
    for (const check of checks) {
      if (typeof check.runId !== "number") continue;
      if (seen.has(check.runId)) continue;
      seen.add(check.runId);
      await this.client.restJson(`/repos/${owner}/${repo}/actions/runs/${check.runId}/rerun-failed-jobs`, "POST", {});
      count += 1;
    }
    return count;
  }

  private async markReady(pr: GithubPullRequestRef): Promise<void> {
    if (!pr.nodeId) return;
    await this.client.graphql(MARK_READY_MUTATION, { pullRequestId: pr.nodeId });
  }
}

function nodes(raw: unknown): unknown[] {
  if (raw === null || typeof raw !== "object") return [];
  const n = (raw as { nodes?: unknown }).nodes;
  return Array.isArray(n) ? n : [];
}

function optionsByLowerName(raw: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (!Array.isArray(raw)) return out;
  for (const option of raw) {
    if (option && typeof option === "object") {
      const o = option as { id?: unknown; name?: unknown };
      if (typeof o.id === "string" && typeof o.name === "string") out.set(o.name.toLowerCase(), o.id);
    }
  }
  return out;
}

function fieldId(fields: Array<Record<string, unknown>>, name: string | null): string | null {
  if (!name) return null;
  const field = fields.find((f) => f.name === name);
  return typeof field?.id === "string" ? field.id : null;
}

function firstNode(raw: unknown): unknown {
  const n = nodes(raw);
  return n[0] ?? null;
}

function itemRepositoryNameWithOwner(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const content = (raw as { content?: unknown }).content;
  return content && typeof content === "object" ? repositoryNameWithOwner(content as Record<string, unknown>) : null;
}

function repositoryNameWithOwner(content: Record<string, unknown>): string | null {
  const repository = content.repository;
  if (repository && typeof repository === "object" && typeof (repository as { nameWithOwner?: unknown }).nameWithOwner === "string") {
    return (repository as { nameWithOwner: string }).nameWithOwner;
  }
  return null;
}

function splitRepository(repository: string): [string, string] {
  const parts = repository.split("/");
  return [parts[0]!, parts[1]!];
}

function checkRunBucket(status: unknown, conclusion: unknown): GithubCheck["bucket"] {
  if (status !== "COMPLETED" && status !== "completed") return "pending";
  if (conclusion === "SUCCESS" || conclusion === "success" || conclusion === "NEUTRAL" || conclusion === "neutral" || conclusion === "SKIPPED" || conclusion === "skipped") {
    return "pass";
  }
  if (conclusion === "CANCELLED" || conclusion === "cancelled") return "cancel";
  return "fail";
}

function statusContextBucket(state: unknown): GithubCheck["bucket"] {
  if (state === "SUCCESS" || state === "success") return "pass";
  if (state === "PENDING" || state === "pending" || state === "EXPECTED" || state === "expected") return "pending";
  if (state === "CANCELLED" || state === "cancelled") return "cancel";
  return "fail";
}
