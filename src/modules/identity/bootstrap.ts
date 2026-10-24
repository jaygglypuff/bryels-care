import "server-only";
import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "@/db/client";
import { auditEvents, organizations, rolePermissions, roles, sites, userSiteAssignments, users } from "@/db/schema";
import { SYSTEM_ACTOR_EMAIL, SYSTEM_USER_STATUS } from "@/lib/auth/system";
import { DomainError } from "@/lib/errors";
import { ROLE_BUNDLES } from "@/lib/permissions";
import { issueInvitation } from "./lifecycle";
import { invitationLink } from "./messages";

/**
 * First-administrator bootstrap for a fresh production database (no demo seed): `pnpm admin:bootstrap`.
 * Safe by construction:
 * - refuses when any person is active or locked (the system is already administered);
 * - never sets a password: it creates an `invited` user with organization-wide assignments and prints a
 *   one-time invitation link (72 h, single use); the person sets their own password on that page;
 * - re-running before the link is used replaces the link (the old one stops working);
 * - seeded roles are synchronised from ROLE_BUNDLES (read-only templates, code is their source).
 * Audit: identity.user.created, identity.site_assignment.granted, identity.invitation.sent with
 * actor_label `system:identity.bootstrap`.
 */
export const BOOTSTRAP_ACTOR = "system:identity.bootstrap";
export const BOOTSTRAP_ROLES = ["owner_director", "system_admin"] as const;

const Input = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("BOOTSTRAP_ADMIN_EMAIL must be an email address.")),
  displayName: z.string().trim().min(2).max(120),
  roleCodes: z.array(z.enum(BOOTSTRAP_ROLES)).min(1),
  organizationName: z.string().trim().min(2).max(200).optional().nullable(),
  siteCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,10}$/, "BOOTSTRAP_SITE_CODE must be 2-10 letters or digits.")
    .optional()
    .nullable(),
  siteName: z.string().trim().min(2).max(120).optional().nullable(),
});
export type BootstrapInput = z.input<typeof Input>;

export type BootstrapResult = { organizationId: string; userId: string; link: string; expiresAt: Date; createdOrganization: boolean; createdSite: boolean; roleSync: RoleSyncResult };

export type RoleSyncResult = { created: string[]; added: number; removed: number };

/** Seeded roles follow ROLE_BUNDLES exactly (templates are read-only in the app; code changes them). */
export async function syncSystemRoles(tx: Tx, organizationId: string): Promise<RoleSyncResult> {
  const out: RoleSyncResult = { created: [], added: 0, removed: 0 };
  for (const [code, b] of Object.entries(ROLE_BUNDLES)) {
    let [r] = await tx.select().from(roles).where(and(eq(roles.organizationId, organizationId), eq(roles.code, code))).limit(1);
    if (!r) {
      [r] = await tx.insert(roles).values({ organizationId, code, name: b.name, allowsOrganizationWide: b.orgWide, isSystem: true }).returning();
      out.created.push(code);
    }
    if (!r.isSystem) continue; // a custom role that happens to use a seeded code is never touched
    const have = new Set((await tx.select({ code: rolePermissions.permissionCode }).from(rolePermissions).where(eq(rolePermissions.roleId, r.id))).map((x) => x.code));
    const want = new Set<string>(b.permissions);
    const add = [...want].filter((p) => !have.has(p));
    if (add.length) await tx.insert(rolePermissions).values(add.map((p) => ({ roleId: r.id, permissionCode: p })));
    const remove = [...have].filter((p) => !want.has(p));
    if (remove.length) await tx.delete(rolePermissions).where(and(eq(rolePermissions.roleId, r.id), inArray(rolePermissions.permissionCode, remove)));
    out.added += add.length;
    out.removed += remove.length;
  }
  return out;
}

