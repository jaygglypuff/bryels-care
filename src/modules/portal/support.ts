import "server-only";
import { and, eq } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { auditEvents, customerPortalTenants, customers, organizations, portalUsers } from "@/db/schema";
import { DomainError } from "@/lib/errors";
import { consume, type LimitResult } from "@/lib/rate-limit";
import { getSetting } from "@/lib/settings";
import { capabilitiesFor, isPortalRole } from "./capabilities";
import { PortalAuthContext } from "./context";
import { validatePortalSessionToken } from "./sessions";

/** Audit row written by portal code: actor_id null (it references internal users), actor_label `portal_user:<id>` or the staff path. */
export async function portalAudit(
  q: DbOrTx,
  e: {
    organizationId: string;
    actorLabel: string | null;
    actorId?: string | null;
    action: `${string}.${string}.${string}`;
    entityType: string;
    entityId?: string | null;
    entityNumber?: string | null;
    siteId?: string | null;
    reason?: string | null;
    before?: unknown;
    after?: unknown;
    correlationId?: string | null;
  },
) {
  await q.insert(auditEvents).values({
    organizationId: e.organizationId,
    siteId: e.siteId ?? null,
    actorId: e.actorId ?? null,
    actorLabel: e.actorLabel,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId ?? null,
    entityNumber: e.entityNumber ?? null,
    reason: e.reason ?? null,
    before: (e.before as object) ?? null,
    after: (e.after as object) ?? null,
    correlationId: e.correlationId ?? null,
  });
}

export const portalActor = (portalUserId: string) => `portal_user:${portalUserId}`;

async function defaultOrganizationId(): Promise<string | null> {
  // Before sign-in there is no organization yet; the deployment serves one (ADR-011).
  const [o] = await db.select({ id: organizations.id }).from(organizations).limit(1);
  return o?.id ?? null;
}

/**
 * Unauthenticated portal requests (sign-in, invitation, demo sign-in): per client IP and minute
 * (docs/security.md §4.5 "Portal unauthenticated 30 / minute per IP"; setting portal.rate_limits).
 */
export async function limitPortalUnauthenticated(ip: string | null | undefined, now: Date = new Date()): Promise<LimitResult> {
  const org = await defaultOrganizationId();
  const limit = org ? (await getSetting(db, org, "portal.rate_limits")).unauthenticated_per_minute : 30;
  return consume(db, { scope: "portal_unauth_ip", key: ip || "local", limit: { capacity: limit, windowSeconds: 60 }, now });
}

/** Signed-in portal requests: per portal user and minute (API routes and order placement). */
export async function limitPortalUser(ctx: PortalAuthContext, now: Date = new Date()): Promise<void> {
  const limit = (await getSetting(db, ctx.organizationId, "portal.rate_limits")).authenticated_per_minute;
  const r = await consume(db, { scope: "portal_user", key: ctx.portalUserId, limit: { capacity: limit, windowSeconds: 60 }, now });
  if (!r.allowed) throw new DomainError("rate_limited", `Too many requests. Wait ${r.retryAfterSeconds} seconds, then try again.`, { retryAfterSeconds: r.retryAfterSeconds });
}

/**
 * Resolves a portal cookie value to a context, or null. Read fresh on every request: the session
 * (revocation, idle, absolute), the user (must be active), the tenant (must be active) and the
 * customer (not inactive). Nothing here reads or accepts the internal staff session.
 */
export async function buildPortalContext(token: string | null | undefined, opts: { now?: Date; correlationId?: string | null } = {}): Promise<PortalAuthContext | null> {
  if (!token) return null;
  const s = await validatePortalSessionToken(token, { now: opts.now });
  if (!s) return null;
  const [row] = await db
    .select({ u: portalUsers, t: customerPortalTenants, customerName: customers.name, customerStatus: customers.status })
    .from(portalUsers)
    .innerJoin(customerPortalTenants, eq(customerPortalTenants.id, portalUsers.tenantId))
    .innerJoin(customers, eq(customers.id, customerPortalTenants.customerId))
    .where(and(eq(portalUsers.id, s.portalUserId), eq(customerPortalTenants.id, s.tenantId)))
    .limit(1);
  if (!row || row.u.status !== "active" || row.t.status !== "active" || row.customerStatus === "inactive") return null;
  if (!isPortalRole(row.u.portalRole)) return null;
  return new PortalAuthContext(
    row.u.id,
    row.t.id,
    row.t.customerId,
    row.u.organizationId,
    row.t.siteId,
    row.u.email,
    row.u.displayName,
    row.customerName,
    row.u.portalRole,
    capabilitiesFor(row.u.portalRole),
    { sessionId: s.id, correlationId: opts.correlationId ?? null, mfaEnabled: !!row.u.totpConfirmedAt },
  );
}

/** Today's business date in Asia/Manila (YYYY-MM-DD). */
export function manilaDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
