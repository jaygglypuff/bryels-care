/**
 * Round 5 (ADR-129): messages clear when the work is done, and go to the people whose job it is
 * (docs/ux-audit/round5 A report #6 and B10, B report #9 and B9, C report #6, B10 and B15).
 *
 * - Put-away messages go to the site's warehouse people only (not the production operator, the owner or the manager),
 *   and clear for everyone once the lot is on a shelf, whoever put it away.
 * - "Production order waits for your approval" clears for every approver once someone approved it.
 * - The bell count and the open list leave done messages out; the history keeps them, marked resolved.
 * - The clearing never touches another person's or another organisation's messages, and kinds without a rule stay.
 */
import { randomUUID } from "node:crypto";
import { vi, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { goodsReceiptLines, inventoryLots, notifications, organizations, suppliers, users } from "@/db/schema";
import type { AuthContext, SiteRef } from "@/lib/auth/context";
import { ROLE_BUNDLES } from "@/lib/permissions";
import { putAwayLot } from "@/modules/inventory";
import { receiveAndPost } from "@/modules/inventory/receiving";
import { listMyNotifications, notifyUsers, resolveDoneNotifications, unreadNotificationCount } from "@/modules/platform";
import { approveProductionOrder, createProductionOrder } from "@/modules/production";
import { decideLot } from "@/modules/quality/dispositions";
import { registerAppHooks } from "@/modules/wiring";
import { resetTestDatabase } from "../../support/db";
import { ctxFor, future, loadSites, loc, mat } from "../../support/w1b";
import { day, productId, setOrgSetting } from "../production/w2a-fixtures";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

let orgId: string;
let nfd: SiteRef;
let rvs: SiteRef;
let wh: AuthContext;
let wh2: AuthContext;
let qa: AuthContext;
let operator: AuthContext;
let manager: AuthContext;
let owner: AuthContext;
let planner: AuthContext;
let lagunaId: string;

const userId = async (email: string) => (await db.select().from(users).where(eq(users.email, email)))[0].id;
const putAwayNotes = (lotId: string) => db.select().from(notifications).where(and(eq(notifications.entityId, lotId), eq(notifications.kind, "inventory.lot.ready_to_put_away")));

async function receiveLot(ctx: AuthContext, siteId: string, supplierLot: string) {
  const r = await receiveAndPost(ctx, {
    idempotencyKey: randomUUID(),
    supplierId: lagunaId,
    supplierDocumentNumber: `DR-${supplierLot}`,
    lines: [{ materialId: (await mat("MAT-0012")).id, qty: "25", uom: "kg", supplierLotNumber: supplierLot, expiresOn: future(300), locationId: (await loc(siteId, "QUA-01")).id }],
  });
  const [l] = await db.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.goodsReceiptId, r.receiptId));
  const [lot] = await db.select().from(inventoryLots).where(eq(inventoryLots.id, l.lotId!));
  return lot;
}

beforeAll(async () => {
  await resetTestDatabase();
  registerAppHooks();
  ({ orgId, nfd, rvs } = await loadSites());
  wh = await ctxFor(orgId, "warehouse.nfd@bryels-care.test", ROLE_BUNDLES.warehouse_operator.permissions, [nfd]);
  wh2 = await ctxFor(orgId, "warehouse2.nfd@bryels-care.test", ROLE_BUNDLES.warehouse_operator.permissions, [nfd]);
  qa = await ctxFor(orgId, "qa.nfd@bryels-care.test", ROLE_BUNDLES.qa_qc.permissions, [nfd, rvs]);
  operator = await ctxFor(orgId, "operator.nfd@bryels-care.test", ROLE_BUNDLES.production_operator.permissions, [nfd]);
  manager = await ctxFor(orgId, "manager.nfd@bryels-care.test", ROLE_BUNDLES.site_manager.permissions, [nfd]);
  owner = await ctxFor(orgId, "owner@bryels-care.test", ROLE_BUNDLES.owner_director.permissions, [nfd, rvs]);
  planner = await ctxFor(orgId, "planner.nfd@bryels-care.test", ROLE_BUNDLES.production_planner.permissions, [nfd]);
  lagunaId = (await db.select().from(suppliers).where(eq(suppliers.name, "Laguna Oleo Supply")))[0].id;
  await setOrgSetting(orgId, "governance.owner_override", false);
}, 180_000);

