export type AuthCheck = (req: Request) => Response | null;

export function authMiddleware(token: string | undefined): AuthCheck {
  return (req) => {
    if (!token) return null;
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/v1/")) return null;
    const header = req.headers.get("authorization");
    if (header === `Bearer ${token}`) return null;
    return Response.json(
      { error: { code: "unauthorized", message: "missing or invalid bearer token" } },
      { status: 401 },
    );
  };
}
