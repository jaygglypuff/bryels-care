/**
 * ADR-110 C3 (end-to-end walk P12): boxes made at Finish follow their lot. When QA says OK the sealed boxes move with
 * the lot's stock to the finished-goods shelf (same transaction), set-aside takes whole boxes first, the pick list asks
 * for the boxes (BC:BOX) and scanning one is accepted. A box that also holds another lot refuses the whole-lot move
 * (split it first). Put-away lists and moves boxes, not loose pieces. Cross-site and role negatives.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { db } from "@/db/client";
import { batches, containerContents, containers, customers, inventoryLots, products } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { createBox, lotsToPutAway, postMovement } from "@/modules/inventory";
import { putAwayLot } from "@/modules/inventory/receiving-putaway";
import { decideBatch, decideLot } from "@/modules/quality/dispositions";
import { recordTestResult } from "@/modules/quality/tests";
import { allocateOrder, availableStock, confirmOrder, createOrder, getPick, manilaToday, scanPackVerification } from "@/modules/sales";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, loadKit, loc, onHand, seedLot, type Kit } from "../../support/kit";
import { key, pickAll } from "../../support/w3e";

let kit: Kit;
let qa: AuthContext;
let qaLead: AuthContext;
let wh: AuthContext;
let whRvs: AuthContext;
let mgr: AuthContext;
let sales: AuthContext;
let qua: string;
let fg: string;
const boxIds: string[] = [];

async function productLot(productId: string, status: string, at: string, qty: string) {
  const [l] = await db.insert(inventoryLots).values({ organizationId: kit.orgId, siteId: kit.nfd.id, lotNumber: `L-C3-${uuidv7().slice(-8).toUpperCase()}`, itemKind: "product", productId, expiresOn: "2029-12-31", manufacturedOn: manilaToday(), qualityStatus: status, baseUom: "pcs" }).returning();
  await db.transaction((tx) => postMovement(tx, mgr, { movementType: "receipt", lotId: l.id, toLocationId: at, qtyBase: qty, sourceDocumentType: "test_fixture" }));
  return l;
}

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  qa = await asUser(kit, "qa.nfd@bryels-care.test", "qa_qc", [kit.nfd, kit.rvs]);
  qaLead = await asUser(kit, "qa.lead@bryels-care.test", "qa_qc", [kit.nfd, kit.rvs]);
  wh = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
  whRvs = await asUser(kit, "warehouse.rvs@bryels-care.test", "warehouse_operator", [kit.rvs]);
  mgr = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  sales = await asUser(kit, "sales@bryels-care.test", "sales_cs", [kit.nfd]);
  qua = (await loc(kit.nfd.id, "QUA-01")).id;
  fg = (await loc(kit.nfd.id, "FG-01")).id;
}, 180_000);

describe("C3 boxes follow their lot from Finish to the pick list", () => {
  it("QA OK of the batch moves its sealed boxes to the finished-goods shelf with the stock", async () => {
    const [b] = await db.select().from(batches).where(eq(batches.batchNumber, "B-26-0003"));
    const [lot] = await db.select().from(inventoryLots).where(eq(inventoryLots.lotNumber, seedLot("00017")));
    const qty = await onHand(lot.id, qua);
    // Two boxes of 48 as Finish makes them (sealed boxes in the hold area); the rest stays loose.
    for (let i = 0; i < 2; i++) boxIds.push((await createBox(wh, { lotId: lot.id, locationId: qua, qty: "48", idempotencyKey: uuidv7() })).id);
    await db.update(containers).set({ status: "sealed" }).where(eq(containers.id, boxIds[0]));
    await recordTestResult(qa, { batchId: b.id, testName: "Appearance", specification: "Smooth bar, no cracks", result: "Conforms", passed: true });
    await recordTestResult(qa, { batchId: b.id, testName: "Net weight (n=10)", specification: "≥ 135 g each", result: "135.9 g avg", passed: true });
    await decideBatch(qaLead, { batchId: b.id, decision: "release", reason: "All tests within specification; BMR reviewed" });
    expect(await onHand(lot.id, qua)).toBe("0");
    expect(await onHand(lot.id, fg)).toBe(qty);
    const boxes = await db.select().from(containers).where(eq(containers.id, boxIds[0]));
    expect(boxes[0].currentLocationId).toBe(fg);
    expect((await db.select().from(containers).where(eq(containers.id, boxIds[1])))[0].currentLocationId).toBe(fg);
  });

  it("set-aside takes the whole boxes first, the pick list asks for them, and scanning the box label is accepted", async () => {
    const [lot] = await db.select().from(inventoryLots).where(eq(inventoryLots.lotNumber, seedLot("00017")));
    const stock = await availableStock(db, kit.nfd.id, [lot.productId!]);
    const ours = stock.findIndex((c) => c.lotId === lot.id);
    expect(ours).toBeGreaterThanOrEqual(0);
    const before = stock.slice(0, ours).reduce((t, c) => t + Number(c.available), 0);
    const [c] = await db.select().from(customers).where(eq(customers.code, "CUS-002"));
    const o = await createOrder(sales, { customerId: c.id, requestedDeliveryOn: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10), lines: [{ productId: lot.productId!, qtyUnits: String(before + 96), unitPrice: "70" }] });
    await confirmOrder(sales, o.id);
    const r = await allocateOrder(wh, o.id);
    const fromOurs = r.created.filter((x) => x.lotNumber === lot.lotNumber);
    expect(fromOurs.map((x) => x.boxNumber).filter(Boolean)).toHaveLength(2);
    expect(fromOurs.every((x) => x.boxNumber)).toBe(true);
    const { pickId, shipmentId } = await pickAll(wh, o.id);
    const lines = (await getPick(wh, pickId)).lines.filter((l) => !l.voidedAt && l.lotNumber === lot.lotNumber);
    expect(lines.every((l) => l.boxNumber)).toBe(true);
    // The second check accepts the picked box by its label.
    const ok = await scanPackVerification(mgr, shipmentId, { payload: `BC:BOX:${lines[0].boxNumber}`, idempotencyKey: key() });
    expect(ok.outcome).toBe("verified");
  });

  it("a box holding this lot and another lot refuses the whole-lot move (nothing moves)", async () => {
    const [p] = await db.insert(products).values({ organizationId: kit.orgId, skuCode: "TST-C3-01", name: "Test Calamansi Bar (fictional)", family: "Soap", unitNetMassG: "100", unitsPerBox: 24 }).returning();
    const a = await productLot(p.id, "quarantine", qua, "30");
    const other = await productLot(p.id, "quarantine", qua, "10");
    const box = await createBox(wh, { lotId: a.id, locationId: qua, qty: "24", idempotencyKey: uuidv7() });
    await db.insert(containerContents).values({ organizationId: kit.orgId, siteId: kit.nfd.id, containerId: box.id, lotId: other.id, qtyBase: "4", baseUom: "pcs" });
    const e = await expectCode(decideLot(qa, { lotId: a.id, decision: "reject", reason: "Cracked bars in the test lot" }), "conflict");
    expect(e.message).toMatch(/Split the box first/);
    expect(await onHand(a.id, qua)).toBe("30");
    expect((await db.select().from(inventoryLots).where(eq(inventoryLots.id, a.id)))[0].qualityStatus).toBe("quarantine");
  });

  it("put-away lists the boxes of a released lot and moves them with it; other sites and roles are refused", async () => {
    const [p] = await db.insert(products).values({ organizationId: kit.orgId, skuCode: "TST-C3-02", name: "Test Guava Bar (fictional)", family: "Soap", unitNetMassG: "100", unitsPerBox: 24 }).returning();
    const z = await productLot(p.id, "released", qua, "53");
    const b1 = await createBox(wh, { lotId: z.id, locationId: qua, qty: "24", idempotencyKey: uuidv7() });
    const b2 = await createBox(wh, { lotId: z.id, locationId: qua, qty: "24", idempotencyKey: uuidv7() });
    const task = (await lotsToPutAway(wh)).find((t) => t.lotId === z.id)!;
    expect(task.boxNumbers.sort()).toEqual([b1.containerNumber, b2.containerNumber].sort());
    expect(task.qtyBase).toBe("5");
    await expectCode(putAwayLot(whRvs, { lotRef: z.lotNumber, locationRef: "FG-01", idempotencyKey: uuidv7() }), "not_found");
    await expectCode(putAwayLot(sales, { lotRef: z.lotNumber, locationRef: "FG-01", idempotencyKey: uuidv7() }), "forbidden");
    const r = await putAwayLot(wh, { lotRef: z.lotNumber, locationRef: "FG-01", idempotencyKey: uuidv7() });
    expect(r.boxes.sort()).toEqual([b1.containerNumber, b2.containerNumber].sort());
    expect(await onHand(z.id, fg)).toBe("53");
    expect(await onHand(z.id, qua)).toBe("0");
    const moved = await db.select().from(containers).where(and(eq(containers.currentLocationId, fg), eq(containers.id, b1.id)));
    expect(moved).toHaveLength(1);
    expect((await lotsToPutAway(wh)).some((t) => t.lotId === z.id)).toBe(false);
  });
});
