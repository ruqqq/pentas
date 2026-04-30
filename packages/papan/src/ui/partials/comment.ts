import type { Comment } from "../../domain/comment";
import { escapeHtml } from "../layout";

export function renderComment(c: Comment): string {
  return `<article class="comment" data-author="${c.author}" id="comment-${escapeHtml(c.id)}">
  <header><strong>${c.author}</strong> · <time>${escapeHtml(c.created_at)}</time></header>
  <div class="body">${c.body_html}</div>
</article>`;
}
