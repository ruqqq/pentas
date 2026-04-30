import type { WorkflowFrontMatter } from "../config/schema";
import { resolveEnvValue, resolveTrackerApiKey } from "../config/env-resolver";
import type { ControlPlaneAdapter } from "./adapter";
import { GithubProjectsControlPlaneAdapter } from "./github/adapter";
import { PapanControlPlaneAdapter } from "./papan-adapter";

export interface CreateControlPlaneArgs {
  config: WorkflowFrontMatter;
  trackerEndpoint?: string | null;
  trackerApiKey?: string | null | undefined;
}

export function createControlPlaneAdapter(args: CreateControlPlaneArgs): ControlPlaneAdapter {
  const cp = args.config.control_plane;
  if (cp.kind === "papan") {
    return new PapanControlPlaneAdapter({
      endpoint: args.trackerEndpoint ?? cp.endpoint,
      apiKey:
        args.trackerApiKey !== undefined
          ? resolveTrackerApiKey(args.trackerApiKey)
          : resolveTrackerApiKey(cp.api_key ?? null),
    });
  }

  const token = resolveEnvValue(cp.token) ?? cp.token;
  return new GithubProjectsControlPlaneAdapter({
    ownerType: cp.owner_type,
    owner: cp.owner,
    projectNumber: cp.project_number,
    repository: cp.repository,
    token,
    statusField: cp.status_field,
    branchField: cp.branch_field ?? null,
    branchPrefix: args.config.repo?.branch_prefix ?? "",
    activeStates: cp.active_states,
    terminalStates: cp.terminal_states,
    ownership: cp.ownership,
    prChecks: cp.pr_checks ?? null,
  });
}
