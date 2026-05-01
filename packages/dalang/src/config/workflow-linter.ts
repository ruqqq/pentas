import { Liquid } from "liquidjs";
import type { WorkflowFrontMatter } from "./schema";
import { loadWorkflow, WorkflowError } from "./workflow-loader";

export type WorkflowLintSeverity = "error";

export interface WorkflowLintDiagnostic {
  severity: WorkflowLintSeverity;
  code:
    | "workflow_load_error"
    | "unknown_liquid_variable"
    | "unknown_liquid_filter"
    | "invalid_liquid_for"
    | "invalid_pr_checks_state";
  message: string;
}

export interface WorkflowLintResult {
  ok: boolean;
  diagnostics: WorkflowLintDiagnostic[];
}

type SchemaNode =
  | true
  | { readonly array?: SchemaNode; readonly fields?: Record<string, SchemaNode> };

const ISSUE_FIELDS = [
  "id",
  "identifier",
  "title",
  "description",
  "priority",
  "state",
  "branch_name",
  "url",
  "external_ref",
  "internal_ref",
  "labels",
  "blocked_by",
  "project",
  "created_at",
  "updated_at",
] as const;

const ISSUE_FIELD_SCHEMA: Record<(typeof ISSUE_FIELDS)[number], SchemaNode> =
  Object.fromEntries(ISSUE_FIELDS.map((field) => [field, true])) as Record<
    (typeof ISSUE_FIELDS)[number],
    SchemaNode
  >;

ISSUE_FIELD_SCHEMA.labels = { array: true };
ISSUE_FIELD_SCHEMA.blocked_by = {
  array: {
    fields: {
      id: true,
      identifier: true,
      state: true,
    },
  },
};

const PROMPT_CONTEXT: Record<string, SchemaNode> = {
  issue: {
    fields: ISSUE_FIELD_SCHEMA,
  },
  attempt: true,
  control_plane: {
    fields: {
      kind: true,
      endpoint: true,
      api_key: true,
    },
  },
  tracker: {
    fields: {
      kind: true,
      endpoint: true,
      api_key: true,
    },
  },
  recent_comments: {
    array: {
      fields: {
        id: true,
        author: true,
        body: true,
        created_at: true,
      },
    },
  },
  recent_history: {
    array: {
      fields: {
        id: true,
        issue_id: true,
        kind: true,
        from_value: true,
        to_value: true,
        actor: true,
        at: true,
      },
    },
  },
};

const liquid = new Liquid({ strictVariables: true, strictFilters: true });
const KNOWN_FILTERS = getLiquidFilterNames(liquid);

const LIQUID_EXPRESSION_KEYWORDS = new Set([
  "and",
  "or",
  "not",
  "contains",
  "true",
  "false",
  "nil",
  "null",
  "empty",
  "blank",
]);

export async function lintWorkflow(path: string): Promise<WorkflowLintResult> {
  const diagnostics: WorkflowLintDiagnostic[] = [];
  let loaded: Awaited<ReturnType<typeof loadWorkflow>>;
  try {
    loaded = await loadWorkflow(path);
  } catch (err) {
    diagnostics.push({
      severity: "error",
      code: "workflow_load_error",
      message:
        err instanceof WorkflowError
          ? `${err.code}: ${err.message}`
          : `workflow_load_error: ${(err as Error).message}`,
    });
    return { ok: false, diagnostics };
  }

  diagnostics.push(...lintLiquidTemplate(loaded.promptTemplate));
  diagnostics.push(...lintPrChecksStates(loaded.config));
  return { ok: diagnostics.length === 0, diagnostics };
}

export function lintLiquidTemplate(template: string): WorkflowLintDiagnostic[] {
  const diagnostics: WorkflowLintDiagnostic[] = [];
  try {
    liquid.parse(template);
  } catch (err) {
    diagnostics.push({
      severity: "error",
      code: "workflow_load_error",
      message: `Liquid parse failed: ${(err as Error).message}`,
    });
  }

  lintLiquidVariables(template, diagnostics);
  for (const filter of collectFilters(template)) {
    if (!KNOWN_FILTERS.has(filter)) {
      diagnostics.push({
        severity: "error",
        code: "unknown_liquid_filter",
        message: `Unknown Liquid filter \`${filter}\``,
      });
    }
  }
  return diagnostics;
}

