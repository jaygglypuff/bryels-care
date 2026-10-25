import "server-only";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "@/db/client";
import { customerPortalTenants, customers, portalCatalogItems, portalInvitations, portalSessions, portalUsers, products, sites, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { appUrl, newToken, sha256 } from "@/lib/auth/tokens";
import { isDemoEmail, isDemoMode } from "@/lib/demo";
import { type SendResult, sendEmail } from "@/lib/email";
import { DomainError } from "@/lib/errors";
import { getSetting } from "@/lib/settings";
import { assertStepUp } from "@/modules/identity";
import { revokeOpenPortalInvitations } from "./auth";
import { PORTAL_ROLE_BUNDLES, isPortalRole, type PortalRole } from "./capabilities";
import { catalogueFor } from "./catalog";
import { revokePortalTenantSessions, revokePortalUserSessions } from "./sessions";
import { assertPortalTenantTransition, assertPortalUserTransition, type PortalUserStatus } from "./states";
import { isUuid } from "./support";

/**
 * Staff side of the portal (US-8-01, US-8-02): the "Portal access" panel on the customer page.
 * Internal AuthContext only. Permissions (docs/permissions-matrix.md §2.8, §3.8):
 *   - sales.portal_user.view / .admin (R): see and manage the tenant and its portal users; every change
 *     needs step-up re-authentication (restricted permission, docs/security.md §3.6);
 *   - sales.portal_catalog.view / .admin (S): see and define the tenant's approved catalogue.
 * A tenant belongs to the site that fulfils its portal orders; staff act on it only at that site
 * (`requireAt`), so a sales user of another site sees that portal access exists but cannot change it.
 */

type TenantRow = typeof customerPortalTenants.$inferSelect;
export type PortalDelivery = { status: SendResult["status"]; manualLink: string | null };

export const portalInvitationLink = (token: string) => appUrl(`/portal/invite#token=${token}`);

function requireReason(reason: unknown): string {
  const s = typeof reason === "string" ? reason.trim() : "";
  if (s.length < 5) throw new DomainError("validation", "Give a short reason (at least 5 characters).", { field: "reason" });
  if (s.length > 300) throw new DomainError("validation", "Keep the reason under 300 characters.", { field: "reason" });
  return s;
}

async function loadCustomer(ctx: AuthContext, customerId: string) {
  if (!isUuid(customerId)) throw new DomainError("not_found", "Customer not found.");
  const [c] = await db.select().from(customers).where(and(eq(customers.id, customerId), eq(customers.organizationId, ctx.organizationId))).limit(1);
  if (!c) throw new DomainError("not_found", "Customer not found.");
  return c;
}

async function lockTenant(tx: Tx, ctx: AuthContext, tenantId: string): Promise<TenantRow> {
  if (!isUuid(tenantId)) throw new DomainError("not_found", "Portal access not found.");
  const [t] = await tx.select().from(customerPortalTenants).where(and(eq(customerPortalTenants.id, tenantId), eq(customerPortalTenants.organizationId, ctx.organizationId))).for("update").limit(1);
  if (!t) throw new DomainError("not_found", "Portal access not found.");
  ctx.requireSite(t.siteId);
  return t;
}

async function lockPortalUser(tx: Tx, ctx: AuthContext, portalUserId: string) {
  if (!isUuid(portalUserId)) throw new DomainError("not_found", "Portal user not found.");
  const [row] = await tx
    .select({ u: portalUsers, t: customerPortalTenants })
    .from(portalUsers)
    .innerJoin(customerPortalTenants, eq(customerPortalTenants.id, portalUsers.tenantId))
    .where(and(eq(portalUsers.id, portalUserId), eq(portalUsers.organizationId, ctx.organizationId)))
    .for("update", { of: portalUsers })
    .limit(1);
  if (!row) throw new DomainError("not_found", "Portal user not found.");
  ctx.requireSite(row.t.siteId);
  return row;
}

/* ------------------------------------------------------------------ read */

export type PortalAccessView = Awaited<ReturnType<typeof getPortalAccess>>;

/** What the "Portal access" panel shows for a customer; null when the viewer may see none of it. */
export async function getPortalAccess(ctx: AuthContext, customerId: string) {
  const canUsers = ctx.can("sales.portal_user.view");
  const canCatalog = ctx.can("sales.portal_catalog.view");
  if (!canUsers && !canCatalog) throw new DomainError("forbidden", "You do not have permission to see portal access (sales.portal_user.view).");
  const c = await loadCustomer(ctx, customerId);
  const [t] = await db
    .select({ t: customerPortalTenants, siteCode: sites.code, siteName: sites.name })
    .from(customerPortalTenants)
    .innerJoin(sites, eq(sites.id, customerPortalTenants.siteId))
    .where(and(eq(customerPortalTenants.customerId, c.id), eq(customerPortalTenants.organizationId, ctx.organizationId)))
    .limit(1);
  const enableSites = ctx.allowedSites.filter((s) => ctx.canAt("sales.portal_user.admin", s.id));
  if (!t) return { customer: { id: c.id, name: c.name, status: c.status }, tenant: null, outOfScope: false, enableSites, users: null, catalog: null };
  if (!ctx.allowedSiteIds.includes(t.t.siteId)) {
    // The tenant exists but is managed by a site outside the viewer's scope: say so, show nothing else.
    return { customer: { id: c.id, name: c.name, status: c.status }, tenant: { id: t.t.id, status: t.t.status, siteCode: t.siteCode }, outOfScope: true, enableSites: [], users: null, catalog: null };
  }
  const now = new Date();
  const userRows = canUsers
    ? await db
        .select({
          u: portalUsers,
          openInvitationExpiresAt: sql<Date | null>`(select max(i.expires_at) from portal_invitations i where i.portal_user_id = portal_users.id and i.accepted_at is null and i.revoked_at is null)`,
          liveSessions: sql<number>`(select count(*)::int from portal_sessions s where s.portal_user_id = portal_users.id and s.revoked_at is null and s.expires_at > ${now.toISOString()}::timestamptz and s.idle_expires_at > ${now.toISOString()}::timestamptz)`,
        })
        .from(portalUsers)
        .where(eq(portalUsers.tenantId, t.t.id))
        .orderBy(asc(portalUsers.displayName))
    : null;
  let catalog: { mode: string; items: { productId: string; sku: string; name: string; priceFrom: string | null; currency: string; curated: boolean }[]; curatedIds: string[]; candidates: { id: string; sku: string; name: string }[] } | null = null;
  if (canCatalog) {
    const curatedIds = (await db.select({ productId: portalCatalogItems.productId }).from(portalCatalogItems).where(eq(portalCatalogItems.tenantId, t.t.id))).map((r) => r.productId);
    const priced = await catalogueFor(db, { organizationId: ctx.organizationId, customerId: c.id, tenantId: t.t.id, catalogMode: "all_priced" });
    const live = await catalogueFor(db, { organizationId: ctx.organizationId, customerId: c.id, tenantId: t.t.id, catalogMode: t.t.catalogMode });
    const liveIds = new Set(live.map((i) => i.productId));
    catalog = {
      mode: t.t.catalogMode,
      items: live.map((i) => ({ productId: i.productId, sku: i.sku, name: i.name, priceFrom: i.priceBreaks[0]?.unitAmount ?? null, currency: i.currency, curated: curatedIds.includes(i.productId) })),
      curatedIds,
      candidates: priced.filter((i) => !liveIds.has(i.productId) || !curatedIds.includes(i.productId)).map((i) => ({ id: i.productId, sku: i.sku, name: i.name })),
    };
  }
  return {
    customer: { id: c.id, name: c.name, status: c.status },
    tenant: { id: t.t.id, status: t.t.status, statusReason: t.t.statusReason, siteId: t.t.siteId, siteCode: t.siteCode, siteName: t.siteName, catalogMode: t.t.catalogMode, createdAt: t.t.createdAt },
    outOfScope: false,
    enableSites,
    users: userRows?.map((r) => ({
      id: r.u.id,
      email: r.u.email,
      displayName: r.u.displayName,
      status: r.u.status,
      statusReason: r.u.statusReason,
      portalRole: r.u.portalRole,
      roleName: isPortalRole(r.u.portalRole) ? PORTAL_ROLE_BUNDLES[r.u.portalRole].name : r.u.portalRole,
      lastLoginAt: r.u.lastLoginAt,
      mfaEnabled: !!r.u.totpConfirmedAt,
      openInvitationExpiresAt: r.openInvitationExpiresAt ? new Date(r.openInvitationExpiresAt) : null,
      liveSessions: Number(r.liveSessions),
    })) ?? null,
    catalog,
    canAdminUsers: ctx.canAt("sales.portal_user.admin", t.t.siteId),
    canAdminCatalog: ctx.canAt("sales.portal_catalog.admin", t.t.siteId),
  };
}

/* ------------------------------------------------------------------ tenant */

const ModeSchema = z.enum(["all_priced", "customer_price_list", "curated"]);

/** Turns the portal on for a customer (one tenant per customer), fulfilled by `siteId`. */
export async function enablePortal(ctx: AuthContext, customerId: string, input: { siteId: string; catalogMode?: string }, now: Date = new Date()): Promise<{ tenantId: string }> {
  ctx.require("sales.portal_user.admin");
  if (!isUuid(input.siteId)) throw new DomainError("validation", "Choose the site that fulfils this customer's portal orders.", { field: "siteId" });
  ctx.requireAt("sales.portal_user.admin", input.siteId);
  const mode = ModeSchema.safeParse(input.catalogMode ?? "all_priced");
  if (!mode.success) throw new DomainError("validation", "Choose what the customer may order.", { field: "catalogMode" });
  const c = await loadCustomer(ctx, customerId);
  if (c.status === "inactive" || c.status === "prospect") throw new DomainError("state", `${c.name} is ${c.status === "prospect" ? "a prospect" : "inactive"}; turn the portal on for active customers only.`);
  await assertStepUp(ctx, "turn on the customer portal", now);
  return db.transaction(async (tx) => {
    const [dup] = await tx.select({ id: customerPortalTenants.id }).from(customerPortalTenants).where(eq(customerPortalTenants.customerId, c.id)).limit(1);
    if (dup) throw new DomainError("conflict", "The portal is already on for this customer.");
    const [t] = await tx.insert(customerPortalTenants).values({ organizationId: ctx.organizationId, customerId: c.id, siteId: input.siteId, catalogMode: mode.data, status: "active", createdBy: ctx.userId, updatedBy: ctx.userId, createdAt: now, updatedAt: now }).returning();
    await audit(tx, ctx, { action: "sales.portal_tenant.enabled", entityType: "customer_portal_tenant", entityId: t.id, entityNumber: c.code, siteId: t.siteId, after: { customerId: c.id, siteId: t.siteId, catalogMode: t.catalogMode, status: "active" } });
    return { tenantId: t.id };
  });
}

/** Suspends (reason; every portal session of the tenant ends at once) or reactivates portal access. */
export async function setPortalTenantStatus(ctx: AuthContext, tenantId: string, to: "active" | "suspended", reason: string, now: Date = new Date()): Promise<void> {
  ctx.require("sales.portal_user.admin");
  const why = requireReason(reason);
  await assertStepUp(ctx, to === "suspended" ? "pause portal access" : "resume portal access", now);
  await db.transaction(async (tx) => {
    const t = await lockTenant(tx, ctx, tenantId);
    ctx.requireAt("sales.portal_user.admin", t.siteId);
    assertPortalTenantTransition(t.status, to);
    await tx.update(customerPortalTenants).set({ status: to, statusReason: to === "suspended" ? why : null, updatedBy: ctx.userId, updatedAt: now }).where(eq(customerPortalTenants.id, t.id));
    const revoked = to === "suspended" ? await revokePortalTenantSessions(tx, t.id, `portal access paused: ${why}`, now) : 0;
    await audit(tx, ctx, { action: to === "suspended" ? "sales.portal_tenant.suspended" : "sales.portal_tenant.reactivated", entityType: "customer_portal_tenant", entityId: t.id, siteId: t.siteId, reason: why, before: { status: t.status }, after: { status: to, sessionsRevoked: revoked } });
  });
}

/** What the customer may order: every priced product, only the customer's own price list, or a curated list. */
export async function setPortalCatalogMode(ctx: AuthContext, tenantId: string, mode: string, now: Date = new Date()): Promise<void> {
  ctx.require("sales.portal_catalog.admin");
  const m = ModeSchema.safeParse(mode);
  if (!m.success) throw new DomainError("validation", "Choose what the customer may order.", { field: "catalogMode" });
  await db.transaction(async (tx) => {
    const t = await lockTenant(tx, ctx, tenantId);
    ctx.requireAt("sales.portal_catalog.admin", t.siteId);
    if (t.catalogMode === m.data) return;
    await tx.update(customerPortalTenants).set({ catalogMode: m.data, updatedBy: ctx.userId, updatedAt: now }).where(eq(customerPortalTenants.id, t.id));
    await audit(tx, ctx, { action: "sales.portal_catalog.mode_changed", entityType: "customer_portal_tenant", entityId: t.id, siteId: t.siteId, before: { catalogMode: t.catalogMode }, after: { catalogMode: m.data } });
  });
}

/** Adds a product to the curated catalogue; it must be active and priced for the customer. */
export async function addPortalCatalogItem(ctx: AuthContext, tenantId: string, productId: string, now: Date = new Date()): Promise<void> {
  ctx.require("sales.portal_catalog.admin");
  if (!isUuid(productId)) throw new DomainError("validation", "Choose a product.", { field: "productId" });
  await db.transaction(async (tx) => {
    const t = await lockTenant(tx, ctx, tenantId);
    ctx.requireAt("sales.portal_catalog.admin", t.siteId);
    const priced = await catalogueFor(tx, { organizationId: ctx.organizationId, customerId: t.customerId, tenantId: t.id, catalogMode: "all_priced" });
    const item = priced.find((i) => i.productId === productId);
    if (!item) throw new DomainError("validation", "Only active products with an approved price for this customer can be offered in the portal.", { field: "productId" });
    const ins = await tx.insert(portalCatalogItems).values({ organizationId: ctx.organizationId, tenantId: t.id, productId, createdBy: ctx.userId, createdAt: now }).onConflictDoNothing().returning({ id: portalCatalogItems.id });
    if (ins.length) await audit(tx, ctx, { action: "sales.portal_catalog.item_added", entityType: "customer_portal_tenant", entityId: t.id, entityNumber: item.sku, siteId: t.siteId, after: { productId, sku: item.sku } });
  });
}

export async function removePortalCatalogItem(ctx: AuthContext, tenantId: string, productId: string): Promise<void> {
  ctx.require("sales.portal_catalog.admin");
  if (!isUuid(productId)) throw new DomainError("validation", "Choose a product.", { field: "productId" });
  await db.transaction(async (tx) => {
    const t = await lockTenant(tx, ctx, tenantId);
    ctx.requireAt("sales.portal_catalog.admin", t.siteId);
    const del = await tx.delete(portalCatalogItems).where(and(eq(portalCatalogItems.tenantId, t.id), eq(portalCatalogItems.productId, productId))).returning();
    if (del.length) {
      const [p] = await tx.select({ sku: products.skuCode }).from(products).where(eq(products.id, productId)).limit(1);
      await audit(tx, ctx, { action: "sales.portal_catalog.item_removed", entityType: "customer_portal_tenant", entityId: t.id, entityNumber: p?.sku ?? null, siteId: t.siteId, before: { productId } });
    }
  });
}

/* ------------------------------------------------------------------ portal users */

const InviteSchema = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.")),
    displayName: z.string().trim().min(2, "Enter the person's name.").max(120),
    portalRole: z.string().refine(isPortalRole, "Choose what the person may do."),
  })
  .strict();

