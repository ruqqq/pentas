import type { Database } from "bun:sqlite";
import { ulid } from "../../lib/ids";
import {
  DEFAULT_PROJECT_ID,
  DEFAULT_PROJECT_SLUG,
  isValidProjectSlug,
  type Project,
} from "../../domain/project";

export interface CreateProjectInput {
  slug: string;
  name: string;
  description?: string | null;
}

export interface ProjectSummary extends Project {
  issue_count: number;
  active_issue_count: number;
  last_issue_updated_at: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function ensureDefaultProject(db: Database): Project {
  const now = nowIso();
  db.query(
    `INSERT OR IGNORE INTO projects
       (id, slug, name, description, created_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, ?)`,
  ).run(DEFAULT_PROJECT_ID, DEFAULT_PROJECT_SLUG, "Default", now, now);
  const project = getProjectBySlug(db, DEFAULT_PROJECT_SLUG);
  if (!project) throw new Error("default project was not created");
  return project;
}

export function getProjectBySlug(db: Database, slug: string): Project | null {
  return db.query<Project, [string]>("SELECT * FROM projects WHERE slug = ?").get(slug);
}

export function listProjects(db: Database): Project[] {
  return db.query<Project, []>("SELECT * FROM projects ORDER BY slug ASC").all();
}

export function listProjectSummaries(db: Database): ProjectSummary[] {
  return db
    .query<ProjectSummary, []>(
      `SELECT p.*,
              COUNT(i.id) AS issue_count,
              SUM(CASE WHEN i.state NOT IN ('Done', 'Cancelled') THEN 1 ELSE 0 END) AS active_issue_count,
              MAX(i.updated_at) AS last_issue_updated_at
         FROM projects p
         LEFT JOIN issues i ON i.project_id = p.id
        GROUP BY p.id
        ORDER BY p.slug ASC`,
    )
    .all()
    .map((p) => ({
      ...p,
      issue_count: Number(p.issue_count),
      active_issue_count: Number(p.active_issue_count ?? 0),
      last_issue_updated_at: p.last_issue_updated_at ?? null,
    }));
}

export function createProject(db: Database, input: CreateProjectInput): Project {
  const slug = input.slug.trim().toLowerCase();
  const name = input.name.trim();
  if (!isValidProjectSlug(slug)) throw new Error("invalid_project_slug");
  if (!name) throw new Error("missing_project_name");
  const id = ulid();
  const now = nowIso();
  db.query(
    `INSERT INTO projects
       (id, slug, name, description, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, slug, name, input.description ?? null, now, now);
  const project = getProjectBySlug(db, slug);
  if (!project) throw new Error("createProject: row vanished");
  return project;
}
