export interface Comment {
  id: string;
  issue_id: string;
  body: string;
  body_html: string;
  author: "user" | "agent";
  created_at: string;
}
