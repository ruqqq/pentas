// packages/dalang/src/tracker/adapter.ts
import type { NormalizedIssue } from "../types";

export interface TrackerAdapter {
  fetchCandidateIssues(activeStates: string[]): Promise<NormalizedIssue[]>;
  fetchIssuesByStates(states: string[]): Promise<NormalizedIssue[]>;
  fetchIssueStatesByIds(ids: string[]): Promise<NormalizedIssue[]>;
  fetchIssue(id: string): Promise<NormalizedIssue | null>;
}

export type TrackerErrorCode =
  | "tracker_request_error"
  | "tracker_status_error"
  | "tracker_malformed_payload"
  | "tracker_missing_pagination_cursor";

export class TrackerError extends Error {
  code: TrackerErrorCode;
  constructor(code: TrackerErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
