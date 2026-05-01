export interface NormalizedIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  priority: number | null;
  state: string;
  branch_name: string | null;
  url: string | null;
  external_ref: string | null;
  internal_ref: string;
  labels: string[];
  blocked_by: { id: string | null; identifier: string | null; state: string | null }[];
  project?: { id: string; slug: string; name: string } | null;
  created_at: string | null;
  updated_at: string | null;
}
