import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "@/db/client";
import { organizations, rolePermissions, roles, sites, userSiteAssignments, users, warehouses } from "@/db/schema";
import { audit } from "@/lib/audit";
import { parseScope } from "@/lib/auth/assignments";
import type { AuthContext } from "@/lib/auth/context";
import { restrictedAmong } from "@/lib/auth/sensitivity";
import { DomainError } from "@/lib/errors";
import { getSetting } from "@/lib/settings";
import type { Permission } from "@/lib/permissions";
import { SYSTEM_USER_STATUS } from "@/lib/auth/system";
import { assertStepUp, deny, isOwnerBreakGlass, orgMidnight, requireReason } from "./policy";

/**
 * Site assignments (US-1-18) and warehouse sub-scopes (US-2-29). Rules, all enforced here:
 * 1. `identity.site_assignment.admin` held AT the target site (a site-scoped holder cannot reach
 *    other sites: 404), or through an organization-wide assignment for organization-wide grants.
 * 2. Nobody changes their own assignments (identity.no_self_grant).
 * 3. Organization-wide only for roles that allow it (owner_director, system_admin, auditor).
 * 4. A role carrying restricted (R) permissions the actor does not hold can be granted only by
 *    owner_director ("grant requires owner approval", matrix §2): an admin cannot hand out what
 *    they do not have.
 * 5. Restricted action: step-up (re-authentication, TOTP when enrolled).
 * Changes take effect on the user's next request (contexts are rebuilt per request).
 */

const GrantSchema = z
  .object({
    userId: z.uuid(),
    roleId: z.uuid(),
    siteId: z.uuid().nullable(),
    validFrom: z.iso.date().optional().nullable(),
    validTo: z.iso.date().optional().nullable(),
    warehouseIds: z.array(z.uuid()).max(50).optional().nullable(),
    reason: z.string().trim().max(300).optional().nullable(),
  })
  .strict();
export type GrantInput = z.input<typeof GrantSchema>;

type RoleRow = typeof roles.$inferSelect;

async function loadRole(tx: Tx, ctx: AuthContext, roleId: string): Promise<{ role: RoleRow; permissions: string[] }> {
  const [role] = await tx.select().from(roles).where(and(eq(roles.id, roleId), eq(roles.organizationId, ctx.organizationId))).limit(1);
  if (!role) throw new DomainError("not_found", "Role not found.");
  const perms = await tx.select({ code: rolePermissions.permissionCode }).from(rolePermissions).where(eq(rolePermissions.roleId, role.id));
  return { role, permissions: perms.map((p) => p.code) };
}

/** Rules 1-4 for granting `role` at `siteId` (null = organization-wide) to `userId`. */
export async function assertMayGrant(ctx: AuthContext, target: { userId: string; role: RoleRow; permissions: string[]; siteId: string | null }) {
  ctx.require("identity.site_assignment.admin");
  if (target.userId === ctx.userId) {
    await deny(ctx, "identity.site_assignment.admin", { entityType: "user_site_assignments", entityId: target.userId, reason: "You cannot change your own role assignments. Ask another administrator." });
  }
  if (target.siteId === null) {
    if (!target.role.allowsOrganizationWide) throw new DomainError("validation", `${target.role.name} can only be granted at a site, not organization-wide.`, { field: "siteId" });
    if (!ctx.canOrgWide("identity.site_assignment.admin")) {
      await deny(ctx, "identity.site_assignment.admin", { entityType: "user_site_assignments", reason: "Only an organization-wide administrator can grant organization-wide access." });
    }
  } else {
    ctx.requireSite(target.siteId);
    if (!ctx.canAt("identity.site_assignment.admin", target.siteId)) {
      await deny(ctx, "identity.site_assignment.admin", { entityType: "user_site_assignments", siteId: target.siteId, reason: "You cannot grant roles at this site." });
    }
  }
  if (target.role.status !== "active") throw new DomainError("state", "This role is inactive and cannot be granted.");
  const held = (p: string) => (target.siteId ? ctx.canAt(p as Permission, target.siteId) : ctx.canOrgWide(p as Permission));
  const lacking = restrictedAmong(target.permissions).filter((p) => !held(p));
  if (lacking.length > 0 && !ctx.roleCodes.includes("owner_director") && (await getSetting(db, ctx.organizationId, "identity.assignment.restricted_grant_requires_owner"))) {
    await deny(ctx, "identity.site_assignment.admin", {
      entityType: "user_site_assignments",
      entityId: target.userId,
      siteId: target.siteId,
      reason: `${target.role.name} carries restricted permissions you do not hold (${lacking.join(", ")}). The owner must grant it.`,
    });
  }
}

async function validateWarehouses(tx: Tx, siteId: string | null, warehouseIds: string[] | null | undefined): Promise<{ warehouseIds: string[] } | null> {
  if (!warehouseIds || warehouseIds.length === 0) return null;
  if (!siteId) throw new DomainError("validation", "A warehouse limit needs a site assignment, not an organization-wide one.", { field: "warehouseIds" });
  const found = await tx.select({ id: warehouses.id }).from(warehouses).where(and(eq(warehouses.siteId, siteId), inArray(warehouses.id, warehouseIds)));
  if (found.length !== new Set(warehouseIds).size) throw new DomainError("validation", "Every warehouse must belong to the assignment's site.", { field: "warehouseIds" });
  return { warehouseIds: [...new Set(warehouseIds)].sort() };
}

