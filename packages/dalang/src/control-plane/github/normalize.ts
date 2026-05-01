import type { OwnershipRule } from "../adapter";
import type { WorkItem } from "../../types";

function nodes(raw: unknown): unknown[] {
  if (raw === null || typeof raw !== "object") return [];
  const n = (raw as { nodes?: unknown }).nodes;
  return Array.isArray(n) ? n : [];
}

function lowerNames(raw: unknown): string[] {
  return nodes(raw).flatMap((x) => {
    if (x !== null && typeof x === "object" && typeof (x as { name?: unknown }).name === "string") {
      return [(x as { name: string }).name.toLowerCase()];
    }
    return [];
  });
}

function assigneeLogins(raw: unknown): string[] {
  return nodes(raw).flatMap((x) => {
    if (
      x !== null &&
      typeof x === "object" &&
      typeof (x as { login?: unknown }).login === "string"
    ) {
      return [(x as { login: string }).login.toLowerCase()];
    }
    return [];
  });
}

function fieldValues(item: unknown): Array<Record<string, unknown>> {
  if (item === null || typeof item !== "object") return [];
  const fv = (item as { fieldValues?: { nodes?: unknown } }).fieldValues;
  return nodes(fv).filter((x): x is Record<string, unknown> => x !== null && typeof x === "object");
}

function hasTruncatedFieldValues(item: unknown): boolean {
  if (item === null || typeof item !== "object") return false;
  const fv = (item as { fieldValues?: { pageInfo?: unknown } }).fieldValues;
  const pageInfo = fv && typeof fv === "object" ? fv.pageInfo : null;
  return Boolean(
    pageInfo &&
    typeof pageInfo === "object" &&
    (pageInfo as { hasNextPage?: unknown }).hasNextPage === true,
  );
}

function fieldName(v: Record<string, unknown>): string | null {
  const field = v.field;
  if (
    field !== null &&
    typeof field === "object" &&
    typeof (field as { name?: unknown }).name === "string"
  ) {
    return (field as { name: string }).name;
  }
  return null;
}

function singleSelectValue(item: unknown, field: string): string | null {
  for (const v of fieldValues(item)) {
    if (fieldName(v) === field && typeof v.name === "string") return v.name;
  }
  return null;
}

function textValue(item: unknown, field: string): string | null {
  for (const v of fieldValues(item)) {
    if (fieldName(v) === field && typeof v.text === "string") return v.text;
  }
  return null;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
}

export function deriveBranchName(
  number: number,
  title: string,
  branchPrefix = "dalang/",
  repository?: string,
): string {
  if (repository) return `${branchPrefix}${slugify(`${repository}#${number}`)}`;
  const slug = slugify(title).slice(0, 48);
  return `${branchPrefix}${number}-${slug || "issue"}`;
}

export function githubProjectItemToWorkItem(
  item: unknown,
  cfg: {
    repository: string;
    statusField: string;
    branchField: string | null;
    branchPrefix?: string | undefined;
  },
): WorkItem | null {
  if (item === null || typeof item !== "object") return null;
  if (hasTruncatedFieldValues(item)) return null;
  const i = item as Record<string, unknown>;
  const content = i.content;
  if (content === null || typeof content !== "object") return null;
  const c = content as Record<string, unknown>;
  if (c.__typename !== "Issue") return null;
  if (
    typeof i.id !== "string" ||
    typeof c.id !== "string" ||
    typeof c.number !== "number" ||
    typeof c.title !== "string"
  ) {
    return null;
  }
  const state = singleSelectValue(item, cfg.statusField);
  if (!state) return null;

  const branch = cfg.branchField ? textValue(item, cfg.branchField) : null;
  const externalRef = `${cfg.repository}#${c.number}`;
  const issueUpdated = typeof c.updatedAt === "string" ? c.updatedAt : null;
  const itemUpdated = typeof i.updatedAt === "string" ? i.updatedAt : null;
  const project = typeof i.project === "string" ? i.project : null;
  return {
    id: i.id,
    identifier: `${cfg.repository}#${c.number}`,
    title: c.title,
    description: typeof c.body === "string" ? c.body : null,
    priority: null,
    state,
    branch_name:
      branch || deriveBranchName(c.number, c.title, cfg.branchPrefix ?? "", cfg.repository),
    url: typeof c.url === "string" ? c.url : null,
    external_ref: externalRef,
    internal_ref: c.id,
    labels: lowerNames(c.labels),
    blocked_by: [],
    project,
    created_at: typeof c.createdAt === "string" ? new Date(c.createdAt).toISOString() : null,
    updated_at:
      [issueUpdated, itemUpdated]
        .filter((x): x is string => typeof x === "string")
        .sort()
        .at(-1) ?? null,
  };
}

export function githubItemMatchesOwnership(item: unknown, ownership: OwnershipRule): boolean {
  if (ownership.mode === "none") return true;
  if (item === null || typeof item !== "object") return false;
  const content = (item as { content?: unknown }).content;
  if (content === null || typeof content !== "object") return false;
  const c = content as Record<string, unknown>;

  if (ownership.mode === "label")
    return lowerNames(c.labels).includes(ownership.value.toLowerCase());
  if (ownership.mode === "assignee")
    return assigneeLogins(c.assignees).includes(ownership.value.toLowerCase());
  return singleSelectValue(item, ownership.field)?.toLowerCase() === ownership.value.toLowerCase();
}