describe("put-away goes to the warehouse and clears when the lot is on a shelf", () => {
  it("tells the warehouse people of the site only: not the operator, the owner or the manager", async () => {
    const lot = await receiveLot(wh, nfd.id, "R5-PUT-1");
    await decideLot(qa, { lotId: lot.id, decision: "release", reason: "CoA reviewed, conforms" });
    const to = new Set((await putAwayNotes(lot.id)).map((n) => n.recipientUserId));
    expect(to.has(wh.userId)).toBe(true);
    expect(to.has(wh2.userId)).toBe(true);
    for (const c of [operator, owner, manager, qa]) expect(to.has(c.userId), c.email).toBe(false);
  });

  it("clears for every warehouse person once one of them put it away; the bell drops and history keeps it", async () => {
    const lot = await receiveLot(wh, nfd.id, "R5-PUT-2");
    await decideLot(qa, { lotId: lot.id, decision: "release", reason: "CoA reviewed, conforms" });
    const before = await unreadNotificationCount(wh2);
    expect((await listMyNotifications(wh2)).some((n) => n.entityId === lot.id)).toBe(true);

    await putAwayLot(wh, { lotRef: lot.lotNumber, locationRef: "A-01", idempotencyKey: randomUUID() });

    // Lito put it away; Lito's colleague's message is done too ("no longer theirs").
    expect(await unreadNotificationCount(wh2)).toBe(before - 1);
    expect((await listMyNotifications(wh2)).some((n) => n.entityId === lot.id)).toBe(false);
    const history = (await listMyNotifications(wh2, { show: "all" })).find((n) => n.entityId === lot.id)!;
    expect(history.resolvedAt).not.toBeNull();
    expect(history.readAt).not.toBeNull();
    // Lito's own row is resolved the next time his bell is counted.
    await unreadNotificationCount(wh);
    const [mine] = (await putAwayNotes(lot.id)).filter((n) => n.recipientUserId === wh.userId);
    expect(mine.resolvedAt).not.toBeNull();
  });

  it("a lot still in the QA area keeps its message open", async () => {
    const lot = await receiveLot(wh, nfd.id, "R5-PUT-3");
    await decideLot(qa, { lotId: lot.id, decision: "release", reason: "CoA reviewed, conforms" });
    await unreadNotificationCount(wh);
    expect((await listMyNotifications(wh)).some((n) => n.entityId === lot.id)).toBe(true);
  });
});

describe("approval messages clear once someone decided", () => {
  it("'Production order waits for your approval' clears for the other approvers after the manager approves", async () => {
    const acs = await productId("ACS-135");
    const r = await createProductionOrder(planner, { productId: acs, plannedStart: day(1), neededBy: day(3), idempotencyKey: `r5-clear-${randomUUID()}` });
    const toApprove = await db.select().from(notifications).where(and(eq(notifications.entityId, r.workOrderId), eq(notifications.kind, "production.order.to_approve")));
    expect(toApprove.map((n) => n.recipientUserId)).toEqual(expect.arrayContaining([manager.userId, owner.userId]));
    expect((await listMyNotifications(owner)).some((n) => n.entityId === r.workOrderId)).toBe(true);

    await approveProductionOrder(manager, r.workOrderId);

    expect((await listMyNotifications(owner)).some((n) => n.entityId === r.workOrderId)).toBe(false);
    const [ownerRow] = await db.select().from(notifications).where(and(eq(notifications.entityId, r.workOrderId), eq(notifications.recipientUserId, owner.userId)));
    expect(ownerRow.resolvedAt).not.toBeNull();
  });
});

describe("clearing stays inside its scope", () => {
  it("one person's bell clears only that person's rows; another organisation's rows are never touched", async () => {
    const lot = await receiveLot(wh, nfd.id, "R5-SCOPE-1");
    await decideLot(qa, { lotId: lot.id, decision: "release", reason: "CoA reviewed, conforms" });
    await putAwayLot(wh, { lotRef: lot.lotNumber, locationRef: "A-01", idempotencyKey: randomUUID() });
    // Only wh2's bell runs: wh's row stays unresolved until wh's own bell runs.
    await resolveDoneNotifications(db, { organizationId: orgId, recipientUserId: wh2.userId });
    const rows = await putAwayNotes(lot.id);
    expect(rows.find((n) => n.recipientUserId === wh2.userId)!.resolvedAt).not.toBeNull();
    expect(rows.find((n) => n.recipientUserId === wh.userId)!.resolvedAt).toBeNull();

    // A row of another organisation that points at the same (done) lot: never resolved by this organisation's run.
    const [other] = await db.insert(organizations).values({ name: "Other Co (fictional)" }).returning();
    const [stranger] = await db.insert(users).values({ organizationId: other.id, email: `stranger${Date.now()}@other.test`, displayName: "Stranger (fictional)", passwordHash: "!" }).returning();
    await notifyUsers(db, [stranger.id], { organizationId: other.id, kind: "inventory.lot.ready_to_put_away", severity: "info", title: "x", body: "x", entityType: "inventory_lot", entityId: lot.id, dedupeKey: `r5-other:${lot.id}` });
    await resolveDoneNotifications(db, { organizationId: orgId });
    const [strangerRow] = await db.select().from(notifications).where(eq(notifications.recipientUserId, stranger.id));
    expect(strangerRow.resolvedAt).toBeNull();
  });

  it("messages without a rule (alerts, information) never clear by themselves", async () => {
    await notifyUsers(db, [wh.userId], { organizationId: orgId, siteId: nfd.id, kind: "expiring_lot", severity: "warning", title: "A lot expires soon", body: "x", dedupeKey: `r5-info:${randomUUID()}` });
    await resolveDoneNotifications(db, { organizationId: orgId, recipientUserId: wh.userId });
    const open = await db.select().from(notifications).where(and(eq(notifications.recipientUserId, wh.userId), eq(notifications.kind, "expiring_lot"), isNull(notifications.resolvedAt)));
    expect(open.length).toBeGreaterThan(0);
  });

  it("a deleted record counts as done", async () => {
    const ghost = randomUUID();
    await notifyUsers(db, [manager.userId], { organizationId: orgId, siteId: nfd.id, kind: "production.order.to_approve", severity: "info", title: "Production order waits for your approval", body: "x", entityType: "work_order", entityId: ghost, dedupeKey: `r5-ghost:${ghost}` });
    const done = await resolveDoneNotifications(db, { organizationId: orgId, recipientUserId: manager.userId });
    const [row] = await db.select().from(notifications).where(and(eq(notifications.entityId, ghost), inArray(notifications.recipientUserId, [manager.userId])));
    expect(done).toContain(row.id);
  });
});
