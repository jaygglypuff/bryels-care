import { NextResponse, type NextRequest } from "next/server";
import { maintenanceBlocks, maintenanceResponse } from "@/lib/maintenance-mode";

/**
 * Correlation ids (US-1-25 AC1, docs/deployment-railway.md §7): an incoming `X-Request-Id` that is
 * a safe token (8–100 of `[A-Za-z0-9._-]`) is kept, otherwise a UUID is generated. The id is passed
 * to the route as the `x-request-id` request header (read by the AuthContext as the correlation id
 * of every audit row, and by the API pipeline and logger) and echoed in the response.
 *
 * `MAINTENANCE_MODE=1` (restores, ADR-115 §4): every request except /api/health and /api/ready gets the
 * plain 503 maintenance page (src/lib/maintenance-mode.ts) before any route runs.
 *
 * Edge runtime, no I/O: authorization and the read-only maintenance mode are enforced in the
 * service layer (src/lib/auth/context.ts), never here.
 */
export function middleware(req: NextRequest) {
  const incoming = req.headers.get("x-request-id");
  const requestId = incoming && /^[A-Za-z0-9._-]{8,100}$/.test(incoming) ? incoming : crypto.randomUUID();
  // Written out literally so Next.js passes the variable to the middleware at run time.
  if (maintenanceBlocks(req.nextUrl.pathname, process.env.MAINTENANCE_MODE)) {
    const res = maintenanceResponse();
    res.headers.set("X-Request-Id", requestId);
    return res;
  }
  const headers = new Headers(req.headers);
  headers.set("x-request-id", requestId);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("X-Request-Id", requestId);
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
