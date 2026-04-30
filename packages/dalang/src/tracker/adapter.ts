// packages/dalang/src/tracker/adapter.ts
import type { NormalizedIssue, TrackerComment } from "../types";

export interface TrackerAdapter {
  fetchCandidateIssues(activeStates: string[]): Promise<NormalizedIssue[]>;
  fetchIssuesByStates(states: string[]): Promise<NormalizedIssue[]>;
  fetchIssueStatesByIds(ids: string[]): Promise<NormalizedIssue[]>;
  fetchIssue(id: string): Promise<NormalizedIssue | null>;
  listComments(issueId: string): Promise<TrackerComment[]>;
  addComment(issueId: string, body: string, author?: "user" | "agent"): Promise<void>;
  updateState(issueId: string, state: string): Promise<void>;
}

export type TrackerErrorCode =
  | "tracker_request_error"
  | "tracker_status_error"
  | "tracker_malformed_payload"
  | "tracker_missing_pagination_cursor"
  | "tracker_write_error";

export class TrackerError extends Error {
  code: TrackerErrorCode;
  constructor(code: TrackerErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
