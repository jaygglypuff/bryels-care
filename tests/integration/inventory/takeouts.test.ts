/**
 * ADR-138 "Take a few out": quick stock-outs of finished pieces (online orders, samples, giveaways…), opening a sealed
 * box, several products in one entry, limits with approval, undo by reversal, refusals (other site, no permission,
 * reserved / unreleased / expired / shipping-bay stock), concurrency and idempotency, and "Count what's left".
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { approvalDecisions, containerContents, containers, customers, notifications, products, salesOrders, shelfChecks, stockAdjustments, stockAllocations, stockMovements, stockTakeoutLines, stockTakeouts } from "@/db/schema";
import { AuthContext } from "@/lib/auth/context";
import { ROLE_BUNDLES } from "@/lib/permissions";
import { createBox, setBoxStatus } from "@/modules/inventory/containers";
import { approveAdjustment, postAdjustment } from "@/modules/inventory/adjustments";
import { reverseMovement } from "@/modules/inventory/reversal";
import { approveTakeout, cancelTakeout, createTakeout, rejectTakeout, takeoutApprovalVerdicts, undoTakeout } from "@/modules/inventory/takeouts";
import { getTakeout, listTakeouts, lotTakeouts, customerSamples, takeoutSourcesFor, takeoutSourcesForLabel, watchList } from "@/modules/inventory/takeout-queries";
import { countWhatIsLeft } from "@/modules/inventory/shelf-checks";
import { createOrder } from "@/modules/sales";
import { runTakeoutReminders } from "@/modules/inventory/takeout-reminders";
import { resolveDoneNotifications } from "@/modules/platform/notification-done";
import { resetTestDatabase } from "../../support/db";
import { auditCount, expectDomain, key, loadWorld, loc, makeLot, onHand, type World } from "./w1c-fixtures";

let w: World;
let soap: string;
let lotion: string;
let operator: AuthContext;
beforeAll(async () => {
  await resetTestDatabase();
  w = await loadWorld();
  const [p1] = await db.select().from(products).where(eq(products.skuCode, "ACS-135"));
  const [p2] = await db.select().from(products).where(eq(products.skuCode, "AHL-250"));
  soap = p1.id;
  lotion = p2.id;
  const ctx = w.wh;
  operator = new AuthContext(ctx.userId, ctx.organizationId, "Operator test", "op@test", ["production_operator"], new Set(ROLE_BUNDLES.production_operator.permissions), [w.nfd], w.nfd.id);
});

/** A released product lot at a place, packed into boxes of `perBox` (the last box sealed when asked). */
async function boxedLot(o: { sku: string; qty: string; boxes: string[]; sealed?: boolean; locCode?: string; expiresIn?: number }) {
  const lot = await makeLot(w.owner, { siteId: w.nfd.id, locCode: o.locCode ?? "FG-01", productSku: o.sku, qty: o.qty, expiresIn: o.expiresIn ?? 400 });
  const place = await loc(w.nfd.id, o.locCode ?? "FG-01");
  const ids: string[] = [];
  for (const q of o.boxes) {
    const b = await createBox(w.wh, { lotId: lot.id, locationId: place.id, qty: q, idempotencyKey: key() });
    if (o.sealed) await setBoxStatus(w.wh, b.id, "sealed");
    ids.push(b.id);
  }
  return { lot, place, boxes: ids };
}

const boxRow = async (id: string) => (await db.select().from(containers).where(eq(containers.id, id)))[0];
const inBox = async (id: string, lotId: string) => {
  const [c] = await db.select().from(containerContents).where(and(eq(containerContents.containerId, id), eq(containerContents.lotId, lotId)));
  return c ? String(Number(c.qtyBase)) : "0";
};

