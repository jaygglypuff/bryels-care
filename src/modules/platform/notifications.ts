import "server-only";
import { and, count, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { notifications, rolePermissions, roles, userSiteAssignments, users } from "@/db/schema";
import { activeAssignment } from "@/lib/auth/assignments";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import type { Permission } from "@/lib/permissions";
import { RESOLVABLE_KINDS, resolveDoneNotifications } from "./notification-done";

export const SEVERITIES = ["info", "warning", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

export type NotificationInput = {
  organizationId: string;
  siteId?: string | null;
  kind: string;
  severity: Severity;
  title: string;
  body: string;
  entityType?: string | null;
  entityId?: string | null;
  link?: string | null;
  /** Same recipient + key is delivered once (alert deduplication). */
  dedupeKey?: string | null;
};

/**
 * In-app delivery: one row per recipient, delivered immediately (channel in_app). Email
 * delivery is not configured in Phase 2, so nothing pretends to send one (FR-platform-06).
 * Returns the recipients that received a new row (duplicates by dedupe key are skipped).
 */
export async function notifyUsers(q: DbOrTx, userIds: string[], n: NotificationInput): Promise<string[]> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return [];
  const rows = await q
    .insert(notifications)
    .values(
      ids.map((u) => ({
        organizationId: n.organizationId,
        siteId: n.siteId ?? null,
        recipientUserId: u,
        kind: n.kind,
        severity: n.severity,
        title: n.title.slice(0, 200),
        body: n.body.slice(0, 2000),
        entityType: n.entityType ?? null,
        entityId: n.entityId ?? null,
        link: n.link ?? null,
        channel: "in_app",
        deliveredAt: new Date(),
        dedupeKey: n.dedupeKey ?? null,
      })),
    )
    .onConflictDoNothing()
    .returning({ recipient: notifications.recipientUserId });
  return rows.map((r) => r.recipient);
}

/**
 * Active users holding one of the roles: organization-wide assignments always match; site
 * assignments match when `siteId` is given and equal.
 */
export async function usersWithRoles(q: DbOrTx, organizationId: string, roleCodes: string[], siteId?: string | null): Promise<string[]> {
  if (roleCodes.length === 0) return [];
  const rows = await q
    .selectDistinct({ id: users.id })
    .from(userSiteAssignments)
    .innerJoin(roles, eq(roles.id, userSiteAssignments.roleId))
    .innerJoin(users, eq(users.id, userSiteAssignments.userId))
    .where(
      and(
        eq(users.organizationId, organizationId),
        eq(users.status, "active"),
        inArray(roles.code, roleCodes),
        activeAssignment(), // W2E: ended or future assignments do not count
        siteId ? or(eq(userSiteAssignments.isOrganizationWide, true), eq(userSiteAssignments.siteId, siteId)) : eq(userSiteAssignments.isOrganizationWide, true),
      ),
    );
  return rows.map((r) => r.id);
}

/**
 * Active users who hold `permission` at the site through a current role assignment (site assignment at
 * that site, or organization-wide). Used to tell the people who must act next (hand-off notifications:
 * production orders to approve, lots waiting for QA, invoice drafts to submit).
 */
export async function usersHoldingPermissionAt(q: DbOrTx, organizationId: string, permission: Permission, siteId: string): Promise<string[]> {
  const rows = await q
    .selectDistinct({ id: users.id })
    .from(userSiteAssignments)
    .innerJoin(users, eq(users.id, userSiteAssignments.userId))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userSiteAssignments.roleId))
    .where(
      and(
        eq(users.organizationId, organizationId),
        eq(users.status, "active"),
        eq(rolePermissions.permissionCode, permission),
        activeAssignment(),
        or(eq(userSiteAssignments.isOrganizationWide, true), eq(userSiteAssignments.siteId, siteId)),
      ),
    );
  return rows.map((r) => r.id);
}

/**
 * Round 5 (ADR-129): the people whose JOB this is. Holders of `permission` at the site; when some of them hold one of
 * `jobRoles` (role codes, e.g. warehouse_operator for put-away), only those. When nobody holds the job's roles there,
 * every holder of the permission, so the work is never orphaned.
 */