export async function bootstrapFirstAdmin(raw: BootstrapInput, now: Date = new Date()): Promise<BootstrapResult> {
  const input = Input.parse(raw);
  const result = await db.transaction(async (tx) => {
    // One bootstrap at a time.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('identity.bootstrap'))`);
    const orgs = await tx.select().from(organizations);
    if (orgs.length > 1) throw new DomainError("conflict", "More than one organization exists; bootstrap supports a single organization (ADR-011).");
    let org = orgs[0];
    let createdOrganization = false;
    if (!org) {
      if (!input.organizationName) throw new DomainError("validation", "The database is empty: set BOOTSTRAP_ORG_NAME to create the organization.");
      [org] = await tx.insert(organizations).values({ name: input.organizationName }).returning();
      createdOrganization = true;
    }
    const people = await tx
      .select({ id: users.id, email: users.email, status: users.status })
      .from(users)
      .where(and(eq(users.organizationId, org.id), inArray(users.status, ["active", "locked"])));
    if (people.length > 0) {
      throw new DomainError("conflict", `Refusing to bootstrap: ${people.length} account(s) are already active or locked. Use the Users page to invite more administrators.`);
    }
    const roleSync = await syncSystemRoles(tx, org.id);

    let createdSite = false;
    const activeSites = await tx.select({ id: sites.id }).from(sites).where(and(eq(sites.organizationId, org.id), eq(sites.isActive, true)));
    if (activeSites.length === 0) {
      if (!input.siteCode || !input.siteName) throw new DomainError("validation", "No active site exists: set BOOTSTRAP_SITE_CODE and BOOTSTRAP_SITE_NAME to create the first site.");
      await tx.insert(sites).values({ organizationId: org.id, code: input.siteCode, name: input.siteName });
      createdSite = true;
    }
    // The system actor (ADR-029) exists from day one so scheduled jobs can attribute their work.
    await tx
      .insert(users)
      .values({ organizationId: org.id, email: SYSTEM_ACTOR_EMAIL, displayName: "System (scheduled jobs)", passwordHash: "!", status: SYSTEM_USER_STATUS })
      .onConflictDoNothing();

    let [u] = await tx.select().from(users).where(and(eq(users.organizationId, org.id), sql`lower(${users.email}) = ${input.email}`)).for("update").limit(1);
    const audits: (typeof auditEvents.$inferInsert)[] = [];
    const ev = (e: Omit<typeof auditEvents.$inferInsert, "organizationId" | "actorLabel">) => audits.push({ organizationId: org.id, actorLabel: BOOTSTRAP_ACTOR, ...e });
    if (u && u.status !== "invited" && u.status !== "deactivated") throw new DomainError("conflict", `The account ${input.email} exists with status ${u.status}.`);
    if (!u) {
      [u] = await tx.insert(users).values({ organizationId: org.id, email: input.email, displayName: input.displayName, passwordHash: "!", status: "invited", createdAt: now, updatedAt: now }).returning();
      ev({ action: "identity.user.created", entityType: "user", entityId: u.id, entityNumber: u.email, after: { status: "invited", via: "bootstrap" } });
    } else if (u.status === "deactivated") {
      await tx.update(users).set({ status: "invited", deactivatedAt: null, displayName: input.displayName, updatedAt: now }).where(eq(users.id, u.id));
      ev({ action: "identity.user.updated", entityType: "user", entityId: u.id, entityNumber: u.email, before: { status: "deactivated" }, after: { status: "invited", via: "bootstrap" } });
    }
    const roleRows = await tx.select().from(roles).where(and(eq(roles.organizationId, org.id), inArray(roles.code, input.roleCodes)));
    for (const r of roleRows) {
      const [has] = await tx
        .select({ id: userSiteAssignments.id })
        .from(userSiteAssignments)
        .where(and(eq(userSiteAssignments.userId, u.id), eq(userSiteAssignments.roleId, r.id), isNull(userSiteAssignments.siteId), isNull(userSiteAssignments.revokedAt)))
        .limit(1);
      if (has) continue;
      const [a] = await tx.insert(userSiteAssignments).values({ userId: u.id, roleId: r.id, isOrganizationWide: true, validFrom: now }).returning();
      ev({ action: "identity.site_assignment.granted", entityType: "user_site_assignments", entityId: a.id, entityNumber: u.email, after: { role: r.code, organizationWide: true, via: "bootstrap" } });
    }
    // Ends any assignment of other roles that an earlier, abandoned bootstrap left behind.
    await tx
      .update(userSiteAssignments)
      .set({ revokedAt: now, validTo: now, revokedReason: "bootstrap re-run with different roles" })
      .where(and(eq(userSiteAssignments.userId, u.id), isNull(userSiteAssignments.revokedAt), roleRows.length ? notInArray(userSiteAssignments.roleId, roleRows.map((r) => r.id)) : sql`true`));
    const { token, invitation } = await issueInvitation(tx, null, { organizationId: org.id, userId: u.id, email: u.email, roleId: roleRows[0]?.id ?? null, siteId: null, kind: "bootstrap", now });
    ev({ action: "identity.invitation.sent", entityType: "user", entityId: u.id, entityNumber: u.email, after: { invitationId: invitation.id, expiresAt: invitation.expiresAt, kind: "bootstrap", roleSync } });
    if (audits.length) await tx.insert(auditEvents).values(audits);
    return { organizationId: org.id, userId: u.id, link: invitationLink(token), expiresAt: invitation.expiresAt, createdOrganization, createdSite, roleSync };
  });
  return result;
}

/** Role sync only (after a release changes ROLE_BUNDLES): `pnpm admin:bootstrap --sync-roles`. */
export async function syncAllSystemRoles(): Promise<RoleSyncResult[]> {
  const orgs = await db.select({ id: organizations.id }).from(organizations);
  const out: RoleSyncResult[] = [];
  for (const o of orgs) out.push(await db.transaction((tx) => syncSystemRoles(tx, o.id)));
  return out;
}