describe("take a few out (ADR-138)", () => {
  it("taking 2 pieces from a sealed box opens it, posts one issue movement with the reason, and a double tap does not post twice", async () => {
    const { lot, place, boxes } = await boxedLot({ sku: "ACS-135", qty: "48", boxes: ["24", "24"], sealed: true });
    const k = key();
    const input = { purpose: "sold_online", channel: "shopee", platformOrderRef: "2611-ABC", lines: [{ containerId: boxes[0], pieces: "2" }], idempotencyKey: k };
    const [a, b] = await Promise.all([createTakeout(w.wh, input), createTakeout(w.wh, input)]);
    expect(a.takeoutNumber).toBe(b.takeoutNumber);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    expect(a.status).toBe("posted");
    expect(a.lines[0]).toMatchObject({ pieces: "2", openedBox: true });
    expect(a.sentence).toBe("Sold online · Shopee · order 2611-ABC");
    const mv = await db.select().from(stockMovements).where(eq(stockMovements.sourceDocumentId, a.id));
    expect(mv).toHaveLength(1);
    expect(mv[0]).toMatchObject({ movementType: "issue", fromLocationId: place.id, sourceDocumentType: "stock_takeout" });
    expect(mv[0].reason).toContain("Sold online · Shopee");
    expect(await onHand(lot.id, place.id)).toBe("46");
    expect(await inBox(boxes[0], lot.id)).toBe("22");
    const box = await boxRow(boxes[0]);
    expect(box.status).toBe("open");
    expect(box.isPartial).toBe(true);
    expect((await boxRow(boxes[1])).status).toBe("sealed");
    for (const ev of ["inventory.stock_takeout.created", "inventory.stock_takeout.posted"]) expect(await auditCount(ev, a.id)).toBe(1);
    expect(await auditCount("inventory.container.reopened", boxes[0])).toBe(1);
    // The same key with another body is refused (never a silent second posting).
    await expectDomain(createTakeout(w.wh, { ...input, lines: [{ containerId: boxes[0], pieces: "3" }] }), "validation");
    // The lot's trace shows it.
    expect((await lotTakeouts(w.manager, lot.id)).map((r) => r.sentence)).toContain("Sold online · Shopee · order 2611-ABC");
  });

  it("several products in one entry; a product-only line takes the open box first, then the earliest expiry", async () => {
    const older = await boxedLot({ sku: "AHL-250", qty: "24", boxes: ["24"], sealed: true, expiresIn: 100 });
    const newer = await boxedLot({ sku: "AHL-250", qty: "24", boxes: ["24"], expiresIn: 300 }); // open box (created open)
    const sources = await takeoutSourcesFor(w.wh, lotion);
    expect(sources[0].containerId).toBe(newer.boxes[0]);
    const [cus] = await db.select().from(customers).where(eq(customers.code, "CUS-002"));
    const r = await createTakeout(w.sales, { purpose: "customer_sample", customerId: cus.id, lines: [{ productId: lotion, pieces: "2" }, { productId: soap, pieces: "1" }], idempotencyKey: key() });
    expect(r.status).toBe("posted");
    expect(r.lines.map((l) => l.productName)).toEqual(["Aloe Hand Lotion 250 mL", "Acapulco Soap 135 g"]);
    expect(await inBox(newer.boxes[0], newer.lot.id)).toBe("22");
    expect((await boxRow(older.boxes[0])).status).toBe("sealed");
    expect(r.sentence).toBe("Sample for Isla Spa Supplies");
    expect((await customerSamples(w.manager, cus.id)).length).toBe(2);
    // Sales may record but sees only its own entries' detail; the manager sees all.
    expect((await getTakeout(w.manager, r.id)).lines).toHaveLength(2);
  });

  it("refuses unreleased, expired, materials, the shipping bay, a box set aside for a customer order, and more than is there", async () => {
    const q = await makeLot(w.owner, { siteId: w.nfd.id, locCode: "FG-01", productSku: "GBS-135", qty: "10", status: "quarantine" });
    const fg = await loc(w.nfd.id, "FG-01");
    const base = { purpose: "giveaway", idempotencyKey: "" };
    await expectDomain(createTakeout(w.wh, { ...base, idempotencyKey: key(), lines: [{ lotId: q.id, locationId: fg.id, pieces: "1" }] }), "blocked_lot");
    const exp = await makeLot(w.owner, { siteId: w.nfd.id, locCode: "FG-01", productSku: "GBS-135", qty: "10", expiresIn: -2 });
    await expectDomain(createTakeout(w.wh, { ...base, idempotencyKey: key(), lines: [{ lotId: exp.id, locationId: fg.id, pieces: "1" }] }), "blocked_lot");
    const mat = await makeLot(w.owner, { siteId: w.nfd.id, locCode: "B-01", materialCode: "MAT-0061", qty: "100" });
    await expectDomain(createTakeout(w.wh, { ...base, idempotencyKey: key(), lines: [{ lotId: mat.id, locationId: (await loc(w.nfd.id, "B-01")).id, pieces: "1" }] }), "validation");
    const shp = await makeLot(w.owner, { siteId: w.nfd.id, locCode: "SHP", productSku: "GBS-135", qty: "10" });
    await expectDomain(createTakeout(w.wh, { ...base, idempotencyKey: key(), lines: [{ lotId: shp.id, locationId: (await loc(w.nfd.id, "SHP")).id, pieces: "1" }] }), "validation");
    // A box set aside for an open customer order.
    const set = await boxedLot({ sku: "GBS-135", qty: "24", boxes: ["24"] });
    const [cus] = await db.select().from(customers).where(eq(customers.code, "CUS-001"));
    const so = await createOrder(w.sales, { customerId: cus.id, requestedDeliveryOn: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10), lines: [{ productId: set.lot.productId!, qtyUnits: "24", unitPrice: "70.00" }], idempotencyKey: key() });
    await db.update(salesOrders).set({ status: "allocated" }).where(eq(salesOrders.id, so.id));
    const [line] = await db.execute<{ id: string }>(`select id from sales_order_lines where sales_order_id = '${so.id}'` as never);
    await db.insert(stockAllocations).values({ salesOrderLineId: String(line.id), lotId: set.lot.id, locationId: set.place.id, containerId: set.boxes[0], qtyUnits: "24", status: "open" });
    await expectDomain(createTakeout(w.wh, { ...base, idempotencyKey: key(), lines: [{ containerId: set.boxes[0], pieces: "1" }] }), "conflict");
    expect((await takeoutSourcesForLabel(w.wh, `BC:BOX:${(await boxRow(set.boxes[0])).containerNumber}`)).ok).toBe(false);
    // More than the box holds; fractions; other without a note; online without a shop; a shop not on the list.
    const b = await boxedLot({ sku: "GBS-135", qty: "5", boxes: ["5"] });
    await expectDomain(createTakeout(w.wh, { ...base, idempotencyKey: key(), lines: [{ containerId: b.boxes[0], pieces: "6" }] }), "insufficient_stock");
    await expectDomain(createTakeout(w.wh, { ...base, idempotencyKey: key(), lines: [{ containerId: b.boxes[0], pieces: "1.5" }] }), "validation");
    await expectDomain(createTakeout(w.wh, { purpose: "other", idempotencyKey: key(), lines: [{ containerId: b.boxes[0], pieces: "1" }] }), "validation");
    await expectDomain(createTakeout(w.wh, { purpose: "sold_online", idempotencyKey: key(), lines: [{ containerId: b.boxes[0], pieces: "1" }] }), "validation");
    await expectDomain(createTakeout(w.wh, { purpose: "sold_online", channel: "ebay", idempotencyKey: key(), lines: [{ containerId: b.boxes[0], pieces: "1" }] }), "validation");
    expect(await inBox(b.boxes[0], b.lot.id)).toBe("5");
  });

  it("another site and roles without the permission are refused (server side)", async () => {
    const { boxes, lot } = await boxedLot({ sku: "ACS-135", qty: "10", boxes: ["10"] });
    await expectDomain(createTakeout(w.whRvs, { purpose: "giveaway", idempotencyKey: key(), lines: [{ containerId: boxes[0], pieces: "1" }] }), "not_found");
    await expectDomain(createTakeout(operator, { purpose: "giveaway", idempotencyKey: key(), lines: [{ containerId: boxes[0], pieces: "1" }] }), "forbidden");
    await expectDomain(createTakeout(w.auditor, { purpose: "giveaway", idempotencyKey: key(), lines: [{ containerId: boxes[0], pieces: "1" }] }), "forbidden");
    const r = await createTakeout(w.wh, { purpose: "display", idempotencyKey: key(), lines: [{ containerId: boxes[0], pieces: "1" }] });
    await expectDomain(getTakeout(w.whRvs, r.id), "not_found");
    await expectDomain(undoTakeout(w.whRvs, r.id, "wrong box"), "not_found");
    await expectDomain(listTakeouts(operator), "forbidden");
    expect(await inBox(boxes[0], lot.id)).toBe("9");
  });

  it("above the line limit it waits for an OK; nothing moves; not by the requester; the manager's OK posts it", async () => {
    const { boxes, lot, place } = await boxedLot({ sku: "ACS-135", qty: "24", boxes: ["24"], sealed: true });
    const r = await createTakeout(w.wh, { purpose: "giveaway", idempotencyKey: key(), lines: [{ containerId: boxes[0], pieces: "12" }] });
    expect(r.status).toBe("awaiting_approval");
    expect(r.approvalReason).toMatch(/12 pieces of one product/);
    expect(await onHand(lot.id, place.id)).toBe("24");
    expect((await boxRow(boxes[0])).status).toBe("sealed");
    expect(await db.select().from(notifications).where(and(eq(notifications.entityId, r.id), eq(notifications.recipientUserId, w.manager.userId)))).toHaveLength(1);
    await expectDomain(approveTakeout(w.wh, r.id), "forbidden");
    const self = await createTakeout(w.manager, { purpose: "giveaway", idempotencyKey: key(), lines: [{ containerId: boxes[0], pieces: "11" }] });
    await expectDomain(approveTakeout(w.manager, self.id), "separation_of_duties");
    await cancelTakeout(w.manager, self.id, "asked by mistake");
    const verdict = (await takeoutApprovalVerdicts(w.manager, [r.id])).get(r.id)!;
    expect(verdict.canDecide).toBe(true);
    const ok = await approveTakeout(w.manager, r.id, "Raffle at the fair");
    expect(ok.status).toBe("posted");
    expect(await onHand(lot.id, place.id)).toBe("12");
    expect((await boxRow(boxes[0])).status).toBe("open");
    expect(await db.select().from(approvalDecisions).where(eq(approvalDecisions.recordId, r.id))).toHaveLength(1);
    await expectDomain(approveTakeout(w.manager, r.id), "state");
    // Say no: a reason is needed; nothing moves.
    const no = await createTakeout(w.wh, { purpose: "staff_use", idempotencyKey: key(), lines: [{ containerId: boxes[0], pieces: "11" }] });
    await expectDomain(rejectTakeout(w.manager, no.id, ""), "validation");
    await rejectTakeout(w.manager, no.id, "Too many for staff");
    expect(await onHand(lot.id, place.id)).toBe("12");
  });

  it("the day limit counts the person's take-outs of the day (undone ones not)", async () => {
    const { boxes } = await boxedLot({ sku: "GBS-135", qty: "48", boxes: ["48"] });
    const done: string[] = [];
    // wh2 starts the day at 0 pieces.
    for (let i = 0; i < 3; i++) done.push((await createTakeout(w.wh2, { purpose: "display", idempotencyKey: key(), lines: [{ containerId: boxes[0], pieces: "10" }] })).id);
    const over = await createTakeout(w.wh2, { purpose: "display", idempotencyKey: key(), lines: [{ containerId: boxes[0], pieces: "1" }] });
    expect(over.status).toBe("awaiting_approval");
    expect(over.approvalReason).toMatch(/31 pieces by you today/);
    await cancelTakeout(w.wh2, over.id, "will undo first");
    await undoTakeout(w.wh2, done[0], "counted wrong");
    expect((await createTakeout(w.wh2, { purpose: "display", idempotencyKey: key(), lines: [{ containerId: boxes[0], pieces: "1" }] })).status).toBe("posted");
  });

  it("undo: the person the same day or a manager any time; reversal movements; pieces go back into the box; never twice; never through Fix a mistake", async () => {
    const { boxes, lot, place } = await boxedLot({ sku: "ACS-135", qty: "3", boxes: ["3"], sealed: true });
    const r = await createTakeout(w.wh, { purpose: "staff_use", idempotencyKey: key(), lines: [{ containerId: boxes[0], pieces: "3" }] });
    expect((await boxRow(boxes[0])).status).toBe("empty");
    const [mv] = await db.select().from(stockMovements).where(eq(stockMovements.sourceDocumentId, r.id));
    await expectDomain(reverseMovement(w.manager, { movementId: mv.id, reason: "wrong", confirmation: "REVERSE", idempotencyKey: key() }), "state");
    await expectDomain(undoTakeout(w.wh2, r.id, "not mine"), "forbidden");
    await expectDomain(undoTakeout(w.wh, r.id, "x"), "validation");
    await expectDomain(undoTakeout(w.wh, r.id, "too late", { now: new Date(Date.now() + 2 * 86_400_000) }), "forbidden");
    await undoTakeout(w.wh, r.id, "Wrong product scanned");
    expect(await onHand(lot.id, place.id)).toBe("3");
    expect(await inBox(boxes[0], lot.id)).toBe("3");
    expect((await boxRow(boxes[0])).status).toBe("open");
    const rev = await db.select().from(stockMovements).where(and(eq(stockMovements.sourceDocumentId, r.id), eq(stockMovements.movementType, "reversal")));
    expect(rev).toHaveLength(1);
    expect(rev[0].reversalOfId).toBe(mv.id);
    const [t] = await db.select().from(stockTakeouts).where(eq(stockTakeouts.id, r.id));
    expect(t).toMatchObject({ status: "reversed", reverseReason: "Wrong product scanned" });
    await expectDomain(undoTakeout(w.manager, r.id, "again"), "state");
    // A manager (void) may undo another person's take-out later.
    const r2 = await createTakeout(w.wh, { purpose: "staff_use", idempotencyKey: key(), lines: [{ containerId: boxes[0], pieces: "1" }] });
    await undoTakeout(w.manager, r2.id, "Returned to the box", { now: new Date(Date.now() + 5 * 86_400_000) });
    expect(await auditCount("inventory.stock_takeout.reversed", r2.id)).toBe(1);
  });

  it("concurrent take-outs from one box never take more than it holds", async () => {
    const { boxes, lot, place } = await boxedLot({ sku: "GBS-135", qty: "3", boxes: ["3"] });
    const res = await Promise.allSettled([1, 2, 3].map(() => createTakeout(w.manager, { purpose: "display", idempotencyKey: key(), lines: [{ containerId: boxes[0], pieces: "2" }] })));
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await onHand(lot.id, place.id)).toBe("1");
    expect(await inBox(boxes[0], lot.id)).toBe("1");
  });

  it("the Taken out list sums posted pieces by product, reason and person, at the viewer's site only", async () => {
    const l = await listTakeouts(w.manager, {});
    expect(l.entries.length).toBeGreaterThan(3);
    expect(Number(l.totals.pieces)).toBeGreaterThan(0);
    expect(l.totals.byReason.some((t) => t.label === "Sold online · Shopee")).toBe(true);
    expect(l.totals.byPerson.some((t) => t.label === w.wh.displayName)).toBe(true);
    const rvs = await listTakeouts(w.whRvs, {});
    expect(rvs.entries).toHaveLength(0);
  });
});

