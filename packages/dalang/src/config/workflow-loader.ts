// packages/dalang/src/config/workflow-loader.ts
import { readFile, stat } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { applyDefaults, WorkflowFrontMatterSchema, type WorkflowFrontMatter } from "./schema";

export type WorkflowErrorCode =
  | "missing_workflow_file"
  | "workflow_parse_error"
  | "workflow_front_matter_not_a_map"
  | "workflow_empty_prompt"
  | "workflow_validation_error";

export class WorkflowError extends Error {
  code: WorkflowErrorCode;
  constructor(code: WorkflowErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface LoadedWorkflow {
  config: WorkflowFrontMatter;
  promptTemplate: string;
  mtimeMs: number;
}

const FM_DELIM = /^---\s*$/m;

export async function loadWorkflow(path: string): Promise<LoadedWorkflow> {
  let raw: string;
  let mtimeMs: number;
  try {
    raw = await readFile(path, "utf8");
    const st = await stat(path);
    mtimeMs = st.mtimeMs;
  } catch (err) {
    throw new WorkflowError("missing_workflow_file", `cannot read workflow at ${path}: ${(err as Error).message}`);
  }

  let frontMatterText = "";
  let body = raw;

  const lines = raw.split("\n");
  if (lines[0]?.trim() === "---") {
    let endIdx = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i]!.trim() === "---") {
        endIdx = i;
        break;
      }
    }
    if (endIdx === -1) {
      throw new WorkflowError("workflow_parse_error", "front matter delimiter `---` not closed");
    }
    frontMatterText = lines.slice(1, endIdx).join("\n");
    body = lines.slice(endIdx + 1).join("\n");
  } else {
    throw new WorkflowError("workflow_front_matter_not_a_map", "WORKFLOW.md must start with YAML front matter `---`");
  }

  let parsed: unknown;
  try {
    parsed = frontMatterText.trim().length === 0 ? {} : parseYaml(frontMatterText);
  } catch (err) {
    throw new WorkflowError("workflow_parse_error", `YAML parse failed: ${(err as Error).message}`);
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new WorkflowError("workflow_front_matter_not_a_map", "front matter must decode to a map");
  }

  const merged = applyDefaults(parsed);
  const validation = WorkflowFrontMatterSchema.safeParse(merged);
  if (!validation.success) {
    throw new WorkflowError("workflow_validation_error", `front matter invalid: ${validation.error.message}`);
  }

  const trimmedBody = body.trim();
  if (trimmedBody.length === 0) {
    throw new WorkflowError("workflow_empty_prompt", "prompt body is empty after trimming");
  }

  return { config: validation.data, promptTemplate: trimmedBody, mtimeMs };
}
