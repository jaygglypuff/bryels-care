/**
 * US-5-06 action centre and US-5-07 notification rules with escalation (FR-platform-07/08):
 * items open from the underlying records and clear when the record resolves, acknowledgement and
 * escalation are audited, visibility follows the permission at the item's site (cross-site and
 * role negatives), rule administration needs platform.notification_rule.admin.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { actionItems, auditEvents, backgroundJobs, notifications, qualityHolds, users, workOrders } from "@/db/schema";
import { type AuthContext, buildContextForUser } from "@/lib/auth/context";
import { acknowledgeActionItem, listActionItems, listNotificationRules, refreshActionItems, registerActionItemSource, saveNotificationRule } from "@/modules/action-centre";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, type Kit, loadKit, loc, makeLot } from "../../support/kit";

let kit: Kit;
const ids: Record<string, string> = {};
let qa: AuthContext;
let admin: AuthContext;
let owner: AuthContext;
let manager: AuthContext;
let whRvs: AuthContext;
let sales: AuthContext;

const ctxOf = async (email: string) => (await buildContextForUser((await db.select({ id: users.id }).from(users).where(eq(users.email, email)))[0].id))!;

async function openHold(siteId: string, lotId: string) {
  const [h] = await db
    .insert(qualityHolds)
    .values({ organizationId: kit.orgId, siteId, holdNumber: `H-T-${randomUUID().slice(0, 8)}`, lotId, reasonCode: "suspected_contamination", reason: "Test hold (fictional)", openedBy: ids.qa, statusChangedBy: ids.qa })
    .returning();
  return h;
}

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  qa = await ctxOf("qa.nfd@bryels-care.test");
  admin = await ctxOf("admin@bryels-care.test");
  owner = await ctxOf("owner@bryels-care.test");
  manager = await ctxOf("manager.nfd@bryels-care.test");
  // RVS only (the W2E seed also gives this user a temporary NFD cover assignment)
  whRvs = await asUser(kit, "warehouse.rvs@bryels-care.test", "warehouse_operator", [kit.rvs]);
  sales = await ctxOf("sales@bryels-care.test");
  ids.qa = qa.userId;
  ids.owner = owner.userId;
  ids.manager = manager.userId;
});

describe("action centre queue (US-5-06)", () => {
  it("opens items from the records; visibility follows the permission at the item's site", async () => {
    const r = await refreshActionItems(kit.orgId);
    expect(r.skipped).toBe(false);
    expect(r.opened).toBeGreaterThan(0);
    const qaItems = await listActionItems(qa, { tab: "exceptions" });
    const dev = qaItems.find((i) => i.kind === "open_deviation" && i.siteCode === "NFD");
    expect(dev).toBeTruthy();
    expect(dev!.link).toMatch(/^\/quality\/deviations\//);
    expect(dev!.actionLabel).toBe("Open deviation");
    expect(dev!.recordNumber).toBeTruthy();
    // cross-site: an RVS user never sees NFD items, even with the permission
    expect((await listActionItems(whRvs)).some((i) => i.siteId === kit.nfd.id)).toBe(false);
    // role: sales has no quality.deviation.view
    expect((await listActionItems(sales)).some((i) => i.kind === "open_deviation")).toBe(false);
    // approvals go to the approvers only: QA sees batch decisions, the warehouse does not
    const wh = await ctxOf("warehouse.nfd@bryels-care.test");
    expect((await listActionItems(wh, { tab: "approvals" })).some((i) => i.kind === "approval.batch_disposition")).toBe(false);
    // a second refresh with nothing changed opens nothing
    expect((await refreshActionItems(kit.orgId)).opened).toBe(0);
  });

  it("items clear when the underlying record resolves (resolved_at, note, audit, related notifications)", async () => {
    const lot = await makeLot(qa, kit.nfd.id, (await loc(kit.nfd.id, "A-01")).id, "10");
    const hold = await openHold(kit.nfd.id, lot.id);
    await refreshActionItems(kit.orgId);
    const [item] = await db.select().from(actionItems).where(and(eq(actionItems.entityId, hold.id), isNull(actionItems.resolvedAt)));
    expect(item).toMatchObject({ kind: "open_hold", tab: "exceptions", siteId: kit.nfd.id, recordNumber: hold.holdNumber });
    await db.insert(notifications).values({ organizationId: kit.orgId, recipientUserId: ids.qa, kind: "action.open_hold", title: "t", body: "b", entityType: "quality_hold", entityId: hold.id });
    await db
      .update(qualityHolds)
      .set({ status: "closed", resolution: "released", closeReason: "Retest passed", closedBy: ids.manager, closedAt: new Date(), statusChangedBy: ids.manager })
      .where(eq(qualityHolds.id, hold.id));
    const r = await refreshActionItems(kit.orgId);
    expect(r.resolved).toBeGreaterThanOrEqual(1);
    const [after] = await db.select().from(actionItems).where(eq(actionItems.id, item.id));
    expect(after.resolvedAt).not.toBeNull();
    expect(after.resolutionNote).toContain("no longer needs this action");
    const [ev] = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "platform.action_item.resolved"), eq(auditEvents.entityId, item.id)));
    expect(ev.actorLabel).toBe("system:platform.action_centre_sweep");
    const [n] = await db.select().from(notifications).where(and(eq(notifications.entityId, hold.id), eq(notifications.kind, "action.open_hold")));
    expect(n.resolvedAt).not.toBeNull();
    expect((await listActionItems(qa)).some((i) => i.id === item.id)).toBe(false);
  });

  it("late work orders and failed jobs are detected; failed jobs show to job viewers only", async () => {
    const [wo] = await db.select().from(workOrders).where(and(eq(workOrders.siteId, kit.nfd.id), eq(workOrders.status, "planned"))).limit(1);
    await db.update(workOrders).set({ plannedStart: "2026-01-01", plannedEnd: "2026-01-05" }).where(eq(workOrders.id, wo.id));
    const [job] = await db.insert(backgroundJobs).values({ organizationId: kit.orgId, jobKind: "inventory.reconcile", status: "failed", payload: {}, idempotencyKey: `t:${randomUUID()}`, correlationId: "c", errorMessage: "boom", finishedAt: new Date(), deadLetteredAt: new Date() }).returning();
    await refreshActionItems(kit.orgId);
    const mgr = await listActionItems(manager);
    expect(mgr.find((i) => i.kind === "late_work_order" && i.entityId === wo.id)?.title).toMatch(/day\(s\) late/);
    expect(mgr.find((i) => i.kind === "approval.production_order" && i.entityId === wo.id)).toBeTruthy();
    expect((await listActionItems(admin)).some((i) => i.kind === "failed_job" && i.entityId === job.id)).toBe(true);
    expect((await listActionItems(sales)).some((i) => i.kind === "failed_job")).toBe(false);
    // the job is cancelled → the item clears
    await db.update(backgroundJobs).set({ status: "cancelled" }).where(eq(backgroundJobs.id, job.id));
    await refreshActionItems(kit.orgId);
    expect((await listActionItems(admin)).some((i) => i.entityId === job.id)).toBe(false);
  });

  it("acknowledgement is audited, hides the item from the open list and is refused to users who cannot see it", async () => {
    const item = (await listActionItems(qa)).find((i) => i.kind === "open_deviation")!;
    await expectCode(acknowledgeActionItem(sales, item.id, null), "not_found");
    await expectCode(acknowledgeActionItem(whRvs, item.id, null), "not_found");
    await acknowledgeActionItem(qa, item.id, "Investigating with production (demo)");
    const [ev] = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "platform.action_item.acknowledged"), eq(auditEvents.entityId, item.id)));
    expect(ev).toMatchObject({ actorId: ids.qa, reason: "Investigating with production (demo)" });
    expect((await listActionItems(qa)).some((i) => i.id === item.id)).toBe(false);
    expect((await listActionItems(qa, { includeAcknowledged: true })).some((i) => i.id === item.id)).toBe(true);
  });

  it("other modules plug in a source (W3C failed imports); its items open and clear like the built-in ones", async () => {
    let failing = true;
    const entityId = randomUUID();
    registerActionItemSource({
      kind: "failed_import",
      detect: async () => (failing ? [{ kind: "failed_import", siteId: kit.nfd.id, entityType: "import_job", entityId, recordNumber: "IMP-26-00001", title: "Import IMP-26-00001 failed", detail: "3 rows rejected", link: "/admin/imports/x", openedAt: new Date() }] : []),
    });
    await refreshActionItems(kit.orgId);
    expect((await listActionItems(admin)).some((i) => i.entityId === entityId && i.kind === "failed_import")).toBe(true);
    failing = false;
    await refreshActionItems(kit.orgId);
    expect((await listActionItems(admin)).some((i) => i.entityId === entityId)).toBe(false);
    expect(() => registerActionItemSource({ kind: "nope", detect: async () => [] })).toThrow(/Unknown action-centre kind/);
  });
});

describe("notification rules and escalation (US-5-07)", () => {
  it("only platform.notification_rule.admin changes rules; validation; audited as platform.notification_rule.changed", async () => {
    const rule = { itemKind: "open_hold", siteId: null, name: "Open holds to QA, escalate to the owner", severity: "warning", ownerRoleCodes: ["qa_qc"], escalateAfterHours: 2, escalationRoleCodes: ["owner_director"], emailOnOpen: false, emailOnEscalation: true, isActive: true };
    await expectCode(saveNotificationRule(manager, rule, { reason: "test" }), "forbidden");
    await expectCode(saveNotificationRule(owner, rule, { reason: "test" }), "forbidden");
    await expectCode(saveNotificationRule(admin, { ...rule, escalationRoleCodes: [] }, { reason: "test" }), "validation");
    await expectCode(saveNotificationRule(admin, { ...rule, ownerRoleCodes: ["ghost_role"] }, { reason: "test" }), "validation");
    await expectCode(saveNotificationRule(admin, { ...rule, itemKind: "made_up" }, { reason: "test" }), "validation");
    const seeded = (await listNotificationRules(admin)).find((r) => r.itemKind === "open_hold" && r.siteId === null)!; // W3B seed default
    const saved = await saveNotificationRule(admin, rule, { reason: "Owner asked to hear about holds older than 2 h (demo)", expectedVersion: seeded.version });
    expect(saved.version).toBe(seeded.version + 1);
    const changed = await saveNotificationRule(admin, { ...rule, escalateAfterHours: 3 }, { reason: "Give QA a little longer", expectedVersion: saved.version });
    expect(changed.version).toBe(saved.version + 1);
    await expectCode(saveNotificationRule(admin, rule, { reason: "stale", expectedVersion: saved.version }), "conflict");
    const evs = await db.select().from(auditEvents).where(eq(auditEvents.action, "platform.notification_rule.changed"));
    expect(evs.at(-1)!.before).toMatchObject({ escalateAfterHours: 2, version: saved.version });
    expect(evs.at(-1)!.after).toMatchObject({ escalateAfterHours: 3, version: changed.version });
    expect((await listNotificationRules(manager)).some((r) => r.id === saved.id)).toBe(true); // site managers read rules
    await expectCode(listNotificationRules(sales), "forbidden");
  });

  it("an item unacknowledged past the delay escalates once to the configured role; acknowledged items do not", async () => {
    const t0 = new Date();
    const lotA = await makeLot(qa, kit.nfd.id, (await loc(kit.nfd.id, "A-02")).id, "5");
    const lotB = await makeLot(qa, kit.nfd.id, (await loc(kit.nfd.id, "A-02")).id, "5");
    const holdA = await openHold(kit.nfd.id, lotA.id);
    const holdB = await openHold(kit.nfd.id, lotB.id);
    await refreshActionItems(kit.orgId, t0);
    const opened = await db.select().from(notifications).where(and(eq(notifications.kind, "action.open_hold"), eq(notifications.entityId, holdA.id)));
    expect(opened.map((n) => n.recipientUserId)).toContain(ids.qa);
    const itemB = (await listActionItems(qa)).find((i) => i.entityId === holdB.id)!;
    await acknowledgeActionItem(qa, itemB.id, "On it");

    const t1 = new Date(t0.getTime() + 2 * 3_600_000); // before the 3 h delay
    expect((await refreshActionItems(kit.orgId, t1)).escalated).toBe(0);
    const t2 = new Date(t0.getTime() + 3.5 * 3_600_000);
    const r = await refreshActionItems(kit.orgId, t2);
    expect(r.escalated).toBe(1);
    const esc = await db.select().from(notifications).where(and(eq(notifications.kind, "action.open_hold.escalated"), eq(notifications.entityId, holdA.id)));
    expect(esc.map((n) => n.recipientUserId)).toEqual([ids.owner]);
    expect(esc[0].severity).toBe("critical");
    const [item] = await db.select().from(actionItems).where(and(eq(actionItems.entityId, holdA.id), isNull(actionItems.resolvedAt)));
    expect(item.escalationLevel).toBe(1);
    const [ev] = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "platform.action_item.escalated"), eq(auditEvents.entityId, item.id)));
    expect(ev.reason).toContain("3 h");
    expect((await refreshActionItems(kit.orgId, new Date(t0.getTime() + 8 * 3_600_000))).escalated).toBe(0);
    expect((await db.select().from(notifications).where(and(eq(notifications.kind, "action.open_hold.escalated"), eq(notifications.entityId, holdB.id))))).toHaveLength(0);
  });
});

describe("users without any rule-free access", () => {
  it("asUser contexts without access detail still filter by permission", async () => {
    const op = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.nfd]);
    expect((await listActionItems(op)).every((i) => op.can(i.viewPermission as never))).toBe(true);
  });
});
