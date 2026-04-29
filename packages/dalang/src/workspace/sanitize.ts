// packages/dalang/src/workspace/sanitize.ts
const ALLOWED = /^[A-Za-z0-9._-]$/;

export function sanitizeWorkspaceKey(identifier: string): string {
  if (!identifier) {
    throw new Error("workspace key: identifier must be non-empty");
  }
  let out = "";
  for (const ch of identifier) {
    out += ALLOWED.test(ch) ? ch : "_";
  }
  return out;
}
