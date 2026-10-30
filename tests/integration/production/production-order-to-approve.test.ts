/**
 * Consultant review 2026-10-30 (flow B, silent hand-off): a new production order appears in "To approve"
 * as a decidable row for the people who may approve it at its site, with plain words and a link to the
 * order; never for the planner who created it (separation of duties on), never for another site; the old
 * "Work order to release" row is gone; Approve from the list (the real server action) creates the batch;
 * the approvers are notified once when the order is created.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { actionItems, batches, notifications, products, users, workOrders } from "@/db/schema";
import { AuthContext } from "@/lib/auth/context";
import { createSessionRecord } from "@/lib/auth/session-store";
import { listMyApprovals, myApprovalInbox, refreshActionItems } from "@/modules/action-centre";
import { approveProductionOrder, createProductionOrder, neededByWord } from "@/modules/production";
import { registerAppHooks } from "@/modules/wiring";
import { resetTestDatabase } from "../../support/db";
import { setTestCookies } from "../../support/next-headers";
import { ctxFor, day, expectCode, loadWorld, productId, setOrgSetting, type World } from "./w2a-fixtures";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

let w: World;
let acs: string;
let orderId: string;
let orderNumber: string;
let managerRvs: AuthContext;
/** The planner who created the order, given the approve permission: still refused by separation of duties. */
let plannerWithApprove: AuthContext;

const notificationsOf = (entityId: string) => db.select().from(notifications).where(and(eq(notifications.entityId, entityId), eq(notifications.kind, "production.order.to_approve")));

beforeAll(async () => {
  await resetTestDatabase();
  w = await loadWorld();
  registerAppHooks();
  await setOrgSetting(w.orgId, "governance.owner_override", false);
  acs = await productId("ACS-135");
  managerRvs = await ctxFor(w.orgId, "manager.nfd@bryels-care.test", "site_manager", [w.rvs]);
  const p = w.planner;
  plannerWithApprove = new AuthContext(p.userId, p.organizationId, p.displayName, p.email, p.roleCodes, new Set([...p.permissions, "production.work_order.approve"]), p.allowedSites, p.currentSiteId);
  const r = await createProductionOrder(w.planner, { productId: acs, plannedStart: day(1), neededBy: day(3), idempotencyKey: "to-approve-create-0001" });
  orderId = r.workOrderId;
  orderNumber = r.workOrderNumber;
  await refreshActionItems(w.orgId);
}, 180_000);

afterEach(() => setTestCookies({}));