describe("count what's left (ADR-138 §3)", () => {
  it("the same number is a check; a difference needs a reason and becomes a stock fix through the existing approval", async () => {
    const { boxes, lot, place } = await boxedLot({ sku: "AHL-250", qty: "24", boxes: ["24"] });
    const ok = await countWhatIsLeft(w.sales, { containerId: boxes[0], counted: "24", idempotencyKey: key() });
    expect(ok).toMatchObject({ difference: "0", adjustmentId: null });
    // Sales may not fix stock: a difference is refused with plain words.
    await expectDomain(countWhatIsLeft(w.sales, { containerId: boxes[0], counted: "22", reasonCode: "unrecorded_takeout", idempotencyKey: key() }), "forbidden");
    await expectDomain(countWhatIsLeft(w.wh, { containerId: boxes[0], counted: "22", idempotencyKey: key() }), "validation");
    await expectDomain(countWhatIsLeft(w.wh, { containerId: boxes[0], counted: "21.5", reasonCode: "unrecorded_takeout", idempotencyKey: key() }), "validation");
    const k = key();
    const diff = await countWhatIsLeft(w.wh, { containerId: boxes[0], counted: "22", reasonCode: "unrecorded_takeout", note: "Two Lazada orders yesterday", idempotencyKey: k });
    expect(diff).toMatchObject({ expected: "24", counted: "22", difference: "-2" });
    expect((await countWhatIsLeft(w.wh, { containerId: boxes[0], counted: "22", reasonCode: "unrecorded_takeout", note: "Two Lazada orders yesterday", idempotencyKey: k })).replayed).toBe(true);
    const [adj] = await db.select().from(stockAdjustments).where(eq(stockAdjustments.id, diff.adjustmentId!));
    expect(adj).toMatchObject({ status: "submitted", reasonCode: "unrecorded_takeout" });
    // Nothing changed yet; the manager approves, then it is saved to stock.
    expect(await inBox(boxes[0], lot.id)).toBe("24");
    await approveAdjustment(w.manager, adj.id);
    await postAdjustment(w.manager, adj.id, key());
    expect(await inBox(boxes[0], lot.id)).toBe("22");
    expect(await onHand(lot.id, place.id)).toBe("22");
    expect(await db.select().from(shelfChecks).where(eq(shelfChecks.containerId, boxes[0]))).toHaveLength(2);
    await expectDomain(countWhatIsLeft(w.whRvs, { containerId: boxes[0], counted: "22", idempotencyKey: key() }), "not_found");
  });

  it("the watch list marks open boxes with no take-out or count for the set number of days", async () => {
    const { boxes } = await boxedLot({ sku: "GBS-135", qty: "12", boxes: ["12"] });
    const old = new Date(Date.now() - 5 * 86_400_000);
    await db.update(containers).set({ updatedAt: old }).where(eq(containers.id, boxes[0]));
    const rows = await watchList(db, w.orgId, [w.nfd.id]);
    const mine = rows.find((r) => r.containerId === boxes[0])!;
    expect(mine.stale).toBe(true);
    expect(mine.days).toBeGreaterThanOrEqual(5);
    await countWhatIsLeft(w.wh, { containerId: boxes[0], counted: "12", idempotencyKey: key() });
    expect((await watchList(db, w.orgId, [w.nfd.id])).find((r) => r.containerId === boxes[0])!.stale).toBe(false);
    expect(await db.select().from(stockTakeoutLines).where(eq(stockTakeoutLines.containerId, boxes[0]))).toHaveLength(0);
  });

  it("reminders: a quiet open box messages the warehouse once; counting it clears the message; the weekly nudge goes out on its day", async () => {
    const { boxes } = await boxedLot({ sku: "GBS-135", qty: "6", boxes: ["6"] });
    await db.update(containers).set({ updatedAt: new Date(Date.now() - 4 * 86_400_000) }).where(eq(containers.id, boxes[0]));
    const first = await runTakeoutReminders({ organizationId: w.orgId });
    expect(first.stale).toBeGreaterThan(0);
    const mine = () => db.select().from(notifications).where(and(eq(notifications.kind, "inventory.takeout.count_open_box"), eq(notifications.entityId, boxes[0])));
    const msgs = await mine();
    expect(msgs.map((m) => m.recipientUserId)).toContain(w.wh.userId);
    expect(msgs.map((m) => m.recipientUserId)).not.toContain(w.whRvs.userId);
    await runTakeoutReminders({ organizationId: w.orgId });
    expect(await mine()).toHaveLength(msgs.length);
    await resolveDoneNotifications(db, { organizationId: w.orgId });
    expect((await mine()).every((m) => m.resolvedAt === null)).toBe(true);
    await countWhatIsLeft(w.wh, { containerId: boxes[0], counted: "6", idempotencyKey: key() });
    await resolveDoneNotifications(db, { organizationId: w.orgId });
    expect((await mine()).every((m) => m.resolvedAt !== null)).toBe(true);
    // Weekly nudge on Monday 2026-11-23 (default day 1), once per site and day.
    const monday = new Date("2026-11-23T01:00:00Z");
    const a = await runTakeoutReminders({ organizationId: w.orgId, now: monday });
    const b = await runTakeoutReminders({ organizationId: w.orgId, now: monday });
    expect(a.weekly).toBeGreaterThan(0);
    expect(b.weekly).toBe(0);
    expect((await runTakeoutReminders({ organizationId: w.orgId, now: new Date("2026-11-24T01:00:00Z") })).weekly).toBe(0);
  });
});