async function issueInvitation(tx: Tx, ctx: AuthContext, u: { id: string; tenantId: string; email: string }, now: Date) {
  const ttl = await getSetting(tx, ctx.organizationId, "portal.invitation.ttl_hours");
  await revokeOpenPortalInvitations(tx, u.id, "replaced by a new invitation", now);
  const token = newToken();
  const [inv] = await tx.insert(portalInvitations).values({ organizationId: ctx.organizationId, tenantId: u.tenantId, portalUserId: u.id, email: u.email, tokenHash: sha256(token), expiresAt: new Date(now.getTime() + ttl * 3_600_000), createdBy: ctx.userId, createdAt: now }).returning();
  return { token, invitation: inv };
}

async function sendPortalInvitation(ctx: AuthContext, p: { to: string; displayName: string; customerName: string; token: string; expiresAt: Date }): Promise<PortalDelivery> {
  const link = portalInvitationLink(p.token);
  const r = await sendEmail({
    organizationId: ctx.organizationId,
    to: p.to,
    template: "portal.invitation",
    subject: "Your Bryel's Care customer portal access",
    text: [
      `Hello ${p.displayName},`,
      "",
      `Bryel's Care has opened customer portal access for ${p.customerName}. In the portal you can see your approved products and prices, place and follow orders and download your delivery receipts and quotations.`,
      "Open this link to choose your password. It works once and expires on " + p.expiresAt.toISOString().slice(0, 16).replace("T", " ") + " UTC:",
      "",
      link,
      "",
      "If you did not expect this, ignore this email.",
    ].join("\n"),
  });
  return { status: r.status, manualLink: r.status === "sent" ? null : link };
}

