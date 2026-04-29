export type AuthCheck = (req: Request) => Response | null;

export function authMiddleware(token: string | undefined): AuthCheck {
  return (req) => {
    if (!token) return null;
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/v1/")) return null;
    // SSE feed for the UI: EventSource can't send Authorization headers, and
    // the UI HTML routes that consume it are already public.
    if (url.pathname === "/api/v1/events") return null;
    const header = req.headers.get("authorization");
    if (header === `Bearer ${token}`) return null;
    return Response.json(
      { error: { code: "unauthorized", message: "missing or invalid bearer token" } },
      { status: 401 },
    );
  };
}
