import "server-only";
import { and, asc, desc, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, invitations, mfaSecrets, rolePermissions, roles, sessions, sites, userSiteAssignments, users, warehouses } from "@/db/schema";
import { activeAssignment, parseScope } from "@/lib/auth/assignments";
import type { AuthContext } from "@/lib/auth/context";
import { SYSTEM_USER_STATUS } from "@/lib/auth/system";
import { DomainError } from "@/lib/errors";

/**
 * User administration read models (US-1-16). Scope: organization-wide viewers see every user of the
 * organization; site-scoped viewers see the users that hold (or held) an assignment in one of their
 * sites (docs/permissions-matrix.md §4.1 "Identity").
 */

export async function viewerIsOrgWide(ctx: AuthContext): Promise<boolean> {
  const r = await db
    .select({ id: userSiteAssignments.id })
    .from(userSiteAssignments)
    .where(and(eq(userSiteAssignments.userId, ctx.userId), eq(userSiteAssignments.isOrganizationWide, true), activeAssignment()))
    .limit(1);
  return r.length > 0;
}

/** User ids visible to the caller (null = every user of the organization). Ended assignments still count (former staff). */
export async function visibleUserIds(ctx: AuthContext): Promise<string[] | null> {
  if (await viewerIsOrgWide(ctx)) return null;
  const rows = await db
    .selectDistinct({ userId: userSiteAssignments.userId })
    .from(userSiteAssignments)
    .where(inArray(userSiteAssignments.siteId, ctx.allowedSiteIds));
  return rows.map((r) => r.userId);
}

/** 404 unless the user is in the caller's view. */
export async function assertUserVisible(ctx: AuthContext, userId: string): Promise<void> {
  const visible = await visibleUserIds(ctx);
  if (visible !== null && !visible.includes(userId)) throw new DomainError("not_found", "User not found in your sites.");
}

export type AssignmentView = {
  id: string;
  userId: string;
  roleId: string;
  roleCode: string;
  roleName: string;
  roleIsSystem: boolean;
  siteId: string | null;
  siteCode: string | null;
  siteName: string | null;
  orgWide: boolean;
  createdAt: Date;
  validFrom: Date;
  validTo: Date | null;
  revokedAt: Date | null;
  revokedReason: string | null;
  /** active | scheduled (starts later) | ended */
  state: "active" | "scheduled" | "ended";
  warehouseIds: string[] | null;
  warehouseCodes: string[];
};