export async function usersForJob(q: DbOrTx, organizationId: string, permission: Permission, siteId: string, jobRoles: readonly string[]): Promise<string[]> {
  const holders = await usersHoldingPermissionAt(q, organizationId, permission, siteId);
  if (!holders.length || !jobRoles.length) return holders;
  const job = new Set(await usersWithRoles(q, organizationId, [...jobRoles], siteId));
  const mine = holders.filter((u) => job.has(u));
  return mine.length ? mine : holders;
}

/** Notifies every holder of the roles (see usersWithRoles); returns the recipients. */
export async function notifyRoles(q: DbOrTx, target: { roleCodes: string[]; siteId?: string | null }, n: NotificationInput) {
  const ids = await usersWithRoles(q, n.organizationId, target.roleCodes, target.siteId);
  await notifyUsers(q, ids, n);
  return ids;
}

/**
 * Round 5 (ADR-129): before the bell is counted or the list is shown, messages whose work is done are cleared
 * (notification-done.ts). A failure there never hides the messages.
 */
async function clearDone(ctx: AuthContext) {
  await resolveDoneNotifications(db, { organizationId: ctx.organizationId, recipientUserId: ctx.userId }).catch((e) => console.error("clearDone", e));
}

/** Self-service: the signed-in user's notifications, newest first. "open": not done and not taken on ("I'm on it"). */
export async function listMyNotifications(ctx: AuthContext, f: { show?: "open" | "all" } = {}) {
  await clearDone(ctx);
  const conds = [eq(notifications.recipientUserId, ctx.userId), eq(notifications.organizationId, ctx.organizationId)];
  if (f.show !== "all") conds.push(isNull(notifications.acknowledgedAt), isNull(notifications.resolvedAt));
  return db
    .select()
    .from(notifications)
    .where(and(...conds))
    .orderBy(desc(notifications.createdAt))
    .limit(200);
}

/** Count for the bell: open (not acknowledged, not done) and unread. */
export async function unreadNotificationCount(ctx: AuthContext): Promise<number> {
  await clearDone(ctx);
  const [r] = await db
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.recipientUserId, ctx.userId), isNull(notifications.readAt), isNull(notifications.acknowledgedAt), isNull(notifications.resolvedAt)));
  return Number(r?.n ?? 0);
}

/**
 * Round 5 leftovers (ADR-132 §1): the signed-in person's open messages that ask them to act (kinds that clear when
 * the work is done), read or not. "Needs me" counts these (analytics `needsMeSummary`); the bell still counts unread.
 */
export async function openActionMessages(ctx: AuthContext) {
  await clearDone(ctx);
  return db
    .select({ id: notifications.id, kind: notifications.kind, entityType: notifications.entityType, entityId: notifications.entityId, link: notifications.link, createdAt: notifications.createdAt })
    .from(notifications)
    .where(
      and(
        eq(notifications.recipientUserId, ctx.userId),
        eq(notifications.organizationId, ctx.organizationId),
        isNull(notifications.acknowledgedAt),
        isNull(notifications.resolvedAt),
        inArray(notifications.kind, RESOLVABLE_KINDS as string[]),
      ),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(300);
}

async function own(ctx: AuthContext, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new DomainError("not_found", "Notification not found.");
  const [n] = await db.select().from(notifications).where(and(eq(notifications.id, id), eq(notifications.recipientUserId, ctx.userId))).limit(1);
  if (!n) throw new DomainError("not_found", "Notification not found.");
  return n;
}

/** Marks one of the user's own notifications as read; others' are "not found". */
export async function markNotificationRead(ctx: AuthContext, id: string) {
  const n = await own(ctx, id);
  if (n.readAt) return n;
  const [u] = await db.update(notifications).set({ readAt: new Date() }).where(eq(notifications.id, n.id)).returning();
  return u;
}

/** Acknowledge = "I have seen this and am dealing with it"; removes it from the open list. */
export async function acknowledgeNotification(ctx: AuthContext, id: string) {
  const n = await own(ctx, id);
  if (n.acknowledgedAt) return n;
  const now = new Date();
  const [u] = await db.update(notifications).set({ acknowledgedAt: now, readAt: n.readAt ?? now }).where(eq(notifications.id, n.id)).returning();
  return u;
}

/** Marks all of the user's open notifications as read. */
export async function markAllNotificationsRead(ctx: AuthContext) {
  await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.recipientUserId, ctx.userId), isNull(notifications.readAt)));
}
