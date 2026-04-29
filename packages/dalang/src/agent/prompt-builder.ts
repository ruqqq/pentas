// packages/dalang/src/agent/prompt-builder.ts
import { Liquid } from "liquidjs";
import type { NormalizedIssue } from "../types";

const liquid = new Liquid({ strictVariables: true, strictFilters: true });

const HEADER = (i: NormalizedIssue) => `# Working on ${i.identifier}: ${i.title}\n\n`;

export async function buildFirstTurnPrompt(
  template: string,
  issue: NormalizedIssue,
  attempt: number | null,
): Promise<string> {
  const rendered = await liquid.parseAndRender(template, { issue, attempt });
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