async function assignmentsFor(userIds: string[], opts: { includeEnded?: boolean } = {}): Promise<AssignmentView[]> {
  if (userIds.length === 0) return [];
  const rows = await db
    .select({
      id: userSiteAssignments.id,
      userId: userSiteAssignments.userId,
      roleId: roles.id,
      roleCode: roles.code,
      roleName: roles.name,
      roleIsSystem: roles.isSystem,
      siteId: userSiteAssignments.siteId,
      siteCode: sites.code,
      siteName: sites.name,
      orgWide: userSiteAssignments.isOrganizationWide,
      createdAt: userSiteAssignments.createdAt,
      validFrom: userSiteAssignments.validFrom,
      validTo: userSiteAssignments.validTo,
      revokedAt: userSiteAssignments.revokedAt,
      revokedReason: userSiteAssignments.revokedReason,
      scope: userSiteAssignments.scope,
    })
    .from(userSiteAssignments)
    .innerJoin(roles, eq(roles.id, userSiteAssignments.roleId))
    .leftJoin(sites, eq(sites.id, userSiteAssignments.siteId))
    .where(and(inArray(userSiteAssignments.userId, userIds), opts.includeEnded ? sql`true` : and(isNull(userSiteAssignments.revokedAt), sql`(${userSiteAssignments.validTo} is null or ${userSiteAssignments.validTo} > now())`)))
    .orderBy(asc(roles.name), asc(sites.code));
  const whIds = [...new Set(rows.flatMap((r) => parseScope(r.scope)?.warehouseIds ?? []))];
  const whs = whIds.length ? await db.select({ id: warehouses.id, code: warehouses.code }).from(warehouses).where(inArray(warehouses.id, whIds)) : [];
  const now = Date.now();
  return rows.map(({ scope, ...r }) => {
    const ids = parseScope(scope)?.warehouseIds ?? null;
    const ended = !!r.revokedAt || (r.validTo !== null && r.validTo.getTime() <= now);
    return {
      ...r,
      state: ended ? "ended" : r.validFrom.getTime() > now ? "scheduled" : "active",
      warehouseIds: ids,
      warehouseCodes: (ids ?? []).map((id) => whs.find((w) => w.id === id)?.code ?? "?"),
    };
  });
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

export async function listUsers(ctx: AuthContext, filter: { status?: string; q?: string } = {}): Promise<UserListRow[]> {
  ctx.require("identity.user.view");
  const visible = await visibleUserIds(ctx);
  // The system actor (status `system`, ADR-029) is not a person: never listed, never administered.
  const conds = [eq(users.organizationId, ctx.organizationId), ne(users.status, SYSTEM_USER_STATUS)];
  if (visible !== null) conds.push(inArray(users.id, visible.length ? visible : ["00000000-0000-0000-0000-000000000000"]));
  if (filter.status && ["invited", "active", "locked", "deactivated"].includes(filter.status)) conds.push(eq(users.status, filter.status));
  if (filter.q) {
    const q = `%${filter.q.trim().slice(0, 80).replace(/[\\%_]/g, (m) => "\\" + m)}%`;
    conds.push(sql`(${users.displayName} ilike ${q} or ${users.email} ilike ${q})`);
  }
  const rows = await db
    .select({ id: users.id, email: users.email, displayName: users.displayName, status: users.status, lastLoginAt: users.lastLoginAt })
    .from(users)
    .where(and(...conds))
    .orderBy(asc(users.displayName));
  const asg = await assignmentsFor(rows.map((r) => r.id));
  return rows.map((u) => {
    const mine = asg.filter((a) => a.userId === u.id && (visible === null || a.orgWide || (a.siteId && ctx.allowedSiteIds.includes(a.siteId))));
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
  user: {
    id: string;
    email: string;
    displayName: string;
    status: string;
    failedLoginCount: number;
    lastLoginAt: Date | null;
    passwordChangedAt: Date | null;
    deactivatedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  };
  assignments: AssignmentView[];
  endedAssignments: AssignmentView[];
  hiddenAssignments: number;
  permissionsByModule: { module: string; permissions: string[] }[];
  permissionCount: number;
  invitation: { id: string; expiresAt: Date; createdAt: Date; expired: boolean } | null;
  mfaEnrolled: boolean;
  liveSessions: number;
  history: { id: string; action: string; actorName: string | null; actorLabel: string | null; reason: string | null; occurredAt: Date }[] | null;
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
      passwordChangedAt: users.passwordChangedAt,
      deactivatedAt: users.deactivatedAt,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.organizationId, ctx.organizationId), ne(users.status, SYSTEM_USER_STATUS)))
    .limit(1);
  if (!u) throw new DomainError("not_found", "User not found.");
  const all = await assignmentsFor([u.id], { includeEnded: true });
  const inScope = (a: AssignmentView) => visible === null || a.orgWide || (!!a.siteId && ctx.allowedSiteIds.includes(a.siteId));
  const shown = all.filter(inScope);
  const current = all.filter((a) => a.state !== "ended");
  const roleIds = [...new Set(current.filter((a) => a.state === "active").map((a) => a.roleId))];
  const perms = roleIds.length
    ? await db.selectDistinct({ code: rolePermissions.permissionCode }).from(rolePermissions).where(inArray(rolePermissions.roleId, roleIds))
    : [];
  const grouped = new Map<string, string[]>();
  for (const p of perms.map((r) => r.code).sort()) {
    const mod = p.split(".")[0];
    grouped.set(mod, [...(grouped.get(mod) ?? []), p]);
  }
  const [inv] = await db
    .select({ id: invitations.id, expiresAt: invitations.expiresAt, createdAt: invitations.createdAt })
    .from(invitations)
    .where(and(eq(invitations.userId, u.id), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
    .orderBy(desc(invitations.createdAt))
    .limit(1);
  const [factor] = await db.select({ confirmedAt: mfaSecrets.confirmedAt }).from(mfaSecrets).where(eq(mfaSecrets.userId, u.id)).limit(1);
  const [live] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(sessions)
    .where(and(eq(sessions.userId, u.id), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date()), eq(sessions.stage, "active")));
  const history = ctx.can("platform.audit.view")
    ? await db
        .select({ id: auditEvents.id, action: auditEvents.action, actorName: users.displayName, actorLabel: auditEvents.actorLabel, reason: auditEvents.reason, occurredAt: auditEvents.occurredAt })
        .from(auditEvents)
        .leftJoin(users, eq(users.id, auditEvents.actorId))
        .where(
          and(
            eq(auditEvents.organizationId, ctx.organizationId),
            sql`((${auditEvents.entityType} = 'user' and ${auditEvents.entityId} = ${u.id}) or (${auditEvents.entityType} = 'user_site_assignments' and ${auditEvents.entityNumber} = ${u.email}))`,
          ),
        )
        .orderBy(sql`${auditEvents.occurredAt} desc`)
        .limit(15)
    : null;
  return {
    user: u,
    assignments: shown.filter((a) => a.state !== "ended"),
    endedAssignments: shown.filter((a) => a.state === "ended").slice(0, 20),
    hiddenAssignments: current.filter((a) => !inScope(a)).length,
    permissionsByModule: [...grouped.entries()].map(([module, permissions]) => ({ module, permissions })),
    permissionCount: perms.length,
    invitation: inv ? { ...inv, expired: inv.expiresAt.getTime() <= Date.now() } : null,
    mfaEnrolled: !!factor?.confirmedAt,
    liveSessions: Number(live?.n ?? 0),
    history,
  };
}

export type RoleRow = {
  id: string;
  code: string;
  name: string;
  isSystem: boolean;
  status: string;
  allowsOrganizationWide: boolean;
  clonedFromName: string | null;
  permissionCount: number;
  userCount: number;
};

export async function listRoles(ctx: AuthContext): Promise<RoleRow[]> {
  ctx.require("identity.role.view");
  const src = sql.raw('"src"');
  const rows = await db
    .select({
      id: roles.id,
      code: roles.code,
      name: roles.name,
      isSystem: roles.isSystem,
      status: roles.status,
      allowsOrganizationWide: roles.allowsOrganizationWide,
      clonedFromName: sql<string | null>`(select ${src}.name from roles ${src} where ${src}.id = "roles"."cloned_from_role_id")`,
      permissionCount: sql<number>`(select count(*)::int from role_permissions rp where rp.role_id = "roles"."id")`,
      userCount: sql<number>`(select count(distinct a.user_id)::int from user_site_assignments a where a.role_id = "roles"."id" and a.revoked_at is null and a.valid_from <= now() and (a.valid_to is null or a.valid_to > now()))`,
    })
    .from(roles)
    .where(eq(roles.organizationId, ctx.organizationId))
    .orderBy(desc(roles.isSystem), asc(roles.name));
  return rows.map((r) => ({ ...r, permissionCount: Number(r.permissionCount), userCount: Number(r.userCount) }));
}
