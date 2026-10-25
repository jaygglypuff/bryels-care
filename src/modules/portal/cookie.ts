import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { acceptableRequestId } from "@/lib/log";
import type { PortalAuthContext } from "./context";
import { buildPortalContext } from "./support";

/**
 * The portal cookie (docs/security.md §3.4 "Portal"). Its own name, never `bc_session`: the staff
 * AuthContext reads only `bc_session`, the portal context reads only `bc_portal`, so neither session
 * opens the other side (`authz.portal.tenant_isolation`: internal endpoints answer 401 to a portal
 * cookie and portal endpoints answer 401 to a staff cookie). Path `/` because both `/portal/*` pages
 * and `/api/portal/*` routes need it; HttpOnly, SameSite=Lax, Secure in production. A short-lived
 * `bc_portal_mfa` cookie carries the pending TOTP step.
 */
export const PORTAL_COOKIE = "bc_portal";
export const PORTAL_MFA_COOKIE = "bc_portal_mfa";

const base = () => ({ httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/" });

export async function setPortalCookie(token: string, expiresAt: Date) {
  (await cookies()).set(PORTAL_COOKIE, token, { ...base(), expires: expiresAt });
}
export async function readPortalToken(): Promise<string | null> {
  return (await cookies()).get(PORTAL_COOKIE)?.value ?? null;
}
export async function clearPortalCookie() {
  (await cookies()).delete(PORTAL_COOKIE);
}
export async function setPortalMfaCookie(token: string, expiresAt: Date) {
  (await cookies()).set(PORTAL_MFA_COOKIE, token, { ...base(), expires: expiresAt });
}
export async function readPortalMfaToken(): Promise<string | null> {
  return (await cookies()).get(PORTAL_MFA_COOKIE)?.value ?? null;
}
export async function clearPortalMfaCookie() {
  (await cookies()).delete(PORTAL_MFA_COOKIE);
}

/** Per-request portal context for pages and server actions; null when signed out of the portal. */
export const getPortalContext = cache(async (): Promise<PortalAuthContext | null> => {
  const token = await readPortalToken();
  if (!token) return null;
  const requestId = acceptableRequestId((await headers()).get("x-request-id"));
  return buildPortalContext(token, { correlationId: requestId });
});

export async function requirePortalContext(): Promise<PortalAuthContext> {
  const ctx = await getPortalContext();
  if (!ctx) redirect("/portal/sign-in");
  return ctx;
}

/** The portal cookie value of a route-handler request (Cookie header), never the staff cookie. */
export function portalTokenFromRequest(req: Request): string | null {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === PORTAL_COOKIE) return decodeURIComponent(v.join("="));
  }
  return null;
}

/** Context for `/api/portal/*` route handlers. */
export async function portalContextFromRequest(req: Request): Promise<PortalAuthContext | null> {
  return buildPortalContext(portalTokenFromRequest(req), { correlationId: acceptableRequestId(req.headers.get("x-request-id")) });
}
