import "server-only";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { NOTIFICATION_SEVERITIES, notificationRules, roles } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { ACTION_KINDS, actionKind } from "./kinds";

/**
 * Notification rules and escalation (US-5-07, FR-platform-08). platform.notification_rule.view reads,
 * platform.notification_rule.admin changes (audited `platform.notification_rule.changed`, restricted
 * class in docs/security.md §5). Rules are data seeded with defaults (A-W3B-08) for the owner to confirm.
 */

const ROLE = z.string().regex(/^[a-z_]{2,40}$/);
export const RuleInput = z
  .object({
    itemKind: z.string().refine((k) => !!actionKind(k), "Choose an item kind from the list."),
    siteId: z.uuid().nullable(),
    name: z.string().trim().min(3, "Give the rule a name of at least 3 characters.").max(120),
    severity: z.enum(NOTIFICATION_SEVERITIES),
    ownerRoleCodes: z.array(ROLE).max(10),
    escalateAfterHours: z.number().int().min(1, "Escalate after at least 1 hour.").max(720, "Escalate within 30 days (720 hours).").nullable(),
    escalationRoleCodes: z.array(ROLE).max(10),
    emailOnOpen: z.boolean(),
    emailOnEscalation: z.boolean(),
    isActive: z.boolean(),
  })
  .strict();
export type RuleInput = z.infer<typeof RuleInput>;

function parse(raw: unknown): RuleInput {
  const r = RuleInput.safeParse(raw);
  if (!r.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of r.error.issues) fieldErrors[String(i.path[0] ?? "form")] ??= i.message;
    throw new DomainError("validation", "Check the highlighted fields.", { fieldErrors });
  }
  const v = r.data;
  if ((v.escalateAfterHours === null) !== (v.escalationRoleCodes.length === 0))
    throw new DomainError("validation", "Set both the escalation delay and at least one escalation role, or neither.", { field: "escalateAfterHours" });
  if (v.ownerRoleCodes.length === 0) throw new DomainError("validation", "Choose at least one role to notify.", { field: "ownerRoleCodes" });
  return v;
}

async function assertRoles(organizationId: string, codes: string[], field: string) {
  if (!codes.length) return;
  const found = await db.select({ code: roles.code }).from(roles).where(and(eq(roles.organizationId, organizationId), inArray(roles.code, codes), eq(roles.status, "active")));
  const missing = codes.filter((c) => !found.some((f) => f.code === c));
  if (missing.length) throw new DomainError("validation", `Unknown or inactive roles: ${missing.join(", ")}.`, { field });
}

export async function listNotificationRules(ctx: AuthContext) {
  ctx.require("platform.notification_rule.view");
  const rows = await db
    .select()
    .from(notificationRules)
    .where(and(eq(notificationRules.organizationId, ctx.organizationId), or(isNull(notificationRules.siteId), inArray(notificationRules.siteId, ctx.allowedSiteIds))))
    .orderBy(asc(notificationRules.itemKind), asc(notificationRules.siteId));
  return rows.map((r) => ({ ...r, kindLabel: actionKind(r.itemKind)?.label ?? r.itemKind, tab: actionKind(r.itemKind)?.tab ?? "exceptions" }));
}

const snapshot = (r: typeof notificationRules.$inferSelect) => ({
  itemKind: r.itemKind,
  siteId: r.siteId,
  name: r.name,
  severity: r.severity,
  ownerRoleCodes: r.ownerRoleCodes,
  escalateAfterHours: r.escalateAfterHours,
  escalationRoleCodes: r.escalationRoleCodes,
  emailOnOpen: r.emailOnOpen,
  emailOnEscalation: r.emailOnEscalation,
  isActive: r.isActive,
  version: r.version,
});

/**
 * Creates the rule for (kind, site) or changes it (optimistic concurrency on version when `expectedVersion` is
 * given). Organization rules (site null) need the permission through an organization-wide assignment.
 */
export async function saveNotificationRule(ctx: AuthContext, raw: unknown, opts: { id?: string | null; expectedVersion?: number | null; reason: string }) {
  ctx.require("platform.notification_rule.admin");
  const v = parse(raw);
  const reason = opts.reason.trim();
  if (reason.length < 3) throw new DomainError("validation", "Give a reason of at least 3 characters.", { field: "reason" });
  if (v.siteId) ctx.requireAt("platform.notification_rule.admin", v.siteId);
  else if (!ctx.canOrgWide("platform.notification_rule.admin")) throw new DomainError("forbidden", "Rules for every site need an organization-wide administrator.");
  await assertRoles(ctx.organizationId, v.ownerRoleCodes, "ownerRoleCodes");
  await assertRoles(ctx.organizationId, v.escalationRoleCodes, "escalationRoleCodes");
  return db.transaction(async (tx) => {
    const existing = opts.id
      ? (await tx.select().from(notificationRules).where(and(eq(notificationRules.id, opts.id), eq(notificationRules.organizationId, ctx.organizationId))).for("update").limit(1))[0]
      : (await tx
          .select()
          .from(notificationRules)
          .where(and(eq(notificationRules.organizationId, ctx.organizationId), eq(notificationRules.itemKind, v.itemKind), v.siteId ? eq(notificationRules.siteId, v.siteId) : isNull(notificationRules.siteId)))
          .for("update")
          .limit(1))[0];
    if (opts.id && !existing) throw new DomainError("not_found", "Rule not found.");
    if (existing?.siteId && !ctx.allowedSiteIds.includes(existing.siteId)) throw new DomainError("not_found", "Rule not found.");
    if (existing && opts.expectedVersion != null && existing.version !== opts.expectedVersion) throw new DomainError("conflict", "Someone changed this rule meanwhile. Reload the page and try again.");
    const values = { ...v, updatedBy: ctx.userId, updatedAt: new Date() };
    const [row] = existing
      ? await tx.update(notificationRules).set({ ...values, version: existing.version + 1 }).where(eq(notificationRules.id, existing.id)).returning()
      : await tx.insert(notificationRules).values({ ...values, organizationId: ctx.organizationId, createdBy: ctx.userId }).returning();
    await audit(tx, ctx, {
      action: "platform.notification_rule.changed",
      entityType: "notification_rule",
      entityId: row.id,
      entityNumber: row.itemKind,
      siteId: row.siteId,
      reason,
      before: existing ? snapshot(existing) : null,
      after: snapshot(row),
    });
    return row;
  });
}

/** Active roles of the organization, for the rule form. */
export async function ruleRoleOptions(ctx: AuthContext) {
  ctx.require("platform.notification_rule.view");
  return db.select({ code: roles.code, name: roles.name }).from(roles).where(and(eq(roles.organizationId, ctx.organizationId), eq(roles.status, "active"))).orderBy(asc(roles.name));
}

export { ACTION_KINDS };
