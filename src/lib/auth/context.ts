import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { rolePermissions, roles, sites, userSiteAssignments, users } from "@/db/schema";
import { DomainError } from "@/lib/errors";
import { acceptableRequestId } from "@/lib/log";
import { READ_ONLY_MESSAGE, getMaintenanceState, isReadAction, isReadOnlyFor } from "@/lib/maintenance";
import { PERMISSIONS, type Permission } from "@/lib/permissions";
import { getSetting } from "@/lib/settings";
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

/**
 * `readOnly`: set when the read-only maintenance mode applies to this user (US-2-30); mutating
 * permission checks and `assertWritable()` then refuse with `read_only` before any write.
 */
export type ContextOptions = { actor?: Actor; correlationId?: string | null; session?: SessionInfo | null; access?: AccessDetail; readOnly?: boolean; ownerOverride?: OwnerOverride; selfApproval?: SelfApproval };

/**
 * ADR-073 owner override (setting `governance.owner_override`): the owner holds every permission and
 * passes every separation-of-duties check. `basePermissions` are the permissions the roles grant;
 * `used` collects what the override let through until `audit()` records it.
 */
export type OwnerOverride = { basePermissions: ReadonlySet<string>; used: string[] };

/**
 * ADR-088 §2 (setting `approvals.top_roles_self_approve`, default on): where this person holds a top role
 * — Owner/Director (organization-wide) or Site Manager (at the site, or organization-wide) — they may approve
 * their own operational records and decide every step of them alone. Present only when the setting is on and
 * the person holds a top role somewhere. `used` collects the same-person rules passed until `audit()` records
 * them. Quality decisions that release a lot or batch for use never consult this (GMP independence).
 */
