export interface Project {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export const DEFAULT_PROJECT_SLUG = "default";
export const DEFAULT_PROJECT_ID = "default";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function isValidProjectSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}
