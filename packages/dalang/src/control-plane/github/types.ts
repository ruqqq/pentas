import type { OwnershipRule } from "../adapter";

export interface GithubProjectMetadata {
  projectId: string;
  statusFieldId: string;
  statusOptions: Map<string, string>;
  branchFieldId: string | null;
  ownershipFieldId: string | null;
  ownershipOptions: Map<string, string>;
}

export interface GithubProjectConfig {
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
  ownership: OwnershipRule;
  prChecks: {
    enabled: boolean;
    poll_interval_ms: number;
    failure_budget: number;
    rerun_flakes: boolean;
    wait_state: string;
    pass_state: string;
    fail_state: string;
    escalation_state: string;
    conflict_watch_state?: string | undefined;
    conflict_target_state?: string | undefined;
  } | null;
}