export type SelfApproval = { ownerOrgWide: boolean; managerOrgWide: boolean; managerSiteIds: ReadonlySet<string>; used: string[] };

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

  /** The permission most recently checked: a same-person refusal names who else holds it. */
  private lastRequired: { permission: string; siteId: string | null } | null = null;

  require(p: Permission): void {
    this.lastRequired = { permission: p, siteId: null };
    if (!this.permissions.has(p)) throw new DomainError("forbidden", `You do not have permission for this action (${p}).`, { permission: p });
    if (this.options.readOnly && !isReadAction(p)) throw new DomainError("read_only", READ_ONLY_MESSAGE, { code: "READ_ONLY_MODE" });
    this.noteOverriddenPermission(p);
  }

  /** True when the owner override applies to this user (ADR-073). */
  get ownerOverride(): boolean {
    return !!this.options.ownerOverride;
  }

  /**
   * Separation of duties (ADR-073): true when `conflict` must block this person. Under the owner override
   * it never blocks; the bypass is remembered and recorded by the next `audit()` of the operation.
   * Use as `if (ctx.sodBlocks(x.submittedBy === ctx.userId, "…")) throw new DomainError("separation_of_duties", …)`.
   */
  sodBlocks(conflict: boolean, rule: string): boolean {
    if (!conflict) return false;
    const o = this.options.ownerOverride;
    if (!o) return true;
    if (!o.used.includes(rule)) o.used.push(rule);
    return false;
  }

  /** For screens (records nothing): whether `userId` is this person for a same-person rule (ADR-073). */
  sodConflict(userId: string | null | undefined): boolean {
    return !this.ownerOverride && !!userId && userId === this.userId;
  }

  /** For screens (records nothing): whether this person holds one of `roles`, or the owner override applies. */
  hasAnyRole(roles: readonly string[]): boolean {
    return this.ownerOverride || roles.some((r) => this.roleCodes.includes(r));
  }

  /** For decisions: like `hasAnyRole`, and a pass through the owner override is recorded for the audit. */
  actsAsAnyRole(roles: readonly string[]): boolean {
    if (roles.some((r) => this.roleCodes.includes(r))) return true;
    if (!this.ownerOverride) return false;
    const note = `role ${roles.join(" or ")}`;
    if (!this.options.ownerOverride!.used.includes(note)) this.options.ownerOverride!.used.push(note);
    return true;
  }

  /** Details for a refusal: the permission last checked, so the screen can name who else holds it. */
  refusalDetails(): Record<string, unknown> {
    return { ...this.lastRequired };
  }

  /** Throws `separation_of_duties` when `conflict` blocks this person (see `sodBlocks`). */
  assertSeparation(conflict: boolean, message: string, details?: Record<string, unknown>): void {
    if (this.sodBlocks(conflict, message)) throw new DomainError("separation_of_duties", message, { ...this.lastRequired, ...details });
  }

  /**
   * ADR-088 §2: true when this person holds a top role at `siteId` (Owner/Director organization-wide, or Site
   * Manager there) and the organization lets top roles approve their own operational records. A null site
   * (organization-level record) needs the top role organization-wide.
   */
  selfApprovesAt(siteId: string | null | undefined): boolean {
    const s = this.options.selfApproval;
    if (!s) return false;
    if (s.ownerOrgWide || s.managerOrgWide) return !siteId || this.allowedSiteIds.includes(siteId);
    return !!siteId && this.allowedSiteIds.includes(siteId) && s.managerSiteIds.has(siteId);
  }

  /** ADR-088 §2: the owner (organization-wide) also decides operational steps reserved for the site manager. */
  private ownerAt(siteId: string | null | undefined): boolean {
    const s = this.options.selfApproval;
    return !!s?.ownerOrgWide && (!siteId || this.allowedSiteIds.includes(siteId));
  }

  private noteSelfApproval(rule: string) {
    const s = this.options.selfApproval!;
    if (!s.used.includes(rule)) s.used.push(rule);
  }

  /**
   * Separation of duties for OPERATIONAL approvals (ADR-088 §2: production orders, purchasing, stock
   * adjustments and counts, price lists, quotations, customer orders and requirements, supplier returns,
   * expense claims and finance documents, master-data revisions). A same-person conflict does not block a
   * top role at the record's site; the pass is recorded by the next `audit()` as an own-request approval.
   * Otherwise this is `sodBlocks` (owner override included). Never use it for quality decisions that release
   * a lot or batch for use (QA disposition, quality check, conditional release): those keep `sodBlocks`.
   */
  sodBlocksAt(conflict: boolean, rule: string, siteId: string | null | undefined): boolean {
    if (!conflict) return false;
    if (this.selfApprovesAt(siteId)) {
      this.noteSelfApproval(rule);
      return false;
    }
    return this.sodBlocks(conflict, rule);
  }

  /** Throws `separation_of_duties` when `conflict` blocks this person at the site (see `sodBlocksAt`). */
  assertSeparationAt(conflict: boolean, message: string, siteId: string | null | undefined, details?: Record<string, unknown>): void {
    if (this.sodBlocksAt(conflict, message, siteId)) throw new DomainError("separation_of_duties", message, { ...this.lastRequired, ...details });
  }

  /** For screens (records nothing): `sodConflict` for an operational record at the site (ADR-088 §2). */
  sodConflictAt(userId: string | null | undefined, siteId: string | null | undefined): boolean {
    return this.sodConflict(userId) && !this.selfApprovesAt(siteId);
  }

  /**
   * For screens: `hasAnyRole` for a step of an operational record whose steps the owner may all decide
   * (ADR-088 §2: production, purchasing, stock, sales, expense claims). With the top-role rule on, the owner
   * (highest in the hierarchy) also decides, on a record they asked for themselves, a step reserved for another
   * role — never a step that names QA. Records asked by others keep their role steps (and the escalation delays).
   * Finance documents and master-data revisions do not use this: their role steps stay as configured.
   */
  hasAnyRoleAt(roles: readonly string[], siteId: string | null | undefined, requesterIds: readonly (string | null | undefined)[]): boolean {
    return this.hasAnyRole(roles) || this.ownerStandsIn(roles, siteId, requesterIds);
  }

  /** For decisions: `actsAsAnyRole` for an operational approval step at the site (see `hasAnyRoleAt`). */
  actsAsAnyRoleAt(roles: readonly string[], siteId: string | null | undefined, requesterIds: readonly (string | null | undefined)[]): boolean {
    if (roles.some((r) => this.roleCodes.includes(r))) return true;
    if (this.ownerStandsIn(roles, siteId, requesterIds)) {
      this.noteSelfApproval(`The owner decided a step reserved for ${roles.join(" or ")}.`);
      return true;
    }
    return this.actsAsAnyRole(roles);
  }

  private ownerStandsIn(roles: readonly string[], siteId: string | null | undefined, requesterIds: readonly (string | null | undefined)[]): boolean {
    return roles.length > 0 && !roles.includes("qa_qc") && this.ownerAt(siteId) && requesterIds.some((u) => !!u && u === this.userId);
  }

  /** The own-request approvals since the last call, emptied (read by `audit()`). */
  takeSelfApprovals(): string[] {
    const s = this.options.selfApproval;
    if (!s || s.used.length === 0) return [];
    return s.used.splice(0, s.used.length);
  }

  /** The owner-override uses since the last call, emptied (read by `audit()`). */
  takeOwnerOverrides(): string[] {
    const o = this.options.ownerOverride;
    if (!o || o.used.length === 0) return [];
    return o.used.splice(0, o.used.length);
  }

  private noteOverriddenPermission(p: string) {
    const o = this.options.ownerOverride;
    if (o && !o.basePermissions.has(p)) {
      const note = `permission ${p}`;
      if (!o.used.includes(note)) o.used.push(note);
    }
  }

  /** True while the read-only maintenance mode applies to this user (US-2-30). */
  get readOnly(): boolean {
    return this.options.readOnly === true;
  }

  /** Refuses any write while the read-only maintenance mode applies (stock ledger, job enqueue, API commands). */
  assertWritable(): void {
    if (this.options.readOnly) throw new DomainError("read_only", READ_ONLY_MESSAGE, { code: "READ_ONLY_MODE" });
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
    this.lastRequired = { permission: p, siteId };
    if (!this.canAt(p, siteId)) throw new DomainError("forbidden", `You do not have permission for this action at this site (${p}).`, { permission: p, siteId });
    this.noteOverriddenPermission(p);
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
  const readOnly = options.readOnly ?? isReadOnlyFor(await getMaintenanceState(db, loaded.u.organizationId), loaded.roleCodes);
  let { perms, access } = loaded;
  let ownerOverride: OwnerOverride | undefined;
  // ADR-073: the owner override grants every permission at every site (organization-wide) and lifts separation of duties.
  if (loaded.roleCodes.includes("owner_director") && loaded.access.orgWide && (await getSetting(db, loaded.u.organizationId, "governance.owner_override"))) {
    ownerOverride = { basePermissions: perms, used: [] };
    perms = new Set<string>(PERMISSIONS);
    access = { ...access, orgPermissions: perms };
  }
  // ADR-088 §2: top roles (owner organization-wide, site manager at their sites) approve their own operational records.
  let selfApproval: SelfApproval | undefined;
  const top = loaded.topRoles;
  if ((top.ownerOrgWide || top.managerOrgWide || top.managerSiteIds.size > 0) && (await getSetting(db, loaded.u.organizationId, "approvals.top_roles_self_approve"))) {
    selfApproval = { ...top, used: [] };
  }
  return new AuthContext(loaded.u.id, loaded.u.organizationId, loaded.u.displayName, loaded.u.email, loaded.roleCodes, perms, loaded.siteRows, current, {
    access,
    ownerOverride,
    selfApproval,
    ...options,
    readOnly,
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
  const topRoles = {
    ownerOrgWide: assignments.some((a) => a.roleCode === "owner_director" && a.orgWide),
    managerOrgWide: assignments.some((a) => a.roleCode === "site_manager" && a.orgWide),
    managerSiteIds: new Set(assignments.filter((a) => a.roleCode === "site_manager" && !a.orgWide && !!a.siteId).map((a) => a.siteId!)),
  };
  return { u, siteRows, roleCodes: [...new Set(assignments.map((a) => a.roleCode))], perms, access, topRoles };
}

/**
 * Per-request cached context; null when signed out. The session row (revocation, idle and absolute
 * expiry) and the user's status and assignments are read on every request (US-1-12 AC1, US-1-16 AC2).
 */
export const getContext = cache(async (): Promise<AuthContext | null> => {
  const s = await readSession();
  if (!s) return null;
  const jar = await cookies();
  // The request id set by src/middleware.ts becomes the correlation id of every audit row of the request (US-1-25 AC1).
  const requestId = acceptableRequestId((await headers()).get("x-request-id"));
  return buildContextForUser(s.userId, jar.get(SITE_COOKIE)?.value ?? s.activeSiteId, {
    correlationId: requestId,
    session: { id: s.sessionId, reauthenticatedAt: s.reauthenticatedAt, mfaVerifiedAt: s.mfaVerifiedAt, privileged: s.privileged },
  });
});

/** For pages and actions: redirects to sign-in when there is no valid session. */
export async function requireContext(): Promise<AuthContext> {
  const ctx = await getContext();
  if (!ctx) redirect("/sign-in");
  return ctx;
}
