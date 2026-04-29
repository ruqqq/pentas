import { describe, expect, test } from "bun:test";
import { authMiddleware } from "../../src/api/auth";

describe("authMiddleware", () => {
  test("passes when no token configured", () => {
    const fn = authMiddleware(undefined);
    const req = new Request("http://x/api/v1/issues");
    expect(fn(req)).toBeNull();
  });

  test("rejects /api/v1/* without bearer when token configured", () => {
    const fn = authMiddleware("s3cret");
    const req = new Request("http://x/api/v1/issues");
    const res = fn(req);
    expect(res?.status).toBe(401);
  });

  test("passes /api/v1/* with correct bearer", () => {
    const fn = authMiddleware("s3cret");
    const req = new Request("http://x/api/v1/issues", {
      headers: { authorization: "Bearer s3cret" },
    });
    expect(fn(req)).toBeNull();
  });

  test("skips UI routes when token is configured", () => {
    const fn = authMiddleware("s3cret");
    expect(fn(new Request("http://x/"))).toBeNull();
    expect(fn(new Request("http://x/issues/abc"))).toBeNull();
    expect(fn(new Request("http://x/static/style.css"))).toBeNull();
  });
});
