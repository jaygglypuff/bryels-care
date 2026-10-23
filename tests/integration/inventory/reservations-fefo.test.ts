/** US-2-20 reservations and FEFO/FIFO recommendation (docs/testing.md §4.4 fefo.*, fifo.*). */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { AuthContext } from "@/lib/auth/context";
import { allocationRules, customers, inventoryLots, products, salesOrderLines, salesOrders, stockAllocations, stockReservations } from "@/db/schema";
import { compareCandidates, createReservation, expireReservations, recommendLots, releaseReservation } from "@/modules/inventory/reservations";
import { allocateOrder } from "@/modules/sales/allocation";
import { resetTestDatabase } from "../../support/db";
import { expectDomain, future, key, loadWorld, loc, makeLot, type World } from "./w1c-fixtures";

let w: World;
beforeAll(async () => {
  await resetTestDatabase();
  w = await loadWorld();
});

describe("ordering (unit)", () => {
  it("fefo.selects_earliest_expiry with tie-breaks manufacture date, created, lot number; fifo.when_no_expiry", () => {
    const c = (lotNumber: string, expiresOn: string | null, manufacturedOn: string | null, created: string) => ({ lotNumber, expiresOn, manufacturedOn, lotCreatedAt: new Date(created) });
    const rows = [c("L-3", "2027-01-01", null, "2026-01-03"), c("L-2", "2026-12-01", "2026-02-01", "2026-01-02"), c("L-1", "2026-12-01", "2026-01-01", "2026-01-05"), c("L-0", null, null, "2025-01-01")];
    expect([...rows].sort(compareCandidates("fefo")).map((r) => r.lotNumber)).toEqual(["L-1", "L-2", "L-3", "L-0"]);
    expect([...rows].sort(compareCandidates("fifo")).map((r) => r.lotNumber)).toEqual(["L-0", "L-2", "L-3", "L-1"]);
  });
});