type ScopeStack = Map<string, SchemaNode>[];

function lintLiquidVariables(
  template: string,
  diagnostics: WorkflowLintDiagnostic[],
): void {
  const scopes: ScopeStack = [new Map()];
  const seen = new Set<string>();
  const pendingCaptures: string[] = [];
  const tokenPattern = /{{-?\s*([\s\S]*?)\s*-?}}|{%-?\s*([\s\S]*?)\s*-?%}/g;

  for (const match of template.matchAll(tokenPattern)) {
    if (match[1] !== undefined) {
      lintExpressionPaths(match[1], scopes, diagnostics, seen);
      continue;
    }

    const tag = match[2]?.trim() ?? "";
    const forMatch = tag.match(/^for\s+([A-Za-z_]\w*)\s+in\s+([\s\S]+)$/);
    if (forMatch) {
      const variable = forMatch[1]!;
      const collectionExpression = stripForLoopModifiers(forMatch[2]!);
      lintExpressionPaths(collectionExpression, scopes, diagnostics, seen);
      const collection = firstExpressionPath(collectionExpression);
      const collectionNode = collection ? resolvePath(collection, scopes) : null;
      const itemNode =
        collectionNode && typeof collectionNode === "object" ? collectionNode.array : undefined;
      if (!itemNode) {
        diagnostics.push({
          severity: "error",
          code: "invalid_liquid_for",
          message: `Invalid Liquid for-loop collection \`${collection ?? collectionExpression.trim()}\``,
        });
        scopes.push(new Map());
        continue;
      }
      scopes.push(new Map([[variable, itemNode]]));
      continue;
    }

    if (tag === "endfor") {
      if (scopes.length > 1) scopes.pop();
      continue;
    }

    const assignMatch = tag.match(/^assign\s+([A-Za-z_]\w*)\s*=\s*([\s\S]+)$/);
    if (assignMatch) {
      const expression = assignMatch[2]!;
      lintExpressionPaths(expression, scopes, diagnostics, seen);
      scopes[scopes.length - 1]!.set(
        assignMatch[1]!,
        directPathExpressionNode(expression, scopes) ?? true,
      );
      continue;
    }

    const captureMatch = tag.match(/^capture\s+([A-Za-z_]\w*)$/);
    if (captureMatch) {
      pendingCaptures.push(captureMatch[1]!);
      continue;
    }

    if (tag === "endcapture") {
      const variable = pendingCaptures.pop();
      if (variable) scopes[scopes.length - 1]!.set(variable, true);
      continue;
    }

    const conditionalMatch = tag.match(/^(?:if|elsif|unless|case|when)\s+([\s\S]+)$/);
    if (conditionalMatch) lintExpressionPaths(conditionalMatch[1]!, scopes, diagnostics, seen);
  }
}

function lintExpressionPaths(
  expression: string,
  scopes: ScopeStack,
  diagnostics: WorkflowLintDiagnostic[],
  seen: Set<string>,
): void {
  for (const variablePath of collectExpressionPaths(expression)) {
    if (resolvePath(variablePath, scopes)) continue;
    const key = `unknown_liquid_variable:${variablePath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    diagnostics.push({
      severity: "error",
      code: "unknown_liquid_variable",
      message: `Unknown Liquid variable path \`${variablePath}\``,
    });
  }
}

function firstExpressionPath(expression: string): string | null {
  return collectPathCandidates((splitLiquidPipeline(expression)[0] ?? expression).trim())[0] ?? null;
}

function directPathExpressionNode(expression: string, scopes: ScopeStack): SchemaNode | null {
  const expressionHead = (splitLiquidPipeline(expression)[0] ?? "").trim();
  if (!/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(normalizePath(expressionHead))) return null;
  return resolvePath(expressionHead, scopes);
}

function stripForLoopModifiers(expression: string): string {
  return expression
    .trim()
    .replace(/\s+reversed\b/g, "")
    .replace(/\s+offset\s*:\s*continue\b/g, " ")
    .replace(/\s+(?:limit|offset)\s*:/g, " ");
}

