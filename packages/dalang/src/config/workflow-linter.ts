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

const PROMPT_CONTEXT: Record<string, SchemaNode> = {
  issue: {
    fields: Object.fromEntries(ISSUE_FIELDS.map((field) => [field, true])),
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

const KNOWN_FILTERS = new Set([
  "abs",
  "append",
  "at_least",
  "at_most",
  "capitalize",
  "ceil",
  "compact",
  "concat",
  "date",
  "default",
  "divided_by",
  "downcase",
  "escape",
  "escape_once",
  "first",
  "floor",
  "join",
  "last",
  "lstrip",
  "map",
  "minus",
  "modulo",
  "newline_to_br",
  "plus",
  "prepend",
  "remove",
  "remove_first",
  "replace",
  "replace_first",
  "reverse",
  "round",
  "rstrip",
  "size",
  "slice",
  "sort",
  "sort_natural",
  "split",
  "strip",
  "strip_html",
  "strip_newlines",
  "times",
  "truncate",
  "truncatewords",
  "uniq",
  "upcase",
  "url_decode",
  "url_encode",
  "where",
]);

const liquid = new Liquid({ strictVariables: true, strictFilters: true });

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

  const loopScopes = collectLoopScopes(template, diagnostics);
  for (const variablePath of collectVariablePaths(template)) {
    if (!isKnownPath(variablePath, loopScopes)) {
      diagnostics.push({
        severity: "error",
        code: "unknown_liquid_variable",
        message: `Unknown Liquid variable path \`${variablePath}\``,
      });
    }
  }
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

function collectLoopScopes(
  template: string,
  diagnostics: WorkflowLintDiagnostic[],
): Map<string, SchemaNode> {
  const scopes = new Map<string, SchemaNode>();
  const forTag = /{%\s*for\s+([A-Za-z_]\w*)\s+in\s+([^%]+?)\s*%}/g;
  for (const match of template.matchAll(forTag)) {
    const variable = match[1]!;
    const collection = normalizePath(stripLiquidStrings(match[2]!.trim()));
    const collectionNode = resolvePath(collection, scopes);
    const itemNode =
      collectionNode && typeof collectionNode === "object" ? collectionNode.array : undefined;
    if (!itemNode) {
      diagnostics.push({
        severity: "error",
        code: "invalid_liquid_for",
        message: `Invalid Liquid for-loop collection \`${collection}\``,
      });
      continue;
    }
    scopes.set(variable, itemNode);
  }
  return scopes;
}

function collectVariablePaths(template: string): string[] {
  const out = new Set<string>();
  const outputTag = /{{\s*([^}]+?)\s*}}/g;
  const ifTag = /{%\s*(?:if|elsif|unless)\s+([^%]+?)\s*%}/g;
  for (const match of template.matchAll(outputTag)) {
    collectExpressionPaths(match[1]!, out);
  }
  for (const match of template.matchAll(ifTag)) {
    collectExpressionPaths(match[1]!, out);
  }
  return [...out];
}

function collectExpressionPaths(expression: string, out: Set<string>): void {
  const beforeFilters = expression.split("|")[0] ?? expression;
  const pathPattern = /\b[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*\b/g;
  for (const match of stripLiquidStrings(beforeFilters).matchAll(pathPattern)) {
    const candidate = normalizePath(match[0]!);
    if (!LIQUID_EXPRESSION_KEYWORDS.has(candidate)) out.add(candidate);
  }
}

function collectFilters(template: string): string[] {
  const out = new Set<string>();
  const outputTag = /{{\s*([^}]+?)\s*}}/g;
  for (const match of template.matchAll(outputTag)) {
    const parts = match[1]!.split("|").slice(1);
    for (const part of parts) {
      const filter = part.trim().match(/^([A-Za-z_]\w*)/)?.[1];
      if (filter) out.add(filter);
    }
  }
  return [...out];
}

function isKnownPath(path: string, loopScopes: Map<string, SchemaNode>): boolean {
  return resolvePath(path, loopScopes) !== null;
}

function resolvePath(path: string, loopScopes: Map<string, SchemaNode>): SchemaNode | null {
  const parts = normalizePath(path).split(".");
  const [root, ...rest] = parts;
  let node = root ? (loopScopes.get(root) ?? PROMPT_CONTEXT[root]) : undefined;
  for (const part of rest) {
    if (!node || node === true || !("fields" in node) || !node.fields) return null;
    node = node.fields[part];
  }
  return node ?? null;
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
