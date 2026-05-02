// packages/dalang/src/config/workflow-loader.ts
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, resolve, sep } from "node:path";
import { parse as parseYaml } from "yaml";
import { applyDefaults, WorkflowFrontMatterSchema, type WorkflowFrontMatter } from "./schema";

export type WorkflowErrorCode =
  | "missing_workflow_file"
  | "workflow_parse_error"
  | "workflow_front_matter_not_a_map"
  | "workflow_empty_prompt"
  | "workflow_validation_error"
  | "workflow_import_error";

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
  importedPaths: string[];
}

const IMPORT_LINE = /^\s*@(?<path>\S+)\s*$/;
const MAX_IMPORT_DEPTH = 10;
const EXACT_ENV_REF = /^\$(?:([A-Za-z_][A-Za-z0-9_]*)|\{([A-Za-z_][A-Za-z0-9_]*)\})$/;

export async function loadWorkflow(path: string): Promise<LoadedWorkflow> {
  let raw: string;
  let mtimeMs: number;
  try {
    raw = await readFile(path, "utf8");
    const st = await stat(path);
    mtimeMs = st.mtimeMs;
  } catch (err) {
    throw new WorkflowError(
      "missing_workflow_file",
      `cannot read workflow at ${path}: ${(err as Error).message}`,
    );
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
    throw new WorkflowError(
      "workflow_front_matter_not_a_map",
      "WORKFLOW.md must start with YAML front matter `---`",
    );
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

  const merged = applyDefaults(expandFrontMatterEnv(parsed));
  const validation = WorkflowFrontMatterSchema.safeParse(merged);
  if (!validation.success) {
    throw new WorkflowError(
      "workflow_validation_error",
      `front matter invalid: ${validation.error.message}`,
    );
  }

  const expanded = await expandImports(body, {
    rootDir: dirname(resolve(path)),
    currentDir: dirname(resolve(path)),
    stack: [],
    importedPaths: [],
    maxMtimeMs: mtimeMs,
    depth: 0,
  });

  const trimmedBody = expanded.body.trim();
  if (trimmedBody.length === 0) {
    throw new WorkflowError("workflow_empty_prompt", "prompt body is empty after trimming");
  }

  return {
    config: validation.data,
    promptTemplate: trimmedBody,
    mtimeMs: expanded.maxMtimeMs,
    importedPaths: expanded.importedPaths,
  };
}

function expandFrontMatterEnv(value: unknown): unknown {
  if (typeof value === "string") {
    const match = value.match(EXACT_ENV_REF);
    if (match === null) return value;
    const name = match[1] ?? match[2]!;
    const envValue = process.env[name];
    return envValue === undefined ? value : envValue;
  }
  if (Array.isArray(value)) return value.map((item) => expandFrontMatterEnv(item));
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    out[key] = expandFrontMatterEnv(nested);
  }
  return out;
}

interface ImportContext {
  rootDir: string;
  currentDir: string;
  stack: string[];
  importedPaths: string[];
  maxMtimeMs: number;
  depth: number;
}

interface ExpandResult {
  body: string;
  importedPaths: string[];
  maxMtimeMs: number;
}

async function expandImports(body: string, ctx: ImportContext): Promise<ExpandResult> {
  if (ctx.depth > MAX_IMPORT_DEPTH) {
    throw new WorkflowError(
      "workflow_import_error",
      `workflow import depth exceeds ${MAX_IMPORT_DEPTH}`,
    );
  }

  const lines = body.split("\n");
  const out: string[] = [];
  const rootReal = await realpath(ctx.rootDir);
  const currentReal = await realpath(ctx.currentDir);

  for (const line of lines) {
    const match = line.match(IMPORT_LINE);
    if (!match?.groups?.path) {
      out.push(line);
      continue;
    }

    const importPath = match.groups.path;
    const resolved = resolveImportPath(importPath, currentReal, rootReal);
    let targetReal: string;
    try {
      targetReal = await realpath(resolved);
    } catch (err) {
      throw new WorkflowError(
        "workflow_import_error",
        `cannot resolve import ${importPath}: ${(err as Error).message}`,
      );
    }

    assertInsideRoot(targetReal, rootReal, importPath);
    if (ctx.stack.includes(targetReal)) {
      throw new WorkflowError(
        "workflow_import_error",
        `cyclic workflow import detected: ${[...ctx.stack, targetReal].join(" -> ")}`,
      );
    }

    let imported: string;
    let importedMtime: number;
    try {
      imported = await readFile(targetReal, "utf8");
      importedMtime = (await stat(targetReal)).mtimeMs;
    } catch (err) {
      throw new WorkflowError(
        "workflow_import_error",
        `cannot read import ${importPath}: ${(err as Error).message}`,
      );
    }

    if (imported.split("\n")[0]?.trim() === "---") {
      throw new WorkflowError(
        "workflow_import_error",
        `import ${importPath} must not contain front matter`,
      );
    }

    ctx.importedPaths.push(targetReal);
    ctx.maxMtimeMs = Math.max(ctx.maxMtimeMs, importedMtime);
    const expanded = await expandImports(imported, {
      ...ctx,
      currentDir: dirname(targetReal),
      stack: [...ctx.stack, targetReal],
      depth: ctx.depth + 1,
    });
    ctx.maxMtimeMs = expanded.maxMtimeMs;
    out.push(expanded.body);
  }

  return {
    body: out.join("\n"),
    importedPaths: ctx.importedPaths,
    maxMtimeMs: ctx.maxMtimeMs,
  };
}

function resolveImportPath(importPath: string, currentDir: string, rootReal: string): string {
  if (isAbsolute(importPath)) {
    throw new WorkflowError(
      "workflow_import_error",
      `absolute workflow import rejected: ${importPath}`,
    );
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(importPath)) {
    throw new WorkflowError(
      "workflow_import_error",
      `URL-style workflow import rejected: ${importPath}`,
    );
  }
  if (extname(importPath) !== ".md") {
    throw new WorkflowError(
      "workflow_import_error",
      `workflow import must be a .md file: ${importPath}`,
    );
  }

  const resolved = resolve(currentDir, importPath);
  assertInsideRoot(resolved, rootReal, importPath);
  return resolved;
}

function assertInsideRoot(path: string, rootReal: string, importPath: string): void {
  if (path !== rootReal && !path.startsWith(rootReal + sep)) {
    throw new WorkflowError(
      "workflow_import_error",
      `workflow import escapes root directory: ${importPath}`,
    );
  }
}