describe("production orders in To approve", () => {
  it("the site manager can decide it: plain title, link to the production order, one row only", async () => {
    const rows = (await listMyApprovals(w.manager)).filter((r) => r.entityId === orderId);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.kind).toBe("approval.production_order");
    expect(r.canDecide).toBe(true);
    expect(r.link).toBe(`/production/orders/${orderId}`);
    const [product] = await db.select().from(products).where(eq(products.id, acs));
    expect(r.displayTitle.startsWith(`Production order ${orderNumber} · ${product.name} · `)).toBe(true);
    expect(r.displayTitle).toMatch(/ · \d[\d,]* \w+ · needed by /);
    expect(r.displayTitle.endsWith(`needed by ${neededByWord(day(3))}`)).toBe(true);
    expect(r.displayNumber).toBeNull(); // the number is in the title once
    const [planner] = await db.select().from(users).where(eq(users.id, w.planner.userId));
    expect(r.requestedBy.name).toBe(planner.displayName);
    expect((await myApprovalInbox(w.manager)).decidable.some((x) => x.entityId === orderId)).toBe(true);
    // The old "Work order to release" kind is retired: never listed, never detected.
    expect((await listMyApprovals(w.owner)).some((x) => x.kind === "approval.work_order_release")).toBe(false);
    expect(await db.select().from(actionItems).where(and(eq(actionItems.kind, "approval.work_order_release"), eq(actionItems.entityId, orderId)))).toHaveLength(0);
  });

  it("not for the planner who created it: without the approve right not listed; with it, waiting for someone else (SoD)", async () => {
    expect((await listMyApprovals(w.planner)).some((r) => r.entityId === orderId)).toBe(false);
    const r = (await listMyApprovals(plannerWithApprove)).find((x) => x.entityId === orderId);
    expect(r).toBeTruthy();
    expect(r!.canDecide).toBe(false);
    expect(r!.waitingFor).toMatch(/you created this production order/i);
    expect((await myApprovalInbox(plannerWithApprove)).decidable.some((x) => x.entityId === orderId)).toBe(false);
    // The service agrees.
    await expectCode(approveProductionOrder(plannerWithApprove, orderId), "separation_of_duties");
  });

  it("not cross-site: a manager of the other site neither sees nor decides it", async () => {
    expect((await listMyApprovals(managerRvs)).some((r) => r.entityId === orderId)).toBe(false);
    await expectCode(approveProductionOrder(managerRvs, orderId), "not_found");
  });

  it("the approvers at the site are notified once, with the link; the creator and other sites are not", async () => {
    const before = await notificationsOf(orderId);
    const recipients = before.map((n) => n.recipientUserId);
    expect(recipients).toContain(w.manager.userId);
    expect(recipients).not.toContain(w.planner.userId);
    expect(new Set(recipients).size).toBe(recipients.length);
    const mgr = before.find((n) => n.recipientUserId === w.manager.userId)!;
    expect(mgr.link).toBe(`/production/orders/${orderId}`);
    expect(mgr.title).toBe(`Production order ${orderNumber} waits for your approval`);
    // Nobody who only works at the other site.
    const [rvsOnly] = await db.select().from(users).where(eq(users.email, "warehouse.rvs@bryels-care.test"));
    expect(recipients).not.toContain(rvsOnly.id);
    // A retried create (same key) neither makes a second order nor a second notification.
    const again = await createProductionOrder(w.planner, { productId: acs, plannedStart: day(1), neededBy: day(3), idempotencyKey: "to-approve-create-0001" });
    expect(again.workOrderId).toBe(orderId);
    expect(await notificationsOf(orderId)).toHaveLength(before.length);
  });

  it("Approve from the list (the To approve server action) plans, releases and creates the batch; the row leaves", async () => {
    const { decideApprovalAction } = await import("@/app/(app)/approvals/actions");
    const { token } = await createSessionRecord({ userId: w.manager.userId });
    setTestCookies({ bc_session: token });
    const fd = new FormData();
    fd.set("kind", "approval.production_order");
    fd.set("entityId", orderId);
    fd.set("decision", "approve");
    fd.set("idempotencyKey", "0f6c1d2e-6b1c-4a55-9d1e-000000000001");
    const res = await decideApprovalAction({ ok: false, message: "" } as never, fd);
    expect(res, JSON.stringify(res)).toMatchObject({ ok: true });
    expect(res?.message).toMatch(new RegExp(`Production order ${orderNumber} approved`));
    const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, orderId));
    expect(wo.status).toBe("released");
    const bs = await db.select().from(batches).where(eq(batches.workOrderId, orderId));
    expect(bs).toHaveLength(wo.batchCount);
    // The same tap again (same key) is a replay: no second batch.
    const again = await decideApprovalAction({ ok: false, message: "" } as never, fd);
    expect(again).toMatchObject({ ok: true });
    expect(await db.select().from(batches).where(eq(batches.workOrderId, orderId))).toHaveLength(wo.batchCount);
    expect((await listMyApprovals(w.manager)).some((r) => r.entityId === orderId)).toBe(false);
  });
});

describe("neededByWord", () => {
  it("weekday within six days, date after, today and late in plain words", () => {
    const now = new Date("2026-10-30T02:00:00Z"); // Friday 30 Oct 2026, 10:00 in Manila
    expect(neededByWord("2026-10-30", now)).toBe("today");
    expect(neededByWord("2026-11-02", now)).toBe("Mon");
    expect(neededByWord("2026-11-12", now)).toBe("Thu 12 Nov");
    expect(neededByWord("2026-10-28", now)).toBe("Wed 28 Oct (late)");
    expect(neededByWord(null, now)).toBeNull();
  });
});