/** Invites a person of the customer to the portal (portal user `invited`, tenant bound, 72-hour link). */
export async function invitePortalUser(ctx: AuthContext, tenantId: string, raw: { email: string; displayName: string; portalRole: string }, now: Date = new Date()): Promise<{ portalUserId: string; delivery: PortalDelivery }> {
  ctx.require("sales.portal_user.admin");
  const parsed = InviteSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0] ?? "form")] ??= i.message;
    throw new DomainError("validation", Object.values(fieldErrors)[0] ?? "Check the form.", { fieldErrors });
  }
  const input = parsed.data;
  // Demo mode (ADR-055): made-up addresses only, so the demo never holds a real person and stays resettable.
  if (isDemoMode() && !isDemoEmail(input.email)) {
    throw new DomainError("validation", "This is the demo: invite only made-up addresses ending in @bryels-care.test (for example buyer.name@bryels-care.test).", { field: "email" });
  }
  await assertStepUp(ctx, "invite portal users", now);
  const out = await db.transaction(async (tx) => {
    const t = await lockTenant(tx, ctx, tenantId);
    ctx.requireAt("sales.portal_user.admin", t.siteId);
    if (t.status !== "active") throw new DomainError("state", "Portal access for this customer is paused. Resume it before inviting people.");
    const [staff] = await tx.select({ id: users.id }).from(users).where(and(eq(users.organizationId, ctx.organizationId), sql`lower(${users.email}) = ${input.email}`)).limit(1);
    if (staff) throw new DomainError("conflict", "This address belongs to a Bryel's Care staff account. Staff never use the customer portal; invite the customer's own address.", { field: "email" });
    const [dup] = await tx.select({ id: portalUsers.id }).from(portalUsers).where(and(eq(portalUsers.organizationId, ctx.organizationId), sql`lower(${portalUsers.email}) = ${input.email}`)).limit(1);
    if (dup) throw new DomainError("conflict", "A portal account with this email already exists.", { field: "email" });
    const [c] = await tx.select({ name: customers.name, code: customers.code }).from(customers).where(eq(customers.id, t.customerId)).limit(1);
    const [u] = await tx
      .insert(portalUsers)
      .values({ organizationId: ctx.organizationId, tenantId: t.id, email: input.email, displayName: input.displayName, portalRole: input.portalRole as PortalRole, status: "invited", createdBy: ctx.userId, createdAt: now, updatedAt: now })
      .returning();
    const { token, invitation } = await issueInvitation(tx, ctx, u, now);
    await audit(tx, ctx, { action: "sales.portal_user.invited", entityType: "portal_user", entityId: u.id, entityNumber: u.email, siteId: t.siteId, after: { tenantId: t.id, customer: c.code, portalRole: u.portalRole, invitationId: invitation.id, expiresAt: invitation.expiresAt } });
    return { u, token, invitation, customerName: c.name };
  });
  const delivery = await sendPortalInvitation(ctx, { to: out.u.email, displayName: out.u.displayName, customerName: out.customerName, token: out.token, expiresAt: out.invitation.expiresAt });
  return { portalUserId: out.u.id, delivery };
}

