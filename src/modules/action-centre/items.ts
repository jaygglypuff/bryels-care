import "server-only";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db, type Tx } from "@/db/client";
import { actionItems, notificationRules, notifications, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { systemContext } from "@/lib/auth/system";
import { sendEmail } from "@/lib/email";
import { DomainError } from "@/lib/errors";
import type { Permission } from "@/lib/permissions";
import { notifyUsers, usersWithRoles } from "@/modules/platform/notifications";
import { type Candidate, detectAll } from "./detectors";
import { ACTION_KINDS, type ActionTab, type Severity, actionKind } from "./kinds";

/**
 * The action-centre queue (US-5-06) and notification-rule application with escalation (US-5-07).
 *
 * `refreshActionItems` reconciles the stored queue with the detectors: new conditions open items
 * (and notify the rule's owner roles), conditions that no longer hold resolve their item at once
 * (resolved_at, resolution note, audit `platform.action_item.resolved`, and the related in-app
 * notifications get resolved_at too). Items unacknowledged longer than the rule's delay escalate
 * once to the escalation roles (audit `platform.action_item.escalated`). It runs when the action
 * centre opens and every 5 minutes (`platform.action_centre_sweep`); a per-organization advisory
 * lock makes concurrent refreshes skip instead of racing.
 */

const SYSTEM_DEF = { code: "platform.action_centre_sweep", systemPermissions: ["platform.job.view"] as Permission[] };

type Rule = typeof notificationRules.$inferSelect;
type Item = typeof actionItems.$inferSelect;

function ruleFor(rules: Rule[], kind: string, siteId: string | null): Rule | null {
  const active = rules.filter((r) => r.isActive && r.itemKind === kind);
  return (siteId ? active.find((r) => r.siteId === siteId) : undefined) ?? active.find((r) => r.siteId === null) ?? null;
}

async function recipientsFor(q: Tx, organizationId: string, roleCodes: string[], siteId: string | null) {
  return roleCodes.length ? usersWithRoles(q, organizationId, roleCodes, siteId) : [];
}

async function emailUsers(organizationId: string, userIds: string[], subject: string, text: string) {
  if (!userIds.length) return;
  const people = await db.select({ email: users.email, name: users.displayName }).from(users).where(inArray(users.id, userIds));
  for (const p of people) await sendEmail({ organizationId, to: p.email, template: "platform.action_item", subject, text: `Hello ${p.name},\n\n${text}\n\nOpen the action centre after signing in to deal with it.` });
}

export type RefreshResult = { skipped: boolean; opened: number; resolved: number; escalated: number; open: number };

export async function refreshActionItems(organizationId: string, now: Date = new Date()): Promise<RefreshResult> {
  const candidates = await detectAll(organizationId, now);
  const ctx = await systemContext(organizationId, SYSTEM_DEF);
  const emails: { userIds: string[]; subject: string; text: string }[] = [];
  const result = await db.transaction(async (tx) => {
    const [lock] = (await tx.execute(sql`select pg_try_advisory_xact_lock(hashtext(${"action_items:" + organizationId})) as ok`)) as unknown as { ok: boolean }[];
    if (!lock?.ok) return { skipped: true, opened: 0, resolved: 0, escalated: 0, open: 0 };
    const open = await tx.select().from(actionItems).where(and(eq(actionItems.organizationId, organizationId), isNull(actionItems.resolvedAt)));
    const rules = await tx.select().from(notificationRules).where(eq(notificationRules.organizationId, organizationId));
    const key = (kind: string, entityId: string) => `${kind}:${entityId}`;
    const current = new Map<string, Candidate>();
    for (const c of candidates) if (actionKind(c.kind)) current.set(key(c.kind, c.entityId), c);
    const openByKey = new Map(open.map((i) => [key(i.kind, i.entityId), i]));

    // 1. Resolve items whose record no longer needs action.
    let resolved = 0;
    for (const item of open) {
      if (current.has(key(item.kind, item.entityId))) continue;
      const note = "Cleared automatically: the record no longer needs this action.";
      await tx.update(actionItems).set({ resolvedAt: now, resolutionNote: note }).where(and(eq(actionItems.id, item.id), isNull(actionItems.resolvedAt)));
      await tx
        .update(notifications)
        .set({ resolvedAt: now })
        .where(and(eq(notifications.organizationId, organizationId), eq(notifications.entityId, item.entityId), sql`${notifications.kind} like 'action.%'`, isNull(notifications.resolvedAt)));
      await audit(tx, ctx, {
        action: "platform.action_item.resolved",
        entityType: "action_item",
        entityId: item.id,
        entityNumber: item.recordNumber,
        siteId: item.siteId,
        reason: note,
        after: { kind: item.kind, entityType: item.entityType, entityId: item.entityId, openedFor: Math.round((now.getTime() - item.detectedAt.getTime()) / 60_000) + " min", acknowledged: !!item.acknowledgedAt },
      });
      resolved += 1;
    }

    // 2. Open items for new conditions; refresh title/detail of the ones still open.
    let opened = 0;
    for (const [k, c] of current) {
      const existing = openByKey.get(k);
      const kind = actionKind(c.kind)!;
      const rule = ruleFor(rules, c.kind, c.siteId);
      const severity = (rule?.severity ?? kind.severity) as Severity;
      if (existing) {
        if (existing.title !== c.title || existing.detail !== c.detail || existing.severity !== severity) {
          await tx.update(actionItems).set({ title: c.title, detail: c.detail, severity }).where(eq(actionItems.id, existing.id));
        }
        continue;
      }
      const [row] = await tx
        .insert(actionItems)
        .values({
          organizationId,
          siteId: c.siteId,
          tab: kind.tab,
          kind: c.kind,
          entityType: c.entityType,
          entityId: c.entityId,
          recordNumber: c.recordNumber,
          title: c.title.slice(0, 300),
          detail: c.detail?.slice(0, 1000) ?? null,
          severity,
          viewPermission: kind.permission,
          link: c.link,
          actionLabel: kind.actionLabel,
          openedAt: c.openedAt,
          detectedAt: now,
        })
        .onConflictDoNothing()
        .returning();
      if (!row) continue;
      opened += 1;
      if (rule && (rule.ownerRoleCodes as string[]).length) {
        const to = await recipientsFor(tx, organizationId, rule.ownerRoleCodes as string[], c.siteId);
        await notifyUsers(tx, to, {
          organizationId,
          siteId: c.siteId,
          kind: `action.${c.kind}`,
          severity,
          title: c.title,
          body: `${kind.label}${c.detail ? `: ${c.detail}` : ""}. ${kind.actionLabel} from the action centre.`,
          entityType: c.entityType,
          entityId: c.entityId,
          link: c.link,
          dedupeKey: `action:${row.id}:open`,
        });
        await tx.update(actionItems).set({ notifiedAt: now }).where(eq(actionItems.id, row.id));
        if (rule.emailOnOpen) emails.push({ userIds: to, subject: `[${severity}] ${c.title}`, text: `${kind.label}: ${c.title}.` });
      }
    }

    // 3. Escalate items left unacknowledged past the rule's delay (once).
    let escalated = 0;
    const stillOpen = await tx.select().from(actionItems).where(and(eq(actionItems.organizationId, organizationId), isNull(actionItems.resolvedAt), isNull(actionItems.acknowledgedAt), eq(actionItems.escalationLevel, 0)));
    for (const item of stillOpen) {
      const rule = ruleFor(rules, item.kind, item.siteId);
      if (!rule?.escalateAfterHours) continue;
      if (now.getTime() - item.detectedAt.getTime() < rule.escalateAfterHours * 3_600_000) continue;
      const to = await recipientsFor(tx, organizationId, rule.escalationRoleCodes as string[], item.siteId);
      await notifyUsers(tx, to, {
        organizationId,
        siteId: item.siteId,
        kind: `action.${item.kind}.escalated`,
        severity: item.severity === "info" ? "warning" : "critical",
        title: `Escalated: ${item.title}`,
        body: `Not acknowledged for more than ${rule.escalateAfterHours} h (rule “${rule.name}”). ${item.actionLabel} from the action centre.`,
        entityType: item.entityType,
        entityId: item.entityId,
        link: item.link,
        dedupeKey: `action:${item.id}:escalated:1`,
      });
      await tx.update(actionItems).set({ escalatedAt: now, escalationLevel: 1 }).where(eq(actionItems.id, item.id));
      await audit(tx, ctx, {
        action: "platform.action_item.escalated",
        entityType: "action_item",
        entityId: item.id,
        entityNumber: item.recordNumber,
        siteId: item.siteId,
        reason: `Unacknowledged for more than ${rule.escalateAfterHours} h`,
        after: { kind: item.kind, ruleId: rule.id, rule: rule.name, escalationRoleCodes: rule.escalationRoleCodes, notified: to.length },
      });
      if (rule.emailOnEscalation) emails.push({ userIds: to, subject: `Escalated: ${item.title}`, text: `Not acknowledged for more than ${rule.escalateAfterHours} hours: ${item.title}.` });
      escalated += 1;
    }
    const [{ n }] = (await tx.execute(sql`select count(*)::int as n from action_items where organization_id = ${organizationId}::uuid and resolved_at is null`)) as unknown as { n: number }[];
    return { skipped: false, opened, resolved, escalated, open: Number(n) };
  });
  // Email after commit; a failed send never rolls back the queue (src/lib/email).
  for (const e of emails) await emailUsers(organizationId, e.userIds, e.subject, e.text);
  return result;
}

/** Whether the caller may see an item: its permission at the item's site (organization-level items: anywhere). */
export function canSeeItem(ctx: AuthContext, item: { siteId: string | null; viewPermission: string }): boolean {
  const p = item.viewPermission as Permission;
  if (item.siteId) return ctx.canAt(p, item.siteId);
  return ctx.can(p);
}

export type ActionItemView = Item & { siteCode: string | null; ageMinutes: number; kindLabel: string };

/** The caller's queue: open items they may act on, newest condition first within severity. */
export async function listActionItems(ctx: AuthContext, f: { tab?: ActionTab; kind?: string; siteId?: string | null; includeAcknowledged?: boolean } = {}, now: Date = new Date()): Promise<ActionItemView[]> {
  if (f.siteId) ctx.requireSite(f.siteId);
  const conds = [eq(actionItems.organizationId, ctx.organizationId), isNull(actionItems.resolvedAt), or(isNull(actionItems.siteId), inArray(actionItems.siteId, ctx.allowedSiteIds))!];
  if (f.tab) conds.push(eq(actionItems.tab, f.tab));
  if (f.kind) conds.push(eq(actionItems.kind, f.kind));
  if (f.siteId) conds.push(eq(actionItems.siteId, f.siteId));
  if (!f.includeAcknowledged) conds.push(isNull(actionItems.acknowledgedAt));
  const rows = await db.select().from(actionItems).where(and(...conds)).orderBy(desc(actionItems.openedAt)).limit(2000);
  const sev = { critical: 0, warning: 1, info: 2 } as Record<string, number>;
  return rows
    .filter((i) => canSeeItem(ctx, i))
    .sort((a, b) => (sev[a.severity] ?? 3) - (sev[b.severity] ?? 3) || b.openedAt.getTime() - a.openedAt.getTime())
    .map((i) => ({
      ...i,
      siteCode: i.siteId ? (ctx.allowedSites.find((s) => s.id === i.siteId)?.code ?? null) : null,
      ageMinutes: Math.max(0, Math.round((now.getTime() - i.openedAt.getTime()) / 60_000)),
      kindLabel: actionKind(i.kind)?.label ?? i.kind,
    }));
}

/** Counts per tab for the header and the bell. */
export async function actionItemCounts(ctx: AuthContext): Promise<{ approvals: number; exceptions: number }> {
  const items = await listActionItems(ctx);
  return { approvals: items.filter((i) => i.tab === "approvals").length, exceptions: items.filter((i) => i.tab === "exceptions").length };
}

/** "I am dealing with it": stops escalation; the item still clears only when its record resolves. Audit platform.action_item.acknowledged. */
export async function acknowledgeActionItem(ctx: AuthContext, id: string, note: string | null) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new DomainError("not_found", "Item not found.");
  const text = note?.trim() || null;
  if (text && text.length > 500) throw new DomainError("validation", "Keep the note under 500 characters.", { field: "note" });
  ctx.assertWritable();
  return db.transaction(async (tx) => {
    const [item] = await tx.select().from(actionItems).where(and(eq(actionItems.id, id), eq(actionItems.organizationId, ctx.organizationId))).for("update").limit(1);
    if (!item || (item.siteId && !ctx.allowedSiteIds.includes(item.siteId)) || !canSeeItem(ctx, item)) throw new DomainError("not_found", "Item not found.");
    if (item.resolvedAt) throw new DomainError("state", "This item is already resolved.");
    if (item.acknowledgedAt) return item;
    const now = new Date();
    const [u] = await tx.update(actionItems).set({ acknowledgedAt: now, acknowledgedBy: ctx.userId, acknowledgementNote: text }).where(eq(actionItems.id, item.id)).returning();
    await tx
      .update(notifications)
      .set({ acknowledgedAt: now, readAt: now })
      .where(and(eq(notifications.recipientUserId, ctx.userId), eq(notifications.entityId, item.entityId), sql`${notifications.kind} like 'action.%'`, isNull(notifications.acknowledgedAt)));
    await audit(tx, ctx, {
      action: "platform.action_item.acknowledged",
      entityType: "action_item",
      entityId: item.id,
      entityNumber: item.recordNumber,
      siteId: item.siteId,
      reason: text,
      after: { kind: item.kind, entityType: item.entityType, entityId: item.entityId },
    });
    return u;
  });
}

/** Resolved and acknowledged history of one record (audit trail view). */
export async function actionItemHistory(ctx: AuthContext, entityId: string) {
  const rows = await db.select().from(actionItems).where(and(eq(actionItems.organizationId, ctx.organizationId), eq(actionItems.entityId, entityId))).orderBy(desc(actionItems.detectedAt)).limit(50);
  return rows.filter((i) => (!i.siteId || ctx.allowedSiteIds.includes(i.siteId)) && canSeeItem(ctx, i));
}

export { ACTION_KINDS };