function collectExpressionPaths(expression: string): string[] {
  const out = new Set<string>();
  const segments = splitLiquidPipeline(expression);
  collectPathCandidates(segments[0] ?? "").forEach((path) => out.add(path));
  for (const segment of segments.slice(1)) {
    const args = segment.replace(/^\s*[A-Za-z_]\w*\s*:?\s*/, "");
    collectPathCandidates(args).forEach((path) => out.add(path));
  }
  return [...out];
}

function collectPathCandidates(expression: string): string[] {
  const out = new Set<string>();
  const pathPattern = /\b[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*\b/g;
  for (const match of stripLiquidStrings(normalizePath(expression)).matchAll(pathPattern)) {
    const candidate = normalizePath(match[0]!);
    if (!LIQUID_EXPRESSION_KEYWORDS.has(candidate)) out.add(candidate);
  }
  return [...out];
}

function collectFilters(template: string): string[] {
  const out = new Set<string>();
  const expressionPattern = /{{-?\s*([\s\S]*?)\s*-?}}|{%-?\s*(?:assign\s+[A-Za-z_]\w*\s*=\s*|for\s+[A-Za-z_]\w*\s+in\s+|if\s+|elsif\s+|unless\s+|case\s+|when\s+)([\s\S]*?)\s*-?%}/g;
  for (const match of template.matchAll(expressionPattern)) {
    const expression = match[1] ?? match[2] ?? "";
    const parts = splitLiquidPipeline(expression).slice(1);
    for (const part of parts) {
      const filter = part.trim().match(/^([A-Za-z_]\w*)/)?.[1];
      if (filter) out.add(filter);
    }
  }
  return [...out];
}

function splitLiquidPipeline(expression: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < expression.length; i++) {
    const char = expression[i]!;
    if (quote) {
      current += char;
      if (char === quote && expression[i - 1] !== "\\") quote = null;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }

    if (char === "|") {
      parts.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  parts.push(current);
  return parts;
}

function resolvePath(path: string, scopes: ScopeStack): SchemaNode | null {
  const parts = normalizePath(path).split(".");
  const [root, ...rest] = parts;
  let node = root ? findScopedRoot(root, scopes) : undefined;
  if (!node && root) node = PROMPT_CONTEXT[root];
  for (const part of rest) {
    if (!node || node === true || !("fields" in node) || !node.fields) return null;
    node = node.fields[part];
  }
  return node ?? null;
}

function findScopedRoot(root: string, scopes: ScopeStack): SchemaNode | undefined {
  for (let i = scopes.length - 1; i >= 0; i--) {
    const node = scopes[i]!.get(root);
    if (node) return node;
  }
  return undefined;
}

function normalizePath(path: string): string {
  return path
    .replace(/\[['"]([^'"]+)['"]\]/g, ".$1")
    .replace(/\["([^"]+)"\]/g, ".$1")
    .trim();
}

function stripLiquidStrings(expression: string): string {
  return expression.replace(/"[^"]*"|'[^']*'/g, "");
}

function lintPrChecksStates(cfg: WorkflowFrontMatter): WorkflowLintDiagnostic[] {
  if (cfg.control_plane.kind !== "github-projects") return [];
  const prChecks = cfg.control_plane.pr_checks;
  if (!prChecks?.enabled) return [];

  const allowed = new Set([
    ...cfg.control_plane.active_states,
    ...cfg.control_plane.terminal_states,
  ]);
  const expected = [...allowed].join(", ");
  const checks = [
    ["wait_state", prChecks.wait_state],
    ["pass_state", prChecks.pass_state],
    ["fail_state", prChecks.fail_state],
    ["escalation_state", prChecks.escalation_state],
  ] as const;

  return checks.flatMap(([field, state]) =>
    allowed.has(state)
      ? []
      : [
          {
            severity: "error" as const,
            code: "invalid_pr_checks_state" as const,
            message: `Unknown pr_checks.${field} \`${state}\`; expected one of: ${expected}`,
          },
        ],
  );
}

interface LiquidFilterRegistry {
  readonly filters?: Record<string, unknown> & {
    readonly impls?: Record<string, unknown>;
  };
}

function getLiquidFilterNames(engine: Liquid): Set<string> {
  const registry = engine as LiquidFilterRegistry;
  const filters = registry.filters;
  return new Set(Object.keys(filters?.impls ?? filters ?? {}));
}
