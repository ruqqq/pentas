// packages/dalang/src/agent/prompt-builder.ts
import { Liquid } from "liquidjs";
import type { NormalizedIssue, TrackerComment, TrackerHistoryEntry } from "../types";

const liquid = new Liquid({ strictVariables: true, strictFilters: true });

const HEADER = (i: NormalizedIssue) => `# Working on ${i.identifier}: ${i.title}\n\n`;

// Cap injected slices so the prompt stays bounded on chatty tickets. The agent
// can still fetch the full thread on demand via the tracker API.
const RECENT_LIMIT = 5;

export interface TrackerPromptContext {
  endpoint: string;
  api_key: string | null;
}

export interface RecentActivity {
  comments: TrackerComment[];
  history: TrackerHistoryEntry[];
}

function newestFirst<T extends { created_at?: string; at?: string }>(items: T[], getKey: (x: T) => string): T[] {
  return [...items].sort((a, b) => getKey(b).localeCompare(getKey(a))).slice(0, RECENT_LIMIT);
}

export async function buildFirstTurnPrompt(
  template: string,
  issue: NormalizedIssue,
  attempt: number | null,
  tracker: TrackerPromptContext,
  activity: RecentActivity = { comments: [], history: [] },
): Promise<string> {
  const recent_comments = newestFirst(activity.comments, (c) => c.created_at);
  const recent_history = newestFirst(activity.history, (h) => h.at);
  const rendered = await liquid.parseAndRender(template, {
    issue,
    attempt,
    tracker,
    recent_comments,
    recent_history,
  });
  return HEADER(issue) + rendered;
}

export function buildContinuationPrompt(
  issue: NormalizedIssue,
  turnNumber: number,
  maxTurns: number,
): string {
  return [
    `Continuing work on ${issue.identifier} (turn ${turnNumber} of up to ${maxTurns}).`,
    `Re-check the current state of the workspace and pick up where the last turn left off.`,
    `If the work is complete, finalize and stop.`,
  ].join("\n");
}
