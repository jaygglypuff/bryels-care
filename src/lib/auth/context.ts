import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { rolePermissions, roles, sites, userSiteAssignments, users } from "@/db/schema";
import { DomainError } from "@/lib/errors";
import type { Permission } from "@/lib/permissions";
import { activeAssignment, parseScope } from "./assignments";
import { SITE_COOKIE, readSession } from "./session";

export type SiteRef = { id: string; code: string; name: string };

/**
 * Who is acting. Background jobs act as `system:<job code>`; when a user triggered the job,
 * `onBehalfOf` is that user and the context carries the user's *current* permissions and sites
 * (rebuilt when the job runs, never copied from the enqueue time). docs/architecture.md §8 rule 4.
 */
export type Actor = { kind: "user" } | { kind: "system"; code: string; onBehalfOf: string | null };

/** The interactive session behind a context (null for jobs). Read fresh from `sessions` on every request. */
export type SessionInfo = { id: string; reauthenticatedAt: Date | null; mfaVerifiedAt: Date | null; privileged: boolean };

/**
 * Per-site detail of the user's access (W2E, docs/permissions-matrix.md §1.1). When absent (contexts
 * built by tests or the system actor) the flat permission set applies at every allowed site and no
 * warehouse sub-scope applies.
 */
export type AccessDetail = {
  orgWide: boolean;
  orgPermissions: ReadonlySet<string>;
  sitePermissions: ReadonlyMap<string, ReadonlySet<string>>;
  /** siteId → warehouse ids the user may write in; a missing site or null = the whole site (matrix §4.4). */
  warehouseScopes: ReadonlyMap<string, readonly string[] | null>;
};

export type ContextOptions = { actor?: Actor; correlationId?: string | null; session?: SessionInfo | null; access?: AccessDetail };

/**
 * The authorization context every service call receives (ADR-005).
 * Permissions are the union over the user's assignments; site scope is the set of assigned sites
 * (or every site for organization-wide roles). Checks happen on the server, never only in the UI.
 * `canAt`/`requireAt` check a permission at one site (per-assignment precision, W2E).
 */
export class AuthContext {
  constructor(
    readonly userId: string,
    readonly organizationId: string,
    readonly displayName: string,
    readonly email: string,
    readonly roleCodes: string[],
    readonly permissions: ReadonlySet<string>,
    readonly allowedSites: SiteRef[],
    readonly currentSiteId: string,
    readonly options: ContextOptions = {},
  ) {}

  get actor(): Actor {
    return this.options.actor ?? { kind: "user" };
  }

  /** `system:<code>` for jobs, null for people. */
  get actorLabel(): string | null {
    const a = this.actor;
    return a.kind === "system" ? `system:${a.code}` : null;
  }

  get correlationId(): string | null {
    return this.options.correlationId ?? null;
  }

  get allowedSiteIds(): string[] {
    return this.allowedSites.map((s) => s.id);
  }

  get currentSite(): SiteRef {
    return this.allowedSites.find((s) => s.id === this.currentSiteId)!;
  }

  can(p: Permission): boolean {
    return this.permissions.has(p);
  }

  require(p: Permission): void {
    if (!this.permissions.has(p)) throw new DomainError("forbidden", `You do not have permission for this action (${p}).`);
  }

  /** Fails closed when the site is outside the user's scope. */
  requireSite(siteId: string): void {
    if (!this.allowedSiteIds.includes(siteId)) throw new DomainError("not_found", "Record not found in your sites.");
  }

  /** True only when an organization-wide assignment exists (owner_director, system_admin, auditor). */
  get isOrganizationWide(): boolean {
    return this.options.access?.orgWide ?? false;
  }

  get session(): SessionInfo | null {
    return this.options.session ?? null;
  }

  get sessionId(): string | null {
    return this.options.session?.id ?? null;
  }

  /** The permission held AT the site: from an organization-wide assignment or an assignment at that site. */
  canAt(p: Permission, siteId: string): boolean {
    if (!this.allowedSiteIds.includes(siteId)) return false;
    const a = this.options.access;
    if (!a) return this.permissions.has(p);
    return a.orgPermissions.has(p) || (a.sitePermissions.get(siteId)?.has(p) ?? false);
  }

  /** The permission held through an organization-wide assignment (needed for organization-level grants). */
  canOrgWide(p: Permission): boolean {
    const a = this.options.access;
    if (!a) return this.permissions.has(p);
    return a.orgPermissions.has(p);
  }

  /** Site scope (404) first, then the permission at that site (403). */
  requireAt(p: Permission, siteId: string): void {
    this.requireSite(siteId);
    if (!this.canAt(p, siteId)) throw new DomainError("forbidden", `You do not have permission for this action at this site (${p}).`);
  }

  /** Warehouses the user may write in at the site; null = the whole site (US-2-29). */
  warehouseScope(siteId: string): readonly string[] | null {
    return this.options.access?.warehouseScopes.get(siteId) ?? null;
  }

