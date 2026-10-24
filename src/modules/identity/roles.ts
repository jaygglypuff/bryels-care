import "server-only";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { rolePermissions, roles, userSiteAssignments } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { ACCESS_ADMIN_PERMISSIONS, ADMIN_INCOMPATIBLE, type Sensitivity, restrictedAmong, sensitivityOf } from "@/lib/auth/sensitivity";
import { DomainError } from "@/lib/errors";
import { PERMISSIONS, type Permission } from "@/lib/permissions";
import { assertStepUp, deny, isOwnerBreakGlass, requireReason } from "./policy";

/**
 * Roles and the permission catalogue (US-1-17) and custom roles by cloning (US-1-29).
 * - Seeded roles (`is_system`) are read-only templates: any change is refused and audited
 *   (identity.seeded_role_read_only).
 * - A custom role starts as a clone of a seeded role; it may hold only catalogue strings the creator
 *   holds (custom roles cannot exceed the creator's grants), never an admin-incompatible mix
 *   (access administration + quality release / money / payroll / approval rules, security §2.11).
 * - Every change needs identity.role.admin and step-up; the audit diff carries each string's sensitivity.
 */
const CATALOGUE = new Set<string>(PERMISSIONS);

export type CatalogueEntry = { code: Permission; module: string; entity: string; action: string; sensitivity: Sensitivity };

export function permissionCatalogue(): CatalogueEntry[] {
  return PERMISSIONS.map((code) => {
    const [module, entity, action] = code.split(".");
    return { code, module, entity, action, sensitivity: sensitivityOf(code) };
  }).sort((a, b) => a.code.localeCompare(b.code));
}

/** Matrix view data: every role (columns) × every catalogue string (rows). */
export async function roleMatrix(ctx: AuthContext): Promise<{ roles: { id: string; code: string; name: string; isSystem: boolean; status: string }[]; grants: Record<string, string[]>; catalogue: CatalogueEntry[] }> {
  ctx.require("identity.role.view");
  const rs = await db
    .select({ id: roles.id, code: roles.code, name: roles.name, isSystem: roles.isSystem, status: roles.status })
    .from(roles)
    .where(eq(roles.organizationId, ctx.organizationId))
    .orderBy(sql`${roles.isSystem} desc`, asc(roles.name));
  const rp = rs.length ? await db.select().from(rolePermissions).where(inArray(rolePermissions.roleId, rs.map((r) => r.id))) : [];
  const grants: Record<string, string[]> = {};
  for (const r of rp) (grants[r.roleId] ??= []).push(r.permissionCode);
  return { roles: rs, grants, catalogue: permissionCatalogue() };
}

export type RoleDetail = {
  role: typeof roles.$inferSelect & { clonedFromName: string | null };
  permissions: { code: string; sensitivity: Sensitivity; known: boolean }[];
  activeAssignments: number;
  everAssigned: number;
  /** Record types the role can both submit and approve (separation-of-duties warning, US-1-17 AC3). */
  sodWarnings: string[];
};

export async function getRole(ctx: AuthContext, roleId: string): Promise<RoleDetail> {
  ctx.require("identity.role.view");
  z.uuid().parse(roleId);
  const [role] = await db.select().from(roles).where(and(eq(roles.id, roleId), eq(roles.organizationId, ctx.organizationId))).limit(1);
  if (!role) throw new DomainError("not_found", "Role not found.");
  const [src] = role.clonedFromRoleId ? await db.select({ name: roles.name }).from(roles).where(eq(roles.id, role.clonedFromRoleId)).limit(1) : [];
  const perms = (await db.select({ code: rolePermissions.permissionCode }).from(rolePermissions).where(eq(rolePermissions.roleId, role.id))).map((p) => p.code).sort();
  const [counts] = await db
    .select({
      active: sql<number>`count(*) filter (where ${userSiteAssignments.revokedAt} is null and ${userSiteAssignments.validFrom} <= now() and (${userSiteAssignments.validTo} is null or ${userSiteAssignments.validTo} > now()))::int`,
      ever: sql<number>`count(*)::int`,
    })
    .from(userSiteAssignments)
    .where(eq(userSiteAssignments.roleId, role.id));
  return {
    role: { ...role, clonedFromName: src?.name ?? null },
    permissions: perms.map((code) => ({ code, sensitivity: sensitivityOf(code), known: CATALOGUE.has(code) })),
    activeAssignments: Number(counts?.active ?? 0),
    everAssigned: Number(counts?.ever ?? 0),
    sodWarnings: sodWarnings(perms),
  };
}

export function sodWarnings(perms: string[]): string[] {
  const set = new Set(perms);
  const out: string[] = [];
  for (const p of perms) {
    if (!p.endsWith(".approve")) continue;
    const base = p.slice(0, -".approve".length);
    if (set.has(`${base}.submit`)) out.push(base);
  }
  return out.sort();
}

const CodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9_]{2,40}$/, "Use 3-41 lowercase letters, digits or underscores, starting with a letter.");

