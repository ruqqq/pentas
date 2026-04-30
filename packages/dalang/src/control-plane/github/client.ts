import { ControlPlaneError } from "../adapter";

export interface GithubClientConfig {
  token: string;
  apiBaseUrl?: string;
  graphqlUrl?: string;
}

export class GithubClient {
  private readonly token: string;
  private readonly apiBaseUrl: string;
  private readonly graphqlUrl: string;

  constructor(cfg: GithubClientConfig) {
    this.token = cfg.token;
    this.apiBaseUrl = cfg.apiBaseUrl ?? "https://api.github.com";
    this.graphqlUrl = cfg.graphqlUrl ?? "https://api.github.com/graphql";
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${this.token}`,
      "x-github-api-version": "2022-11-28",
      ...extra,
    };
  }

  async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    let res: Response;
    try {
      res = await fetch(this.graphqlUrl, {
        method: "POST",
        headers: this.headers({ "content-type": "application/json" }),
        body: JSON.stringify({ query, variables }),
      });
    } catch (err) {
      throw new ControlPlaneError("control_plane_request_error", `github graphql: ${(err as Error).message}`);
    }

    if (!res.ok) {
      throw new ControlPlaneError("control_plane_status_error", `github graphql: HTTP ${res.status}`);
    }
    const body = await this.readJson(res, "github graphql");
    if (body && typeof body === "object" && Array.isArray((body as { errors?: unknown }).errors)) {
      const msg = (body as { errors: Array<{ message?: string }> }).errors
        .map((e) => e.message ?? "unknown")
        .join("; ");
      throw new ControlPlaneError("control_plane_status_error", `github graphql: ${msg}`);
    }
    if (!body || typeof body !== "object" || !("data" in body)) {
      throw new ControlPlaneError("control_plane_malformed_payload", "github graphql: missing data");
    }
    return (body as { data: T }).data;
  }

  async restJson<T = unknown>(path: string, method: "GET" | "POST" | "PATCH", payload?: unknown): Promise<T> {
    const url = `${this.apiBaseUrl}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: this.headers(payload === undefined ? {} : { "content-type": "application/json" }),
        body: payload === undefined ? undefined : JSON.stringify(payload),
      });
    } catch (err) {
      throw new ControlPlaneError("control_plane_request_error", `${url}: ${(err as Error).message}`);
    }

    if (!res.ok) {
      throw new ControlPlaneError("control_plane_status_error", `${url}: HTTP ${res.status}`);
    }
    const body = await this.readJson(res, url);
    return body as T;
  }

  private async readJson(res: Response, context: string): Promise<unknown> {
    try {
      const text = await res.text();
      return text.length === 0 ? null : JSON.parse(text);
    } catch (err) {
      throw new ControlPlaneError("control_plane_malformed_payload", `${context}: ${(err as Error).message}`);
    }
  }
}
