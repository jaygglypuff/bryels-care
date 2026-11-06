/**
 * ADR-110 C1 (end-to-end walk P13): the second check of the box refuses any box that is not on the pick list, unless
 * a site manager approved an over-shipment for that order line; it never counts past the ordered quantity (plus the
 * approved extra) and "Finish the check" is blocked, in plain words, when a line is over.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { db } from "@/db/client";
import { customers, inventoryLots, packVerificationScans, packs, products, salesOrderLines, shipmentLines, shipments } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { createBox, postMovement } from "@/modules/inventory";
import { allocateOrder, approveShipmentException, completePacking, confirmOrder, createOrder, getPackingView, getPick, manilaToday, scanPackVerification } from "@/modules/sales";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, loadKit, loc, type Kit } from "../../support/kit";
import { key, pickAll } from "../../support/w3e";

let kit: Kit;
let sales: AuthContext;
let wh: AuthContext;
let mgr: AuthContext;
let mgrRvs: AuthContext;
let prodOp: AuthContext;
let productId: string;
let fg01: string;
const spare: { id: string; containerNumber: string }[] = [];
let qaCageBox: { id: string; containerNumber: string };
let otherOrderBox: string;
let orderId: string;
let shipmentId: string;
let pickId: string;

const deliveryDate = () => new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
async function order(qty: string) {
  const [c] = await db.select().from(customers).where(eq(customers.code, "CUS-002"));
  const o = await createOrder(sales, { customerId: c.id, requestedDeliveryOn: deliveryDate(), lines: [{ productId, qtyUnits: qty, unitPrice: "70" }] });
  await confirmOrder(sales, o.id);
  return o.id;
}
async function lot(status: string, at: string, qty: string) {
  const expires = new Date(Date.now() + 600 * 86_400_000).toISOString().slice(0, 10);
  const [l] = await db.insert(inventoryLots).values({ organizationId: kit.orgId, siteId: kit.nfd.id, lotNumber: `L-C1-${status.slice(0, 3).toUpperCase()}-${uuidv7().slice(-6).toUpperCase()}`, itemKind: "product", productId, expiresOn: expires, manufacturedOn: manilaToday(), qualityStatus: status, baseUom: "pcs" }).returning();
  await db.transaction((tx) => postMovement(tx, mgr, { movementType: "receipt", lotId: l.id, toLocationId: at, qtyBase: qty, sourceDocumentType: "test_fixture" }));
  return l;
}

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  sales = await asUser(kit, "sales@bryels-care.test", "sales_cs", [kit.nfd]);
  wh = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
  mgr = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  mgrRvs = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.rvs]);
  prodOp = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  const [p] = await db.insert(products).values({ organizationId: kit.orgId, skuCode: "TST-C1-01", name: "Test Guava Bar 135 g (fictional)", family: "Soap", unitNetMassG: "135", unitsPerBox: 24 }).returning();
  productId = p.id;
  fg01 = (await loc(kit.nfd.id, "FG-01")).id;
  const released = await lot("released", fg01, "120");
  for (let i = 0; i < 5; i++) spare.push(await createBox(wh, { lotId: released.id, locationId: fg01, qty: "24", idempotencyKey: uuidv7() }));
  // A box of the same product still in the QA cage (lot waiting for QA).
  const cage = (await loc(kit.nfd.id, "QUA-01")).id;
  const waiting = await lot("quarantine", cage, "24");
  qaCageBox = await createBox(wh, { lotId: waiting.id, locationId: cage, qty: "24", idempotencyKey: uuidv7() });
  // Another order takes one box first; then ours takes two boxes (48).
  const other = await order("24");
  const ra = await allocateOrder(wh, other);
  otherOrderBox = ra.created.find((c) => c.boxNumber)!.boxNumber!;
  orderId = await order("48");
  const r = await allocateOrder(wh, orderId);
  expect(r.created.filter((c) => c.boxNumber)).toHaveLength(2);
  ({ pickId, shipmentId } = await pickAll(wh, orderId));
}, 180_000);

describe("C1 second check of the box: only boxes on the pick list", () => {
  it("refuses a box that is not on the pick list even before the order is full (no approval), and does not count it", async () => {
    const picked = (await getPick(wh, pickId)).lines.filter((l) => !l.voidedAt && l.boxNumber).map((l) => l.boxNumber!);
    await scanPackVerification(mgr, shipmentId, { payload: `BC:BOX:${picked[0]}`, idempotencyKey: key() });
    const notPicked = spare.find((b) => !picked.includes(b.containerNumber) && b.containerNumber !== otherOrderBox)!;
    const err = await expectCode(scanPackVerification(mgr, shipmentId, { payload: `BC:BOX:${notPicked.containerNumber}`, idempotencyKey: key() }), "conflict");
    expect(err.details?.code).toBe("NOT_ON_PICK_LIST");
    expect(err.message).toMatch(/not on the pick list/);
    expect(err.message).not.toMatch(/approved over-shipment/);
    const lines = await db.select().from(shipmentLines).where(eq(shipmentLines.shipmentId, shipmentId));
    expect(lines).toHaveLength(1);
    expect(lines.some((l) => l.isOverShipment)).toBe(false);
    // the refusal is kept as evidence
    const [pack] = await db.select().from(packs).where(eq(packs.shipmentId, shipmentId));
    const refused = await db.select().from(packVerificationScans).where(and(eq(packVerificationScans.packId, pack.id), eq(packVerificationScans.result, "not_in_pack")));
    expect(refused.some((x) => /Not on the pick list/.test(x.note ?? ""))).toBe(true);
    const v = await getPackingView(mgr, shipmentId);
    expect(v.orderLines[0].verified).toBe("24");
    expect(v.orderLines[0].tooMany).toBe("0");
  });

  it("refuses another order's box and a box still in the QA cage", async () => {
    const e1 = await expectCode(scanPackVerification(mgr, shipmentId, { payload: `BC:BOX:${otherOrderBox}`, idempotencyKey: key() }), "conflict");
    expect(["NOT_ON_PICK_LIST", "NOT_FOR_THIS_ORDER"]).toContain(e1.details?.code);
    const e2 = await expectCode(scanPackVerification(mgr, shipmentId, { payload: `BC:BOX:${qaCageBox.containerNumber}`, idempotencyKey: key() }), "conflict");
    expect(e2.details?.code).toBe("NOT_ON_PICK_LIST");
  });

  it("another site and a role without the check right are refused", async () => {
    const picked = (await getPick(wh, pickId)).lines.filter((l) => !l.voidedAt && l.boxNumber).map((l) => l.boxNumber!);
    await expectCode(scanPackVerification(mgrRvs, shipmentId, { payload: `BC:BOX:${picked[1]}`, idempotencyKey: key() }), "not_found");
    await expectCode(scanPackVerification(prodOp, shipmentId, { payload: `BC:BOX:${picked[1]}`, idempotencyKey: key() }), "forbidden");
    await expectCode(scanPackVerification(sales, shipmentId, { payload: `BC:BOX:${picked[1]}`, idempotencyKey: key() }), "forbidden");
  });

  it("with a manager's over-shipment approval one extra box is added; the QA-cage box and a second extra stay refused", async () => {
    const picked = (await getPick(wh, pickId)).lines.filter((l) => !l.voidedAt && l.boxNumber).map((l) => l.boxNumber!);
    await scanPackVerification(mgr, shipmentId, { payload: `BC:BOX:${picked[1]}`, idempotencyKey: key() });
    const [line] = await db.select().from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, orderId));
    await approveShipmentException(mgr, shipmentId, { kind: "over_shipment", salesOrderLineId: line.id, extraQty: "24", reason: "Customer asked for one more box", customerReference: "PO-AMEND-C1", password: "demo1234" });
    const e = await expectCode(scanPackVerification(mgr, shipmentId, { payload: `BC:BOX:${qaCageBox.containerNumber}`, idempotencyKey: key() }), "conflict");
    expect(e.message).toMatch(/not on a shelf|not released|waiting/i);
    const extras = spare.filter((b) => !picked.includes(b.containerNumber) && b.containerNumber !== otherOrderBox);
    const added = await scanPackVerification(mgr, shipmentId, { payload: `BC:BOX:${extras[0].containerNumber}`, idempotencyKey: key() });
    expect(added.overShipment).toBe(true);
    const e2 = await expectCode(scanPackVerification(mgr, shipmentId, { payload: `BC:BOX:${extras[1].containerNumber}`, idempotencyKey: key() }), "conflict");
    expect(e2.details?.code).toBe("NOT_ON_PICK_LIST");
    const v = await getPackingView(mgr, shipmentId);
    expect(v.orderLines[0].verified).toBe("72");
    expect(v.orderLines[0].tooMany).toBe("0");
  });

  it("Finish the check is refused in plain words when a line holds more than ordered plus the approved extra", async () => {
    // A line added outside the scan rules (e.g. before this fix) must still block Finish.
    const [any] = await db.select().from(shipmentLines).where(eq(shipmentLines.shipmentId, shipmentId)).limit(1);
    const { id: _id, verifiedAt: _v, ...copy } = any;
    await db.insert(shipmentLines).values({ ...copy, containerId: null, pickLineId: null, allocationId: null, qtyBase: "6", isOverShipment: true });
    const v = await getPackingView(mgr, shipmentId);
    expect(v.orderLines[0].tooMany).toBe("6");
    expect(v.orderLines[0].overMessage).toMatch(/78 of 48 pcs are checked, 6 too many/);
    const err = await expectCode(completePacking(mgr, shipmentId, { carrierName: "Own truck", idempotencyKey: key() }), "conflict");
    expect(err.details?.code).toBe("OVER_ORDERED");
    expect((await db.select().from(shipments).where(eq(shipments.id, shipmentId)))[0].status).toBe("picked");
  });
});