const CloneSchema = z
  .object({
    sourceRoleId: z.uuid(),
    code: CodeSchema,
    name: z.string().trim().min(3, "Give the role a name.").max(80),
    description: z.string().trim().max(500).optional().nullable(),
    permissions: z.array(z.string()).max(PERMISSIONS.length),
  })
  .strict();
export type CloneInput = z.input<typeof CloneSchema>;

/** Rules every custom role's permission set must satisfy (creator's grants, catalogue, admin mix). */
async function assertCustomSet(ctx: AuthContext, perms: string[], added: string[], entityId: string | null) {
  const unknown = perms.filter((p) => !CATALOGUE.has(p));
  if (unknown.length) throw new DomainError("validation", `Not in the permission catalogue: ${unknown.join(", ")}.`, { field: "permissions" });
  const lacking = added.filter((p) => !ctx.can(p as Permission));
  if (lacking.length) {
    await deny(ctx, "identity.role.admin", { entityType: "role", entityId, reason: `A custom role cannot hold permissions you do not hold yourself: ${lacking.join(", ")}.` });
  }
  if (ACCESS_ADMIN_PERMISSIONS.some((p) => perms.includes(p))) {
    const bad = perms.filter(ADMIN_INCOMPATIBLE);
    if (bad.length) {
      await deny(ctx, "identity.role.admin", {
        entityType: "role",
        entityId,
        reason: `A role that administers access cannot also hold ${bad.join(", ")} (quality release, money, payroll and approval rules stay separate).`,
      });
    }
  }
}

/** US-1-29: a custom role cloned from a role of the organization (seeded or custom). */
export async function cloneRole(ctx: AuthContext, raw: CloneInput, now: Date = new Date()): Promise<string> {
  ctx.require("identity.role.admin");
  const input = CloneSchema.parse(raw);
  await assertStepUp(ctx, "create a role", now);
  const perms = [...new Set(input.permissions)].sort();
  const [src] = await db.select().from(roles).where(and(eq(roles.id, input.sourceRoleId), eq(roles.organizationId, ctx.organizationId))).limit(1);
  if (!src) throw new DomainError("not_found", "Role not found.");
  const srcPerms = (await db.select({ code: rolePermissions.permissionCode }).from(rolePermissions).where(eq(rolePermissions.roleId, src.id))).map((r) => r.code);
  // Every string of the new role counts as "added" for the creator rule: the creator must hold it.
  await assertCustomSet(ctx, perms, perms, null);
  return db.transaction(async (tx) => {
    const [dup] = await tx.select({ id: roles.id }).from(roles).where(and(eq(roles.organizationId, ctx.organizationId), eq(roles.code, input.code))).limit(1);
    if (dup) throw new DomainError("conflict", "A role with this code already exists.", { field: "code" });
    const [r] = await tx
      .insert(roles)
      .values({
        organizationId: ctx.organizationId,
        code: input.code,
        name: input.name,
        description: input.description ?? null,
        isSystem: false,
        allowsOrganizationWide: src.allowsOrganizationWide,
        clonedFromRoleId: src.id,
        createdBy: ctx.userId,
        updatedAt: now,
      })
      .returning();
    if (perms.length) await tx.insert(rolePermissions).values(perms.map((p) => ({ roleId: r.id, permissionCode: p })));
    const removed = srcPerms.filter((p) => !perms.includes(p)).sort();
    const added = perms.filter((p) => !srcPerms.includes(p));
    await audit(tx, ctx, {
      action: "identity.role.created",
      entityType: "role",
      entityId: r.id,
      entityNumber: r.code,
      siteId: null,
      after: {
        clonedFrom: src.code,
        permissions: perms.length,
        added: added.map((code) => ({ code, sensitivity: sensitivityOf(code) })),
        removed,
        restricted: restrictedAmong(perms),
      },
    });
    if (isOwnerBreakGlass(ctx)) await audit(tx, ctx, { action: "identity.role.owner_break_glass", entityType: "role", entityId: r.id, siteId: null, after: { use: "clone" } });
    return r.id;
  });
}

const UpdateSchema = z
  .object({
    name: z.string().trim().min(3).max(80),
    description: z.string().trim().max(500).optional().nullable(),
    permissions: z.array(z.string()).max(PERMISSIONS.length),
    reason: z.string().trim().min(5, "Give a short reason (at least 5 characters).").max(300),
  })
  .strict();
export type UpdateRoleInput = z.input<typeof UpdateSchema>;

async function loadCustom(ctx: AuthContext, roleId: string, attempted: string) {
  z.uuid().parse(roleId);
  const [role] = await db.select().from(roles).where(and(eq(roles.id, roleId), eq(roles.organizationId, ctx.organizationId))).limit(1);
  if (!role) throw new DomainError("not_found", "Role not found.");
  if (role.isSystem) {
    await deny(ctx, "identity.role.admin", {
      entityType: "role",
      entityId: role.id,
      reason: `${role.name} is a seeded template and is read-only. Clone it into a custom role to ${attempted}.`,
    });
  }
  return role;
}

