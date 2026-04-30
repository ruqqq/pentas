import type { Database } from "bun:sqlite";
import { ulid } from "../../lib/ids";
import { renderMarkdown } from "../../lib/markdown";
import type { Comment } from "../../domain/comment";

export interface AddCommentInput {
  body: string;
  author?: "user" | "agent";
}

interface CommentRow {
  id: string;
  issue_id: string;
  body: string;
  author: "user" | "agent";
  created_at: string;
}

function rowToComment(row: CommentRow): Comment {
  return { ...row, body_html: renderMarkdown(row.body) };
}

export function addComment(db: Database, issueId: string, input: AddCommentInput): Comment {
  const id = ulid();
  const author = input.author ?? "user";
  const at = new Date().toISOString();
  db.query(
    "INSERT INTO comments (id, issue_id, body, author, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(id, issueId, input.body, author, at);
  return rowToComment({ id, issue_id: issueId, body: input.body, author, created_at: at });
}

export function listComments(db: Database, issueId: string): Comment[] {
  return db
    .query<CommentRow, [string]>(
      "SELECT * FROM comments WHERE issue_id = ? ORDER BY created_at ASC, id ASC",
    )
    .all(issueId)
    .map(rowToComment);
}