async function orgTimeZone(tx: Tx, organizationId: string) {
  const [o] = await tx.select({ tz: organizations.timezone }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  return o?.tz ?? "Asia/Manila";
}

/** Inside a caller's transaction (also used by the invitation flow). Returns the assignment id. */
export async function grantInTx(tx: Tx, ctx: AuthContext, raw: GrantInput, now: Date = new Date()): Promise<string> {
  const input = GrantSchema.parse(raw);
  const { role, permissions } = await loadRole(tx, ctx, input.roleId);
  await assertMayGrant(ctx, { userId: input.userId, role, permissions, siteId: input.siteId });
  const [u] = await tx
    .select({ id: users.id, email: users.email, status: users.status })
    .from(users)
    .where(and(eq(users.id, input.userId), eq(users.organizationId, ctx.organizationId)))
    .for("update")
    .limit(1);
  if (!u || u.status === SYSTEM_USER_STATUS) throw new DomainError("not_found", "User not found.");
  if (u.status === "deactivated") throw new DomainError("state", "This account is deactivated. Reactivate it before granting roles.");
  if (input.siteId) {
    const [site] = await tx.select({ id: sites.id, active: sites.isActive }).from(sites).where(and(eq(sites.id, input.siteId), eq(sites.organizationId, ctx.organizationId))).limit(1);
    if (!site || !site.active) throw new DomainError("not_found", "Site not found.");
  }
  const scope = await validateWarehouses(tx, input.siteId, input.warehouseIds);
  const tz = await orgTimeZone(tx, ctx.organizationId);
  const validFrom = input.validFrom ? orgMidnight(input.validFrom, tz) : now;
  const validTo = input.validTo ? orgMidnight(input.validTo, tz) : null;
  if (validTo && validTo.getTime() <= validFrom.getTime()) throw new DomainError("validation", "The end date must be after the start date.", { field: "validTo" });

  // Rows past their end date but not yet swept are closed now so the live unique index stays free.
  const live = await tx
    .select()
    .from(userSiteAssignments)
    .where(
      and(
        eq(userSiteAssignments.userId, u.id),
        eq(userSiteAssignments.roleId, role.id),
        input.siteId ? eq(userSiteAssignments.siteId, input.siteId) : isNull(userSiteAssignments.siteId),
        isNull(userSiteAssignments.revokedAt),
      ),
    );
  for (const r of live) {
    if (r.validTo && r.validTo.getTime() <= now.getTime()) {
      await tx.update(userSiteAssignments).set({ revokedAt: now, revokedBy: ctx.userId, revokedReason: "ended (validity passed)" }).where(eq(userSiteAssignments.id, r.id));
    } else {
      throw new DomainError("conflict", `${u.email} already holds ${role.name} ${input.siteId ? "at this site" : "organization-wide"}.`);
    }
  }
  const [row] = await tx
    .insert(userSiteAssignments)
    .values({ userId: u.id, roleId: role.id, siteId: input.siteId, isOrganizationWide: input.siteId === null, validFrom, validTo, scope, createdBy: ctx.userId })
    .returning();
  await audit(tx, ctx, {
    action: "identity.site_assignment.granted",
    entityType: "user_site_assignments",
    entityId: row.id,
    entityNumber: u.email,
    siteId: input.siteId,
    reason: input.reason ?? null,
    after: { userId: u.id, role: role.code, siteId: input.siteId, organizationWide: input.siteId === null, validFrom, validTo, scope, restricted: restrictedAmong(permissions) },
  });
  if (isOwnerBreakGlass(ctx)) await audit(tx, ctx, { action: "identity.role.owner_break_glass", entityType: "user_site_assignments", entityId: row.id, siteId: input.siteId, after: { use: "grant", role: role.code } });
  return row.id;
}

/** Grants a role at a site (or organization-wide) with optional validity dates and warehouse limit. */
export async function grantAssignment(ctx: AuthContext, input: GrantInput, now: Date = new Date()): Promise<string> {
  ctx.require("identity.site_assignment.admin");
  await assertStepUp(ctx, "change role assignments", now);
  return db.transaction((tx) => grantInTx(tx, ctx, input, now));
}

async function loadAssignmentForChange(tx: Tx, ctx: AuthContext, assignmentId: string) {
  const [a] = await tx
    .select({ a: userSiteAssignments, role: roles, email: users.email })
    .from(userSiteAssignments)
    .innerJoin(roles, eq(roles.id, userSiteAssignments.roleId))
    .innerJoin(users, eq(users.id, userSiteAssignments.userId))
    .where(and(eq(userSiteAssignments.id, assignmentId), eq(users.organizationId, ctx.organizationId)))
    .for("update", { of: userSiteAssignments })
    .limit(1);
  if (!a) throw new DomainError("not_found", "Assignment not found.");
  // Same authority as granting it (site scope, no self-change, restricted roles only by those who may grant them).
  const perms = await tx.select({ code: rolePermissions.permissionCode }).from(rolePermissions).where(eq(rolePermissions.roleId, a.role.id));
  await assertMayGrant(ctx, { userId: a.a.userId, role: { ...a.role, status: "active" }, permissions: perms.map((p) => p.code), siteId: a.a.siteId });
  if (a.a.revokedAt) throw new DomainError("state", "This assignment has already ended.");
  return a;
}

/** Ends an assignment now (valid_to = now, revoked_*); the row is kept for the audit trail. */
export async function endAssignment(ctx: AuthContext, assignmentId: string, reason: string, now: Date = new Date()): Promise<void> {
  ctx.require("identity.site_assignment.admin");
  const why = requireReason(reason);
  await assertStepUp(ctx, "change role assignments", now);
  await db.transaction(async (tx) => {
    const { a, role, email } = await loadAssignmentForChange(tx, ctx, assignmentId);
    const validTo = a.validFrom.getTime() > now.getTime() ? a.validFrom : now;
    await tx.update(userSiteAssignments).set({ validTo, revokedAt: now, revokedBy: ctx.userId, revokedReason: why }).where(eq(userSiteAssignments.id, a.id));
    await audit(tx, ctx, {
      action: "identity.site_assignment.revoked",
      entityType: "user_site_assignments",
      entityId: a.id,
      entityNumber: email,
      siteId: a.siteId,
      reason: why,
      before: { role: role.code, siteId: a.siteId, validFrom: a.validFrom, validTo: a.validTo },
      after: { validTo, revokedAt: now },
    });
    if (isOwnerBreakGlass(ctx)) await audit(tx, ctx, { action: "identity.role.owner_break_glass", entityType: "user_site_assignments", entityId: a.id, siteId: a.siteId, after: { use: "revoke", role: role.code } });
  });
}

/** Sets or clears the warehouse write sub-scope of a site assignment (US-2-29). */
export async function changeAssignmentScope(ctx: AuthContext, assignmentId: string, warehouseIds: string[] | null, reason: string, now: Date = new Date()): Promise<void> {
  ctx.require("identity.site_assignment.admin");
  const why = requireReason(reason);
  const ids = z.array(z.uuid()).max(50).nullable().parse(warehouseIds);
  await assertStepUp(ctx, "change role assignments", now);
  await db.transaction(async (tx) => {
    const { a, role, email } = await loadAssignmentForChange(tx, ctx, assignmentId);
    const scope = await validateWarehouses(tx, a.siteId, ids);
    const before = parseScope(a.scope);
    await tx.update(userSiteAssignments).set({ scope }).where(eq(userSiteAssignments.id, a.id));
    await audit(tx, ctx, {
      action: "identity.site_assignment.scope_changed",
      entityType: "user_site_assignments",
      entityId: a.id,
      entityNumber: email,
      siteId: a.siteId,
      reason: why,
      before: { role: role.code, scope: before },
      after: { role: role.code, scope },
    });
  });
}


/** Warehouses of the caller's sites, for the sub-scope pickers (organization structure is readable by name). */
export async function warehousesForSites(ctx: AuthContext): Promise<{ id: string; siteId: string; code: string; name: string }[]> {
  if (ctx.allowedSiteIds.length === 0) return [];
  return db
    .select({ id: warehouses.id, siteId: warehouses.siteId, code: warehouses.code, name: warehouses.name })
    .from(warehouses)
    .where(inArray(warehouses.siteId, ctx.allowedSiteIds))
    .orderBy(warehouses.code);
}

/** Roles the caller may grant at a site (or organization-wide when siteId is null), for the grant form. */
export async function grantableRoles(ctx: AuthContext, siteId: string | null): Promise<{ id: string; code: string; name: string; allowsOrganizationWide: boolean; blockedReason: string | null }[]> {
  ctx.require("identity.site_assignment.view");
  const rows = await db.select().from(roles).where(and(eq(roles.organizationId, ctx.organizationId), eq(roles.status, "active")));
  const perms = rows.length
    ? await db.select({ roleId: rolePermissions.roleId, code: rolePermissions.permissionCode }).from(rolePermissions).where(inArray(rolePermissions.roleId, rows.map((r) => r.id)))
    : [];
  const held = (p: string) => (siteId ? ctx.canAt(p as Permission, siteId) : ctx.canOrgWide(p as Permission));
  const ownerOnly = await getSetting(db, ctx.organizationId, "identity.assignment.restricted_grant_requires_owner");
  return rows
    .map((r) => {
      const lacking = restrictedAmong(perms.filter((p) => p.roleId === r.id).map((p) => p.code)).filter((p) => !held(p));
      const blockedReason =
        siteId === null && !r.allowsOrganizationWide
          ? "Site only"
          : ownerOnly && lacking.length && !ctx.roleCodes.includes("owner_director")
            ? `Needs the owner (restricted: ${lacking.join(", ")})`
            : null;
      return { id: r.id, code: r.code, name: r.name, allowsOrganizationWide: r.allowsOrganizationWide, blockedReason };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