/** Edits a custom role's name, description and permissions (diff audited with sensitivity). */
export async function updateCustomRole(ctx: AuthContext, roleId: string, raw: UpdateRoleInput, now: Date = new Date()): Promise<void> {
  ctx.require("identity.role.admin");
  const role = await loadCustom(ctx, roleId, "change it");
  const input = UpdateSchema.parse(raw);
  await assertStepUp(ctx, "change a role", now);
  const next = [...new Set(input.permissions)].sort();
  const current = (await db.select({ code: rolePermissions.permissionCode }).from(rolePermissions).where(eq(rolePermissions.roleId, role.id))).map((r) => r.code);
  const added = next.filter((p) => !current.includes(p));
  const removed = current.filter((p) => !next.includes(p)).sort();
  await assertCustomSet(ctx, next, added, role.id);
  await db.transaction(async (tx) => {
    await tx.select({ id: roles.id }).from(roles).where(eq(roles.id, role.id)).for("update");
    if (removed.length) await tx.delete(rolePermissions).where(and(eq(rolePermissions.roleId, role.id), inArray(rolePermissions.permissionCode, removed)));
    if (added.length) await tx.insert(rolePermissions).values(added.map((p) => ({ roleId: role.id, permissionCode: p })));
    await tx.update(roles).set({ name: input.name, description: input.description ?? null, updatedAt: now }).where(eq(roles.id, role.id));
    await audit(tx, ctx, {
      action: "identity.role.updated",
      entityType: "role",
      entityId: role.id,
      entityNumber: role.code,
      siteId: null,
      reason: input.reason,
      before: { name: role.name, description: role.description, permissions: current.length },
      after: {
        name: input.name,
        description: input.description ?? null,
        permissions: next.length,
        added: added.map((code) => ({ code, sensitivity: sensitivityOf(code) })),
        removed: removed.map((code) => ({ code, sensitivity: sensitivityOf(code) })),
      },
    });
    if (isOwnerBreakGlass(ctx)) await audit(tx, ctx, { action: "identity.role.owner_break_glass", entityType: "role", entityId: role.id, siteId: null, after: { use: "update" } });
  });
}

/** US-1-29 AC2: deactivation ends every live assignment of the role (audited) and blocks new grants. */
export async function deactivateCustomRole(ctx: AuthContext, roleId: string, reason: string, now: Date = new Date()): Promise<number> {
  ctx.require("identity.role.admin");
  const role = await loadCustom(ctx, roleId, "deactivate it");
  const why = requireReason(reason);
  await assertStepUp(ctx, "deactivate a role", now);
  if (role.status === "inactive") throw new DomainError("state", "This role is already inactive.");
  return db.transaction(async (tx) => {
    const live = await tx.select().from(userSiteAssignments).where(and(eq(userSiteAssignments.roleId, role.id), isNull(userSiteAssignments.revokedAt))).for("update");
    for (const a of live) {
      const validTo = a.validTo && a.validTo.getTime() <= now.getTime() ? a.validTo : a.validFrom.getTime() > now.getTime() ? a.validFrom : now;
      await tx.update(userSiteAssignments).set({ validTo, revokedAt: now, revokedBy: ctx.userId, revokedReason: `role deactivated: ${why}` }).where(eq(userSiteAssignments.id, a.id));
      await audit(tx, ctx, { action: "identity.site_assignment.revoked", entityType: "user_site_assignments", entityId: a.id, siteId: a.siteId, reason: `role deactivated: ${why}`, before: { role: role.code }, after: { validTo } });
    }
    await tx.update(roles).set({ status: "inactive", updatedAt: now }).where(eq(roles.id, role.id));
    await audit(tx, ctx, { action: "identity.role.updated", entityType: "role", entityId: role.id, entityNumber: role.code, siteId: null, reason: why, before: { status: role.status }, after: { status: "inactive", endedAssignments: live.length } });
    return live.length;
  });
}

/** US-1-29 AC2: deletion only for a role that was never assigned (assignment history is kept). */
export async function deleteCustomRole(ctx: AuthContext, roleId: string, now: Date = new Date()): Promise<void> {
  ctx.require("identity.role.admin");
  const role = await loadCustom(ctx, roleId, "delete it");
  await assertStepUp(ctx, "delete a role", now);
  await db.transaction(async (tx) => {
    const [used] = await tx.select({ id: userSiteAssignments.id }).from(userSiteAssignments).where(eq(userSiteAssignments.roleId, role.id)).limit(1);
    if (used) throw new DomainError("state", "This role has been assigned to people, so it is kept for the record. Deactivate it instead.");
    const [child] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.clonedFromRoleId, role.id)).limit(1);
    if (child) throw new DomainError("state", "Other roles were cloned from this one. Deactivate it instead.");
    const perms = await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, role.id)).returning({ code: rolePermissions.permissionCode });
    await tx.delete(roles).where(eq(roles.id, role.id));
    await audit(tx, ctx, { action: "identity.role.deleted", entityType: "role", entityId: role.id, entityNumber: role.code, siteId: null, before: { name: role.name, permissions: perms.length } });
  });
}
