const LINEAR_URL_RE = /^https:\/\/linear\.app\/[^/]+\/issue\/([A-Z][A-Z0-9]+-\d+)(?:\/.*)?$/;

export interface ParsedLinearUrl {
  external_ref: string;
  external_url: string;
}

export function parseLinearUrl(input: string): ParsedLinearUrl | null {
  const match = LINEAR_URL_RE.exec(input.trim());
  if (!match) return null;
  return { external_ref: match[1]!, external_url: input.trim() };
}
