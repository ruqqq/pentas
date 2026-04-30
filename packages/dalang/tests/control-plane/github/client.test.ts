import { afterEach, expect, test } from "bun:test";
import { GithubClient } from "../../../src/control-plane/github/client";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("graphql sends bearer token and returns data", async () => {
  const seen: RequestInit[] = [];
  globalThis.fetch = (async (_url, init) => {
    seen.push(init ?? {});
    return new Response(JSON.stringify({ data: { ok: true } }), { status: 200 });
  }) as typeof fetch;

  const client = new GithubClient({ token: "token-1" });
  const got = await client.graphql<{ ok: boolean }>("query { ok }", {});

  expect(got).toEqual({ ok: true });
  expect((seen[0]!.headers as Record<string, string>).authorization).toBe("Bearer token-1");
});

test("graphql throws on GitHub errors", async () => {
  globalThis.fetch = (async () => {
    return new Response(JSON.stringify({ errors: [{ message: "bad scope" }] }), { status: 200 });
  }) as unknown as typeof fetch;

  const client = new GithubClient({ token: "token-1" });
  await expect(client.graphql("query { viewer { login } }", {})).rejects.toThrow(/bad scope/);
});

test("rest posts issue comment", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = (async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ id: 123 }), { status: 201 });
  }) as typeof fetch;

  const client = new GithubClient({ token: "token-1" });
  await client.restJson("/repos/acme/app/issues/12/comments", "POST", { body: "done" });

  expect(calls[0]!.url).toBe("https://api.github.com/repos/acme/app/issues/12/comments");
  expect(calls[0]!.init.method).toBe("POST");
  expect(calls[0]!.init.body).toBe(JSON.stringify({ body: "done" }));
});

test("graphql classifies non-json HTTP errors by status", async () => {
  globalThis.fetch = (async () => {
    return new Response("<html>bad gateway</html>", { status: 502 });
  }) as unknown as typeof fetch;

  const client = new GithubClient({ token: "token-1" });
  await expect(client.graphql("query { viewer { login } }", {})).rejects.toMatchObject({
    code: "control_plane_status_error",
  });
});

test("graphql rejects missing data payload", async () => {
  globalThis.fetch = (async () => {
    return new Response(JSON.stringify({}), { status: 200 });
  }) as unknown as typeof fetch;

  const client = new GithubClient({ token: "token-1" });
  await expect(client.graphql("query { viewer { login } }", {})).rejects.toMatchObject({
    code: "control_plane_malformed_payload",
  });
});

test("rest classifies non-json HTTP errors by status", async () => {
  globalThis.fetch = (async () => {
    return new Response("nope", { status: 500 });
  }) as unknown as typeof fetch;

  const client = new GithubClient({ token: "token-1" });
  await expect(client.restJson("/repos/acme/app/issues/12/comments", "GET")).rejects.toMatchObject({
    code: "control_plane_status_error",
  });
});
