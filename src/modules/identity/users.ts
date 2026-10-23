import "server-only";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, rolePermissions, roles, sites, userSiteAssignments, users } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { SYSTEM_USER_STATUS } from "@/lib/auth/system";

/**
 * User and role administration read models (MVP: read-only except unlocking a locked account).
 * Scope: organization-wide viewers see every user of the organization; site-scoped viewers see the users
 * that hold at least one assignment in one of their sites (docs/permissions-matrix.md §4).
 */

async function viewerIsOrgWide(ctx: AuthContext): Promise<boolean> {
  const r = await db
    .select({ id: userSiteAssignments.id })
    .from(userSiteAssignments)
    .where(and(eq(userSiteAssignments.userId, ctx.userId), eq(userSiteAssignments.isOrganizationWide, true)))
    .limit(1);
  return r.length > 0;
}

/** User ids visible to the caller (null = every user of the organization). */
async function visibleUserIds(ctx: AuthContext): Promise<string[] | null> {
  if (await viewerIsOrgWide(ctx)) return null;
  const rows = await db
    .selectDistinct({ userId: userSiteAssignments.userId })
    .from(userSiteAssignments)
    .where(inArray(userSiteAssignments.siteId, ctx.allowedSiteIds));
  return rows.map((r) => r.userId);
}

export type AssignmentView = { id: string; userId: string; roleCode: string; roleName: string; siteId: string | null; siteCode: string | null; siteName: string | null; orgWide: boolean; createdAt: Date };

async function assignmentsFor(userIds: string[]): Promise<AssignmentView[]> {
  if (userIds.length === 0) return [];
  return db
    .select({
      id: userSiteAssignments.id,
      userId: userSiteAssignments.userId,
      roleCode: roles.code,
      roleName: roles.name,
      siteId: userSiteAssignments.siteId,
      siteCode: sites.code,
      siteName: sites.name,
      orgWide: userSiteAssignments.isOrganizationWide,
      createdAt: userSiteAssignments.createdAt,
    })
    .from(userSiteAssignments)
    .innerJoin(roles, eq(roles.id, userSiteAssignments.roleId))
    .leftJoin(sites, eq(sites.id, userSiteAssignments.siteId))
    .where(inArray(userSiteAssignments.userId, userIds))
    .orderBy(asc(roles.name), asc(sites.code));
}

export type UserListRow = {
  id: string;
  email: string;
  displayName: string;
  status: string;
  lastLoginAt: Date | null;
  roles: string[];
  siteScope: string;
  orgWide: boolean;
};

export async function listUsers(ctx: AuthContext): Promise<UserListRow[]> {
  ctx.require("identity.user.view");
  const visible = await visibleUserIds(ctx);
  // The system actor (status `system`, ADR-029) is not a person: never listed, never administered.
  const people = and(eq(users.organizationId, ctx.organizationId), ne(users.status, SYSTEM_USER_STATUS));
  const where = visible === null ? people : and(people, inArray(users.id, visible.length ? visible : ["00000000-0000-0000-0000-000000000000"]));
  const rows = await db
    .select({ id: users.id, email: users.email, displayName: users.displayName, status: users.status, lastLoginAt: users.lastLoginAt })
    .from(users)
    .where(where)
    .orderBy(asc(users.displayName));
  const asg = await assignmentsFor(rows.map((r) => r.id));
  return rows.map((u) => {
    const mine = asg.filter((a) => a.userId === u.id);
    const orgWide = mine.some((a) => a.orgWide);
    const siteCodes = [...new Set(mine.filter((a) => a.siteCode).map((a) => a.siteCode!))].sort();
    return {
      ...u,
      roles: [...new Set(mine.map((a) => a.roleName))],
      orgWide,
      siteScope: orgWide ? "All sites" : siteCodes.join(", ") || "No sites",
    };
  });
}

export type UserDetail = {
  user: { id: string; email: string; displayName: string; status: string; failedLoginCount: number; lastLoginAt: Date | null; createdAt: Date; updatedAt: Date };
  assignments: AssignmentView[];
  hiddenAssignments: number;
  permissionsByModule: { module: string; permissions: string[] }[];
  permissionCount: number;
  history: { id: string; action: string; actorName: string | null; reason: string | null; occurredAt: Date }[] | null;
};

