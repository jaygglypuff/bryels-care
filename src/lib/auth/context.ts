import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { rolePermissions, roles, sites, userSiteAssignments, users } from "@/db/schema";
import { DomainError } from "@/lib/errors";
import type { Permission } from "@/lib/permissions";
import { SITE_COOKIE, readSession } from "./session";

export type SiteRef = { id: string; code: string; name: string };

/**
 * Who is acting. Background jobs act as `system:<job code>`; when a user triggered the job,
 * `onBehalfOf` is that user and the context carries the user's *current* permissions and sites
 * (rebuilt when the job runs, never copied from the enqueue time). docs/architecture.md §8 rule 4.
 */
export type Actor = { kind: "user" } | { kind: "system"; code: string; onBehalfOf: string | null };

export type ContextOptions = { actor?: Actor; correlationId?: string | null };

/**
 * The authorization context every service call receives (ADR-005).
 * Permissions are the union over the user's assignments; site scope is the set of assigned sites
 * (or every site for organization-wide roles). Checks happen on the server, never only in the UI.
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
  return new AuthContext(loaded.u.id, loaded.u.organizationId, loaded.u.displayName, loaded.u.email, loaded.roleCodes, loaded.perms, loaded.siteRows, current, options);
}

async function loadAccess(userId: string) {
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u || u.status !== "active") return null;
  const assignments = await db
    .select({ roleId: userSiteAssignments.roleId, siteId: userSiteAssignments.siteId, orgWide: userSiteAssignments.isOrganizationWide, roleCode: roles.code })
    .from(userSiteAssignments)
    .innerJoin(roles, eq(roles.id, userSiteAssignments.roleId))
    .where(eq(userSiteAssignments.userId, userId));
  if (assignments.length === 0) return null;
  const roleIds = [...new Set(assignments.map((a) => a.roleId))];
  const perms = await db.select({ code: rolePermissions.permissionCode }).from(rolePermissions).where(inArray(rolePermissions.roleId, roleIds));
  const orgWide = assignments.some((a) => a.orgWide);
  const siteRows = orgWide
    ? await db.select({ id: sites.id, code: sites.code, name: sites.name }).from(sites).where(and(eq(sites.organizationId, u.organizationId), eq(sites.isActive, true)))
    : await db
        .select({ id: sites.id, code: sites.code, name: sites.name })
        .from(sites)
        .where(inArray(sites.id, assignments.map((a) => a.siteId).filter((x): x is string => !!x)));
  siteRows.sort((a, b) => a.code.localeCompare(b.code));
  if (siteRows.length === 0) return null;
  return { u, siteRows, roleCodes: [...new Set(assignments.map((a) => a.roleCode))], perms: new Set(perms.map((p) => p.code)) };
}

async function buildContext(userId: string): Promise<AuthContext | null> {
  const jar = await cookies();
  return buildContextForUser(userId, jar.get(SITE_COOKIE)?.value);
}

/** Per-request cached context; null when signed out. */
export const getContext = cache(async (): Promise<AuthContext | null> => {
  const s = await readSession();
  if (!s) return null;
  return buildContext(s.userId);
});

/** For pages and actions: redirects to sign-in when there is no valid session. */
export async function requireContext(): Promise<AuthContext> {
  const ctx = await getContext();
  if (!ctx) redirect("/sign-in");
  return ctx;
}
