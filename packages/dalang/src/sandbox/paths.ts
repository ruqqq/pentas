import { homedir } from "node:os";
import { join } from "node:path";

export function defaultSandboxesRoot(): string {
  return join(homedir(), ".dalang", "sandbox-workers");
}

export function defaultSandboxTranscriptRoot(): string {
  return join(homedir(), ".dalang", "sandbox-events");
}
