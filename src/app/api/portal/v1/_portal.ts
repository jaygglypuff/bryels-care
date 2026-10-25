import "server-only";
import { DomainError, HTTP_STATUS } from "@/lib/errors";
import { reportErrorInBackground } from "@/lib/log/error-reporter";
import { type PortalAuthContext, limitPortalUser, portalContextFromRequest } from "@/modules/portal";

/**
 * `/api/portal/v1/*` (docs/permissions-matrix.md §7 "Surface"): thin adapters over src/modules/portal.
 * Authenticated ONLY by the portal cookie (`bc_portal`); the staff cookie opens nothing here (401), and
 * the staff `/api/v1` pipeline never accepts the portal cookie. Per-portal-user rate limit
 * (setting portal.rate_limits); errors map to the same envelope as `/api/v1`; foreign ids are 404.
 */
const CODE: Record<string, string> = { forbidden: "PERMISSION_DENIED", unauthenticated: "UNAUTHENTICATED", rate_limited: "RATE_LIMITED", read_only: "READ_ONLY_MODE", state: "INVALID_STATE" };
const NO_STORE = { "Cache-Control": "private, no-store" };

export function portalError(e: unknown): Response {
  if (e instanceof DomainError) {
    const details = e.details?.fieldErrors ? { fields: e.details.fieldErrors } : typeof e.details?.field === "string" ? { field: e.details.field } : undefined;
    const headers: Record<string, string> = { ...NO_STORE };
    if (e.code === "rate_limited" && typeof e.details?.retryAfterSeconds === "number") headers["Retry-After"] = String(e.details.retryAfterSeconds);
    return Response.json({ ok: false, error: { code: CODE[e.code] ?? e.code.toUpperCase(), message: e.message, ...(details ? { details } : {}) } }, { status: HTTP_STATUS[e.code], headers });
  }
  reportErrorInBackground(e, { routeType: "route" });
  return Response.json({ ok: false, error: { code: "INTERNAL", message: "Something went wrong. Nothing was saved." } }, { status: 500, headers: NO_STORE });
}

/** CSRF defence for portal commands: the Origin must match APP_ORIGIN when set (else the Host). */
export function assertPortalSameOrigin(req: Request) {
  const allowed = process.env.APP_ORIGIN;
  const origin = req.headers.get("origin");
  if (allowed && origin !== allowed) throw new DomainError("forbidden", "Request origin not allowed.");
  if (!allowed && origin && new URL(origin).host !== req.headers.get("host")) throw new DomainError("forbidden", "Request origin not allowed.");
}

export function portalRoute<P = Record<string, string>>(handler: (ctx: PortalAuthContext, req: Request, params: P) => Promise<unknown>) {
  return async (req: Request, route: { params: Promise<P> }) => {
    try {
      const ctx = await portalContextFromRequest(req);
      if (!ctx) return Response.json({ ok: false, error: { code: "UNAUTHENTICATED", message: "Sign in to the customer portal to continue." } }, { status: 401, headers: NO_STORE });
      await limitPortalUser(ctx);
      const data = await handler(ctx, req, ((await route?.params) ?? {}) as P);
      return Response.json({ ok: true, data }, { headers: NO_STORE });
    } catch (e) {
      return portalError(e);
    }
  };
}