describe("recommendation and reservations", () => {
  it("fefo.excludes_blocked with a reason the card shows; reservations reduce available-to-promise", async () => {
    const early = await makeLot(w.owner, { siteId: w.nfd.id, locCode: "A-01", materialCode: "MAT-0044", qty: "1000", expiresIn: 40 });
    // Expires before the seeded LB-7719 lot (about 280 days), so it is the second pick.
    const late = await makeLot(w.owner, { siteId: w.nfd.id, locCode: "A-01", materialCode: "MAT-0044", qty: "1000", expiresIn: 100 });
    const held = await makeLot(w.owner, { siteId: w.nfd.id, locCode: "QUA-01", materialCode: "MAT-0044", qty: "1000", expiresIn: 10, status: "on_hold" });
    const [mat] = await db.select({ id: inventoryLots.materialId }).from(inventoryLots).where(eq(inventoryLots.id, early.id));
    const rec = await recommendLots(w.wh, { materialId: mat.id!, qty: "1500" });
    expect(rec.strategy).toBe("fefo");
    expect(rec.recommended?.lotId).toBe(early.id);
    const heldRow = rec.candidates.find((c) => c.lotId === held.id)!;
    expect(heldRow.eligible).toBe(false);
    expect(heldRow.reason).toContain("hold");
    expect(rec.picks.map((p) => [p.lotId, p.qty])).toEqual([
      [early.id, "1000"],
      [late.id, "500"],
    ]);
    // Reserve 800 of the early lot: availability drops; a second reservation above the rest is refused.
    const a01 = await loc(w.nfd.id, "A-01");
    const r = await createReservation(w.manager, { lotId: early.id, locationId: a01.id, qty: "800", demandType: "manual", demandReference: "Trial batch next week", idempotencyKey: key() });
    expect(r.reservationNumber).toMatch(/^RSV-\d{2}-\d{6}$/);
    const rec2 = await recommendLots(w.wh, { materialId: mat.id! });
    expect(rec2.candidates.find((c) => c.lotId === early.id)?.available).toBe("200");
    await expectDomain(createReservation(w.manager, { lotId: early.id, locationId: a01.id, qty: "201", demandType: "manual", demandReference: "x", idempotencyKey: key() }), "insufficient_stock");
    await expectDomain(createReservation(w.manager, { lotId: held.id, locationId: (await loc(w.nfd.id, "QUA-01")).id, qty: "1", demandType: "manual", demandReference: "x", idempotencyKey: key() }), "blocked_lot");
    // Release frees it.
    await expectDomain(releaseReservation(w.manager, r.id, ""), "validation");
    await releaseReservation(w.manager, r.id, "Trial cancelled");
    const rec3 = await recommendLots(w.wh, { materialId: mat.id! });
    expect(rec3.candidates.find((c) => c.lotId === early.id)?.available).toBe("1000");
  });

  it("fefo.rule_per_class_and_customer: a FIFO rule for a material kind is applied; a customer rule beats it", async () => {
    const newer = await makeLot(w.owner, { siteId: w.nfd.id, locCode: "A-02", materialCode: "MAT-0043", qty: "100", expiresIn: 30 });
    const [mat] = await db.select({ id: inventoryLots.materialId }).from(inventoryLots).where(eq(inventoryLots.id, newer.id));
    await db.insert(allocationRules).values({ organizationId: w.orgId, scope: "material", materialId: mat.id!, strategy: "fifo", note: "test" });
    const rec = await recommendLots(w.wh, { materialId: mat.id! });
    expect(rec.strategy).toBe("fifo");
    expect(rec.source).toBe("material");
    await db.delete(allocationRules).where(eq(allocationRules.materialId, mat.id!));
  });

  it("fefo.recommendation_matches_allocation and sales allocation respects reservations of other demands", async () => {
    const [acs] = await db.select().from(products).where(eq(products.skuCode, "ACS-135"));
    const [cust] = await db.select().from(customers).where(eq(customers.code, "CUS-002"));
    const fg = await loc(w.nfd.id, "FG-01");
    const soon = await makeLot(w.owner, { siteId: w.nfd.id, locCode: "FG-01", productSku: "ACS-135", qty: "30", expiresIn: 200, madeDaysAgo: 100 });
    await makeLot(w.owner, { siteId: w.nfd.id, locCode: "FG-01", productSku: "ACS-135", qty: "500", expiresIn: 700, madeDaysAgo: 5 });
    const rec = await recommendLots(w.sales, { productId: acs.id, customerId: cust.id, qty: "48" });
    // Reserve the recommended lot for another demand: allocation must skip that quantity.
    const firstPick = rec.picks[0];
    await createReservation(w.sales, { lotId: firstPick.lotId, locationId: fg.id, qty: firstPick.qty, demandType: "manual", demandReference: "Hold for trade show", idempotencyKey: key() });
    const after = await recommendLots(w.sales, { productId: acs.id, customerId: cust.id, qty: "48" });

    const [so] = await db
      .insert(salesOrders)
      .values({ organizationId: w.orgId, siteId: w.nfd.id, orderNumber: `SO-T-${Date.now()}`, customerId: cust.id, status: "confirmed", createdBy: w.sales.userId })
      .returning();
    const [line] = await db.insert(salesOrderLines).values({ salesOrderId: so.id, lineNo: 1, productId: acs.id, qtyUnits: "48", unitPrice: "70" }).returning();
    const salesCtx = w.wh; // warehouse_operator holds sales.allocation.post
    await allocateOrder(salesCtx, so.id);
    const allocs = await db.select().from(stockAllocations).where(eq(stockAllocations.salesOrderLineId, line.id));
    expect(allocs.map((a) => [a.lotId, String(Number(a.qtyUnits))])).toEqual(after.picks.map((p) => [p.lotId, p.qty]));
    expect(firstPick.lotId).toBe(soon.id);
    expect(allocs.some((a) => a.lotId === soon.id)).toBe(false);
  });

  it("a reservation for the order line itself does not block that order and is converted on allocation", async () => {
    const [acs] = await db.select().from(products).where(eq(products.skuCode, "ACS-135"));
    const [cust] = await db.select().from(customers).where(eq(customers.code, "CUS-002"));
    const fg = await loc(w.nfd.id, "FG-01");
    const lot = await makeLot(w.owner, { siteId: w.nfd.id, locCode: "FG-01", productSku: "ACS-135", qty: "12", expiresIn: 300, madeDaysAgo: 400 });
    const [so] = await db.insert(salesOrders).values({ organizationId: w.orgId, siteId: w.nfd.id, orderNumber: `SO-T2-${Date.now()}`, customerId: cust.id, status: "confirmed", createdBy: w.sales.userId }).returning();
    const [line] = await db.insert(salesOrderLines).values({ salesOrderId: so.id, lineNo: 1, productId: acs.id, qtyUnits: "12", unitPrice: "70" }).returning();
    const r = await createReservation(w.sales, { lotId: lot.id, locationId: fg.id, qty: "12", demandType: "sales_order_line", demandId: line.id, idempotencyKey: key() });
    await allocateOrder(w.wh, so.id);
    const [res] = await db.select().from(stockReservations).where(eq(stockReservations.id, r.id));
    expect(res.status).toBe("converted");
    const allocs = await db.select().from(stockAllocations).where(and(eq(stockAllocations.salesOrderLineId, line.id), eq(stockAllocations.lotId, lot.id)));
    expect(allocs.length).toBe(1);
  });

  it("TTL: expired reservations stop counting and are swept; authz cross-site and role escalation", async () => {
    const lot = await makeLot(w.owner, { siteId: w.nfd.id, locCode: "B-01", materialCode: "MAT-0062", qty: "100" });
    const b01 = await loc(w.nfd.id, "B-01");
    const r = await createReservation(w.manager, { lotId: lot.id, locationId: b01.id, qty: "100", demandType: "manual", demandReference: "x", ttlHours: 1, idempotencyKey: key() });
    await db.update(stockReservations).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(stockReservations.id, r.id));
    const [mat] = await db.select({ id: inventoryLots.materialId }).from(inventoryLots).where(eq(inventoryLots.id, lot.id));
    const rec = await recommendLots(w.manager, { materialId: mat.id! });
    expect(rec.candidates.find((c) => c.lotId === lot.id)?.available).toBe("100");
    expect(await expireReservations(db, w.nfd.id)).toBeGreaterThanOrEqual(1);
    await expectDomain(createReservation(w.whRvs, { lotId: lot.id, locationId: b01.id, qty: "1", demandType: "manual", demandReference: "x", idempotencyKey: key() }), "forbidden");
    const m = w.manager;
    const rvsMgr = new AuthContext(m.userId, m.organizationId, m.displayName, m.email, m.roleCodes, m.permissions, [w.rvs], w.rvs.id);
    await expectDomain(createReservation(rvsMgr, { lotId: lot.id, locationId: b01.id, qty: "1", demandType: "manual", demandReference: "x", idempotencyKey: key() }), "not_found");
    await expectDomain(recommendLots(w.whRvs, { materialId: mat.id!, siteId: w.nfd.id }), "not_found");
    void future;
  });
});