  /** Write sub-scope (matrix §4.4): a location of an unlisted warehouse does not exist for this user's writes. */
  requireWarehouseWrite(siteId: string, warehouseId: string): void {
    const scope = this.warehouseScope(siteId);
    if (scope && !scope.includes(warehouseId)) throw new DomainError("not_found", "This location is outside the warehouses you are assigned to.");
  }
}

/**
 * Builds a context from the user's current assignments (no cookies), e.g. for a job that runs on
 * the user's behalf. `preferredSiteId` becomes the current site when it is still allowed.
 * Returns null when the user is inactive or has no site left.
 */
export async function buildContextForUser(userId: string, preferredSiteId?: string | null, options: ContextOptions = {}): Promise<AuthContext | null> {
  const loaded = await loadAccess(userId);
  if (!loaded) return null;
  const current = loaded.siteRows.find((s) => s.id === preferredSiteId)?.id ?? loaded.siteRows[0].id;
  return new AuthContext(loaded.u.id, loaded.u.organizationId, loaded.u.displayName, loaded.u.email, loaded.roleCodes, loaded.perms, loaded.siteRows, current, {
    access: loaded.access,
    ...options,
  });
}

async function loadAccess(userId: string, now: Date = new Date()) {
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u || u.status !== "active") return null;
  const assignments = await db
    .select({
      roleId: userSiteAssignments.roleId,
      siteId: userSiteAssignments.siteId,
      orgWide: userSiteAssignments.isOrganizationWide,
      scope: userSiteAssignments.scope,
      roleCode: roles.code,
    })
    .from(userSiteAssignments)
    .innerJoin(roles, eq(roles.id, userSiteAssignments.roleId))
    .where(and(eq(userSiteAssignments.userId, userId), eq(roles.status, "active"), activeAssignment(now)));
  if (assignments.length === 0) return null;
  const roleIds = [...new Set(assignments.map((a) => a.roleId))];
  const permRows = await db
    .select({ roleId: rolePermissions.roleId, code: rolePermissions.permissionCode })
    .from(rolePermissions)
    .where(inArray(rolePermissions.roleId, roleIds));
  const byRole = new Map<string, Set<string>>();
  for (const r of permRows) byRole.set(r.roleId, (byRole.get(r.roleId) ?? new Set<string>()).add(r.code));
  const orgWide = assignments.some((a) => a.orgWide);
  const siteRows = orgWide
    ? await db.select({ id: sites.id, code: sites.code, name: sites.name }).from(sites).where(and(eq(sites.organizationId, u.organizationId), eq(sites.isActive, true)))
    : await db
        .select({ id: sites.id, code: sites.code, name: sites.name })
        .from(sites)
        .where(and(eq(sites.isActive, true), inArray(sites.id, assignments.map((a) => a.siteId).filter((x): x is string => !!x))));
  siteRows.sort((a, b) => a.code.localeCompare(b.code));
  if (siteRows.length === 0) return null;

  const orgPermissions = new Set<string>();
  const sitePermissions = new Map<string, Set<string>>();
  for (const a of assignments) {
    const perms = byRole.get(a.roleId) ?? new Set<string>();
    if (a.orgWide) perms.forEach((p) => orgPermissions.add(p));
    else if (a.siteId) {
      const set = sitePermissions.get(a.siteId) ?? new Set<string>();
      perms.forEach((p) => set.add(p));
      sitePermissions.set(a.siteId, set);
    }
  }
  // Warehouse sub-scope per site: any covering assignment without a scope means the whole site.
  const warehouseScopes = new Map<string, readonly string[] | null>();
  for (const site of siteRows) {
    const covering = assignments.filter((a) => a.orgWide || a.siteId === site.id);
    const scopes = covering.map((a) => parseScope(a.scope)?.warehouseIds ?? null);
    warehouseScopes.set(site.id, scopes.some((x) => x === null) ? null : [...new Set(scopes.flatMap((x) => x ?? []))]);
  }
  const perms = new Set<string>([...orgPermissions, ...[...sitePermissions.values()].flatMap((x) => [...x])]);
  const access: AccessDetail = { orgWide, orgPermissions, sitePermissions, warehouseScopes };
  return { u, siteRows, roleCodes: [...new Set(assignments.map((a) => a.roleCode))], perms, access };
}

/**
 * Per-request cached context; null when signed out. The session row (revocation, idle and absolute
 * expiry) and the user's status and assignments are read on every request (US-1-12 AC1, US-1-16 AC2).
 */
export const getContext = cache(async (): Promise<AuthContext | null> => {
  const s = await readSession();
  if (!s) return null;
  const jar = await cookies();
  return buildContextForUser(s.userId, jar.get(SITE_COOKIE)?.value ?? s.activeSiteId, {
    session: { id: s.sessionId, reauthenticatedAt: s.reauthenticatedAt, mfaVerifiedAt: s.mfaVerifiedAt, privileged: s.privileged },
  });
});

/** For pages and actions: redirects to sign-in when there is no valid session. */
export async function requireContext(): Promise<AuthContext> {
  const ctx = await getContext();
  if (!ctx) redirect("/sign-in");
  return ctx;
}