/** New invitation link for an invited portal user; the previous link stops working. */
export async function resendPortalInvitation(ctx: AuthContext, portalUserId: string, now: Date = new Date()): Promise<PortalDelivery> {
  ctx.require("sales.portal_user.admin");
  await assertStepUp(ctx, "send a portal invitation", now);
  const out = await db.transaction(async (tx) => {
    const { u, t } = await lockPortalUser(tx, ctx, portalUserId);
    ctx.requireAt("sales.portal_user.admin", t.siteId);
    if (u.status !== "invited") throw new DomainError("state", `This portal account is ${u.status}; only invited people get invitation links.`);
    if (t.status !== "active") throw new DomainError("state", "Portal access for this customer is paused.");
    const { token, invitation } = await issueInvitation(tx, ctx, u, now);
    await audit(tx, ctx, { action: "sales.portal_user.invited", entityType: "portal_user", entityId: u.id, entityNumber: u.email, siteId: t.siteId, after: { invitationId: invitation.id, expiresAt: invitation.expiresAt, resend: true } });
    const [c] = await tx.select({ name: customers.name }).from(customers).where(eq(customers.id, t.customerId)).limit(1);
    return { u, token, invitation, customerName: c.name };
  });
  return sendPortalInvitation(ctx, { to: out.u.email, displayName: out.u.displayName, customerName: out.customerName, token: out.token, expiresAt: out.invitation.expiresAt });
}

