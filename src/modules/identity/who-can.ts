import "server-only";
import { and, eq, ne, or } from "drizzle-orm";
import { db } from "@/db/client";
import { rolePermissions, roles, userSiteAssignments, users } from "@/db/schema";
import { activeAssignment } from "@/lib/auth/assignments";
import type { AuthContext } from "@/lib/auth/context";
import { PERMISSIONS, ROLE_BUNDLES } from "@/lib/permissions";

export type WhoCanDo = { roles: string[]; people: { name: string; email: string; role: string }[] };

/**
 * "Who can do this?" for a refused step (ADR-073): the roles that hold `permission` and the active
 * colleagues who hold it at the site (or organization-wide), other than the person asking. Same
 * organization only; names, e-mail and role are what the user directory already shows to colleagues.
 */
export async function whoCanDo(ctx: AuthContext, permission: string, siteId: string | null): Promise<WhoCanDo> {
  if (!(PERMISSIONS as readonly string[]).includes(permission)) return { roles: [], people: [] };
  const site = siteId && ctx.allowedSiteIds.includes(siteId) ? siteId : ctx.currentSiteId;
  const rows = await db
    .selectDistinct({ name: users.displayName, email: users.email, roleCode: roles.code, roleName: roles.name })
    .from(rolePermissions)
    .innerJoin(roles, eq(roles.id, rolePermissions.roleId))
    .innerJoin(userSiteAssignments, eq(userSiteAssignments.roleId, roles.id))
    .innerJoin(users, eq(users.id, userSiteAssignments.userId))
    .where(
      and(
        eq(rolePermissions.permissionCode, permission),
        eq(roles.organizationId, ctx.organizationId),
        eq(roles.status, "active"),
        eq(users.status, "active"),
        ne(users.id, ctx.userId),
        or(eq(userSiteAssignments.isOrganizationWide, true), eq(userSiteAssignments.siteId, site)),
        activeAssignment(),
      ),
    );
  const roleName = (code: string, name: string) => ROLE_BUNDLES[code]?.name ?? name;
  const people = new Map<string, { name: string; email: string; role: string }>();
  for (const r of rows) if (!people.has(r.email)) people.set(r.email, { name: r.name, email: r.email, role: roleName(r.roleCode, r.roleName) });
  const roleRows = await db
    .selectDistinct({ code: roles.code, name: roles.name })
    .from(rolePermissions)
    .innerJoin(roles, eq(roles.id, rolePermissions.roleId))
    .where(and(eq(rolePermissions.permissionCode, permission), eq(roles.organizationId, ctx.organizationId), eq(roles.status, "active")));
  return {
    roles: roleRows.map((r) => roleName(r.code, r.name)).sort(),
    people: [...people.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 8),
  };
}
