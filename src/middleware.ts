import { NextResponse, type NextRequest } from "next/server";

/**
 * Correlation ids (US-1-25 AC1, docs/deployment-railway.md §7): an incoming `X-Request-Id` that is
 * a safe token (8–100 of `[A-Za-z0-9._-]`) is kept, otherwise a UUID is generated. The id is passed
 * to the route as the `x-request-id` request header (read by the AuthContext as the correlation id
 * of every audit row, and by the API pipeline and logger) and echoed in the response.
 *
 * Edge runtime, no I/O: authorization and the read-only maintenance mode are enforced in the
 * service layer (src/lib/auth/context.ts), never here.
 */
export function middleware(req: NextRequest) {
  const incoming = req.headers.get("x-request-id");
  const requestId = incoming && /^[A-Za-z0-9._-]{8,100}$/.test(incoming) ? incoming : crypto.randomUUID();
  const headers = new Headers(req.headers);
  headers.set("x-request-id", requestId);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("X-Request-Id", requestId);
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
