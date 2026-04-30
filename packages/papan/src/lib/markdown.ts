import { marked } from "marked";
import DOMPurify from "isomorphic-dompurify";

const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "br",
    "hr",
    "strong",
    "em",
    "del",
    "code",
    "pre",
    "ul",
    "ol",
    "li",
    "a",
    "blockquote",
    "img",
  ],
  ALLOWED_ATTR: ["href", "title", "src", "alt"],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
};

export function renderMarkdown(src: string): string {
  const raw = marked.parse(src) as string;
  return DOMPurify.sanitize(raw, PURIFY_CONFIG);
}