type UserCommand = "suspend" | "reactivate" | "unlock" | "reset_mfa";

/**
 * Staff lifecycle commands on a portal user (state machine in states.ts): suspend (reason; sessions
 * and open invitations end), reactivate, unlock (after lockout), reset two-step sign-in (reason).
 */
export async function changePortalUser(ctx: AuthContext, portalUserId: string, command: UserCommand, reason?: string | null, now: Date = new Date()): Promise<void> {
  ctx.require("sales.portal_user.admin");
  const why = command === "suspend" || command === "reset_mfa" ? requireReason(reason) : reason?.trim() || null;
  await assertStepUp(ctx, "change a portal account", now);
  await db.transaction(async (tx) => {
    const { u, t } = await lockPortalUser(tx, ctx, portalUserId);
    ctx.requireAt("sales.portal_user.admin", t.siteId);
    const base = { entityType: "portal_user", entityId: u.id, entityNumber: u.email, siteId: t.siteId, reason: why } as const;
    if (command === "reset_mfa") {
      if (!u.totpConfirmedAt && !u.totpSecretEnc) throw new DomainError("state", "Two-step sign-in is not set up for this account.");
      await tx.update(portalUsers).set({ totpConfirmedAt: null, totpSecretEnc: null, totpKeyId: null, totpLastStep: null, updatedAt: now }).where(eq(portalUsers.id, u.id));
      const revoked = await revokePortalUserSessions(tx, u.id, "two-step sign-in reset by Bryel's Care", { now });
      await audit(tx, ctx, { action: "sales.portal_user.mfa_reset", ...base, after: { sessionsRevoked: revoked } });
      return;
    }
    let to: PortalUserStatus;
    if (command === "suspend") to = "suspended";
    else if (command === "unlock") {
      if (u.status !== "locked") throw new DomainError("state", "This portal account is not locked.");
      to = "active";
    } else {
      if (u.status !== "suspended") throw new DomainError("state", "Only a suspended portal account can be reactivated.");
      to = u.passwordHash.startsWith("$argon2") ? "active" : "invited";
    }
    assertPortalUserTransition(u.status, to);
    await tx.update(portalUsers).set({ status: to, statusReason: to === "suspended" ? why : null, failedLoginCount: 0, updatedAt: now }).where(eq(portalUsers.id, u.id));
    let revoked = 0;
    if (to === "suspended") {
      revoked = await revokePortalUserSessions(tx, u.id, `suspended: ${why}`, { now });
      await revokeOpenPortalInvitations(tx, u.id, `suspended: ${why}`, now);
    }
    const action = command === "suspend" ? "sales.portal_user.suspended" : command === "unlock" ? "sales.portal_user.unlocked" : "sales.portal_user.reactivated";
    await audit(tx, ctx, { action, ...base, before: { status: u.status }, after: { status: to, sessionsRevoked: revoked } });
  });
}

/** Portal users of a tenant awaiting acceptance with an expired link (for the panel hint). */
export async function expiredPortalInvitations(ctx: AuthContext, tenantId: string, now: Date = new Date()) {
  ctx.require("sales.portal_user.view");
  return db
    .select({ id: portalUsers.id })
    .from(portalUsers)
    .innerJoin(portalInvitations, eq(portalInvitations.portalUserId, portalUsers.id))
    .where(and(eq(portalUsers.tenantId, tenantId), eq(portalUsers.status, "invited"), isNull(portalInvitations.acceptedAt), isNull(portalInvitations.revokedAt), sql`${portalInvitations.expiresAt} <= ${now.toISOString()}::timestamptz`))
    .orderBy(desc(portalInvitations.expiresAt));
}

/** Live portal session count of a tenant (staff panel; never lists customer devices). */
export async function livePortalSessionCount(tenantId: string, now: Date = new Date()) {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(portalSessions)
    .where(and(eq(portalSessions.tenantId, tenantId), isNull(portalSessions.revokedAt), sql`${portalSessions.expiresAt} > ${now.toISOString()}::timestamptz`));
  return Number(r?.n ?? 0);
}