export async function getUser(ctx: AuthContext, userId: string): Promise<UserDetail> {
  ctx.require("identity.user.view");
  const visible = await visibleUserIds(ctx);
  if (visible !== null && !visible.includes(userId)) throw new DomainError("not_found", "User not found in your sites.");
  const [u] = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      status: users.status,
      failedLoginCount: users.failedLoginCount,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.organizationId, ctx.organizationId), ne(users.status, SYSTEM_USER_STATUS)))
    .limit(1);
  if (!u) throw new DomainError("not_found", "User not found.");
  const all = await assignmentsFor([u.id]);
  // Site-scoped viewers only see assignments in their own sites (plus organization-wide ones).
  const assignments = visible === null ? all : all.filter((a) => a.orgWide || (a.siteId && ctx.allowedSiteIds.includes(a.siteId)));
  const roleCodes = [...new Set(all.map((a) => a.roleCode))];
  const perms = roleCodes.length
    ? await db
        .selectDistinct({ code: rolePermissions.permissionCode })
        .from(rolePermissions)
        .innerJoin(roles, eq(roles.id, rolePermissions.roleId))
        .where(and(eq(roles.organizationId, ctx.organizationId), inArray(roles.code, roleCodes)))
    : [];
  const grouped = new Map<string, string[]>();
  for (const p of perms.map((r) => r.code).sort()) {
    const mod = p.split(".")[0];
    grouped.set(mod, [...(grouped.get(mod) ?? []), p]);
  }
  const history = ctx.can("platform.audit.view")
    ? await db
        .select({ id: auditEvents.id, action: auditEvents.action, actorName: users.displayName, reason: auditEvents.reason, occurredAt: auditEvents.occurredAt })
        .from(auditEvents)
        .leftJoin(users, eq(users.id, auditEvents.actorId))
        .where(and(eq(auditEvents.organizationId, ctx.organizationId), eq(auditEvents.entityType, "user"), eq(auditEvents.entityId, u.id)))
        .orderBy(sql`${auditEvents.occurredAt} desc`)
        .limit(10)
    : null;
  return {
    user: u,
    assignments,
    hiddenAssignments: all.length - assignments.length,
    permissionsByModule: [...grouped.entries()].map(([module, permissions]) => ({ module, permissions })),
    permissionCount: perms.length,
    history,
  };
}

export type RoleRow = { id: string; code: string; name: string; isSystem: boolean; allowsOrganizationWide: boolean; permissionCount: number; userCount: number };

export async function listRoles(ctx: AuthContext): Promise<RoleRow[]> {
  ctx.require("identity.role.view");
  const rows = await db
    .select({
      id: roles.id,
      code: roles.code,
      name: roles.name,
      isSystem: roles.isSystem,
      allowsOrganizationWide: roles.allowsOrganizationWide,
      permissionCount: sql<number>`(select count(*)::int from role_permissions rp where rp.role_id = "roles"."id")`,
      userCount: sql<number>`(select count(distinct a.user_id)::int from user_site_assignments a where a.role_id = "roles"."id")`,
    })
    .from(roles)
    .where(eq(roles.organizationId, ctx.organizationId))
    .orderBy(asc(roles.name));
  return rows.map((r) => ({ ...r, permissionCount: Number(r.permissionCount), userCount: Number(r.userCount) }));
}

/**
 * Unlocks an account locked after repeated failed sign-ins: status locked → active, failure counter reset.
 * Audit: identity.user.unlocked (organization-level event, site_id null, because accounts are not site records).
 */
export async function unlockUser(ctx: AuthContext, userId: string, reason: string): Promise<void> {
  ctx.require("identity.user.admin");
  const visible = await visibleUserIds(ctx);
  if (visible !== null && !visible.includes(userId)) throw new DomainError("not_found", "User not found in your sites.");
  await db.transaction(async (tx) => {
    const [u] = await tx
      .select({ id: users.id, email: users.email, status: users.status, failedLoginCount: users.failedLoginCount })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.organizationId, ctx.organizationId), ne(users.status, SYSTEM_USER_STATUS)))
      .for("update")
      .limit(1);
    if (!u) throw new DomainError("not_found", "User not found.");
    if (u.status !== "locked") throw new DomainError("state", `This account is ${u.status}, not locked. Nothing to unlock.`);
    await tx.update(users).set({ status: "active", failedLoginCount: 0, updatedAt: new Date() }).where(eq(users.id, u.id));
    await tx.insert(auditEvents).values({
      organizationId: ctx.organizationId,
      siteId: null,
      actorId: ctx.userId,
      action: "identity.user.unlocked",
      entityType: "user",
      entityId: u.id,
      entityNumber: u.email,
      reason,
      before: { status: u.status, failedLoginCount: u.failedLoginCount },
      after: { status: "active", failedLoginCount: 0 },
    });
  });
}
