/**
 * Wave 3 W3E fulfilment (US-4-09..14): FEFO allocation with boxes and customer shelf-life rules, pick
 * scans, pack verification with over-shipment / partial exceptions, dispatch posting and reversal,
 * delivery receipts and acknowledgment, the interim accountant export and box-level traceability.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { db } from "@/db/client";
import {
  auditEvents,
  containers,
  customers,
  deliveryReceipts,
  fileAttachments,
  generatedDocuments,
  inventoryLots,
  notifications,
  packVerificationScans,
  packs,
  products,
  salesOrderLines,
  salesOrders,
  shipmentLines,
  shipments,
  stockAllocations,
  stockMovements,
  users,
} from "@/db/schema";
import { AuthContext } from "@/lib/auth/context";
import { runExport } from "@/lib/export";
import { createBox, findLedgerDifferences, postMovement } from "@/modules/inventory";
import {
  acknowledgeDeliveryReceipt,
  allocateOrder,
  approveShipmentException,
  availableStock,
  completePacking,
  completePick,
  approveRequirement,
  confirmOrder,
  createCustomer,
  createOrder,
  customerFulfilmentRequirements,
  draftRequirement,
  releaseAllocations,
  submitRequirement,
  dispatchShipment,
  generateDraftDeliveryReceipt,
  getPick,
  manilaToday,
  remindUnacknowledged,
  reverseShipment,
  scanPackVerification,
  scanPick,
  shipmentExport,
  shipmentReconciliation,
  shippedBoxesForLot,
  startPick,
  unacknowledgedDeliveryReceipts,
} from "@/modules/sales";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, loadKit, loc, onHand, type Kit } from "../../support/kit";
import { key, shipOrder } from "../../support/w3e";

let kit: Kit;
let sales: AuthContext;
let wh: AuthContext;
let whRvs: AuthContext;
let mgr: AuthContext;
let qa: AuthContext;
let prodOp: AuthContext;
let salesRvsOnly: AuthContext;
let productId: string;
let lotA: typeof inventoryLots.$inferSelect;
let fg01: string;
const boxes: { id: string; containerNumber: string }[] = [];
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const saved = { FILE_STORAGE: process.env.FILE_STORAGE, FILE_STORAGE_DIR: process.env.FILE_STORAGE_DIR };

const deliveryDate = () => {
  const d = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  return d < manilaToday() ? manilaToday() : d;
};
async function customerId(code: string) {
  return (await db.select().from(customers).where(eq(customers.code, code)))[0].id;
}
async function order(customerCode: string, qty: string, pid = productId) {
  const o = await createOrder(sales, { customerId: await customerId(customerCode), requestedDeliveryOn: deliveryDate(), lines: [{ productId: pid, qtyUnits: qty, unitPrice: "70" }] });
  await confirmOrder(sales, o.id);
  return o;
}
/** The allocated order of this file's own test product (seeded demo orders are allocated too). */
async function allocatedTestOrder() {
  const [r] = await db
    .selectDistinct({ id: salesOrders.id })
    .from(salesOrders)
    .innerJoin(salesOrderLines, eq(salesOrderLines.salesOrderId, salesOrders.id))
    .where(and(eq(salesOrders.status, "allocated"), eq(salesOrderLines.productId, productId)));
  return r.id;
}
const orderRow = async (id: string) => (await db.select().from(salesOrders).where(eq(salesOrders.id, id)))[0];
const shipmentRow = async (id: string) => (await db.select().from(shipments).where(eq(shipments.id, id)))[0];

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  process.env.FILE_STORAGE = "local";
  process.env.FILE_STORAGE_DIR = mkdtempSync(path.join(tmpdir(), "w3e-files-"));
  sales = await asUser(kit, "sales@bryels-care.test", "sales_cs", [kit.nfd, kit.rvs]);
  salesRvsOnly = await asUser(kit, "sales@bryels-care.test", "sales_cs", [kit.rvs]);
  wh = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
  whRvs = await asUser(kit, "warehouse.rvs@bryels-care.test", "warehouse_operator", [kit.rvs]);
  mgr = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  qa = await asUser(kit, "qa.nfd@bryels-care.test", "qa_qc", [kit.nfd]);
  prodOp = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  // A fictional SKU of its own so FEFO only sees this test's lot.
  const [p] = await db.insert(products).values({ organizationId: kit.orgId, skuCode: "TST-W3E-01", name: "Test Calamansi Bar 100 g (fictional)", family: "Soap", unitNetMassG: "100", unitsPerBox: 24 }).returning();
  productId = p.id;
  fg01 = (await loc(kit.nfd.id, "FG-01")).id;
  const expires = new Date(Date.now() + 600 * 86_400_000).toISOString().slice(0, 10);
  [lotA] = await db.insert(inventoryLots).values({ organizationId: kit.orgId, siteId: kit.nfd.id, lotNumber: `L-W3E-${Date.now().toString(36).toUpperCase()}`, itemKind: "product", productId, expiresOn: expires, manufacturedOn: manilaToday(), qualityStatus: "released", baseUom: "pcs" }).returning();
  await db.transaction((tx) => postMovement(tx, mgr, { movementType: "receipt", lotId: lotA.id, toLocationId: fg01, qtyBase: "100", sourceDocumentType: "test_fixture" }));
  for (let i = 0; i < 3; i++) boxes.push(await createBox(wh, { lotId: lotA.id, locationId: fg01, qty: "24", idempotencyKey: uuidv7() }));
}, 180_000);

afterAll(async () => {
  process.env.FILE_STORAGE = saved.FILE_STORAGE;
  process.env.FILE_STORAGE_DIR = saved.FILE_STORAGE_DIR;
});

describe("US-4-09 allocation by FEFO with boxes and customer rules", () => {
  let o1: string;
  it("refuses roles without inventory.allocation.create and other sites", async () => {
    o1 = (await order("CUS-002", "58")).id;
    await expectCode(allocateOrder(qa, o1), "forbidden");
    await expectCode(allocateOrder(prodOp, o1), "forbidden");
    await expectCode(allocateOrder(whRvs, o1), "not_found");
  });

  it("proposes whole boxes first, then loose units, and moves the order to allocated", async () => {
    const r = await allocateOrder(wh, o1);
    expect(r.fullyAllocated).toBe(true);
    expect(r.created.filter((c) => c.boxNumber).map((c) => Number(c.qty))).toEqual([24, 24]);
    expect(r.created.filter((c) => !c.boxNumber).map((c) => Number(c.qty))).toEqual([10]);
    expect((await orderRow(o1)).status).toBe("allocated");
    const avail = (await availableStock(db, kit.nfd.id, [productId])).reduce((a, c) => a + Number(c.available), 0);
    expect(avail).toBe(42);
    const ev = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, o1), eq(auditEvents.action, "inventory.stock_allocation.created")));
    expect(ev).toHaveLength(1);
  });

  it("fefo.min_shelf_life_customer: the order line's requirement snapshot (W3D) filters lots; a requirement approved later leaves a submitted order alone", async () => {
    const c = await createCustomer(sales, { code: `T3E-${Date.now().toString(36).toUpperCase()}`, name: "Fictional Shelf Life Buyer", minShelfLifeDays: 0, shipToAddress: "1 Ilang-Ilang St., Santa Rosa, Laguna" });
    expect(await customerFulfilmentRequirements(db, kit.orgId, c.id, productId)).toMatchObject({ source: "customer_default", minRemainingShelfLifeDays: 0, fullShipmentRequired: false });
    const early = await order(c.code, "5"); // submitted before the requirement: snapshot 0 days
    // W3D requirement versions: drafted by sales, approved by QA (≠ drafter). A draft never applies.
    const req = await draftRequirement(sales, { customerId: c.id, productId, requirementKind: "min_remaining_shelf_life_days", valueNumeric: "700", effectiveFrom: manilaToday() });
    await submitRequirement(sales, req.id);
    await approveRequirement(qa, req.id);
    await draftRequirement(sales, { customerId: c.id, requirementKind: "carton_count", valueNumeric: "6", effectiveFrom: manilaToday() });
    expect(await customerFulfilmentRequirements(db, kit.orgId, c.id, productId)).toMatchObject({ source: "customer_requirement", minRemainingShelfLifeDays: 700, unitsPerBox: null });
    const late = await order(c.code, "5");
    expect((await db.select().from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, late.id)))[0].minRemainingShelfLifeDays).toBe(700);
    const err = await allocateOrder(wh, late.id).catch((e) => e);
    expect(err).toMatchObject({ code: "insufficient_stock" });
    expect(String(err.message)).toMatch(/minimum shelf life of 700 days/);
    const ok = await allocateOrder(wh, early.id);
    expect(ok).toMatchObject({ fullyAllocated: true, requirementSource: "order_line_snapshot", minShelfLifeDays: 0 });
    // Give the stock back for the next cases; the order returns to confirmed with the reason.
    await releaseAllocations(wh, early.id, { reason: "Test: stock needed for the pick cases" });
    expect((await orderRow(early.id)).status).toBe("confirmed");
  });
});

describe("US-4-10 pick list and pick scans", () => {
  let o1: string;
  let pickId: string;
  let shipmentId: string;
  it("starts a pick (draft shipment, order picking) only with sales.pick.create at the order's site", async () => {
    o1 = await allocatedTestOrder();
    await expectCode(startPick(prodOp, o1, { idempotencyKey: key() }), "forbidden");
    await expectCode(startPick(whRvs, o1, { idempotencyKey: key() }), "not_found");
    const k = key();
    const r = await startPick(wh, o1, { idempotencyKey: k });
    expect((await startPick(wh, o1, { idempotencyKey: k })).replayed).toBe(true);
    pickId = r.pickId;
    shipmentId = r.shipmentId;
    expect(r.pickNumber).toMatch(/^PK-\d{2}-\d{6}$/);
    expect((await orderRow(o1)).status).toBe("picking");
    expect((await shipmentRow(shipmentId)).status).toBe("draft");
  });

  it("refuses a box not for this order, substitutes a same-lot box, counts duplicates once and replays a repeated scan", async () => {
    const seedBox = (await db.select().from(containers).where(eq(containers.containerNumber, "BX-00000001")))[0];
    await expect(scanPick(wh, pickId, { payload: `BC:BOX:${seedBox.containerNumber}`, idempotencyKey: key() })).rejects.toMatchObject({ code: "conflict", details: { code: "NOT_FOR_THIS_ORDER" } });
    const view = await getPick(wh, pickId);
    const allocatedBoxes = view.rows.filter((r) => r.boxNumber).map((r) => r.boxNumber);
    const spare = boxes.find((b) => !allocatedBoxes.includes(b.containerNumber))!;
    const sub = await scanPick(wh, pickId, { payload: `BC:BOX:${spare.containerNumber}`, idempotencyKey: key() });
    expect(sub.substituted).toBe(true);
    expect((await scanPick(wh, pickId, { payload: `BC:BOX:${spare.containerNumber}`, idempotencyKey: key() })).outcome).toBe("duplicate");
    const k = key();
    const other = (await getPick(wh, pickId)).rows.find((r) => r.boxNumber && r.boxNumber !== spare.containerNumber && !r.done)!;
    await scanPick(wh, pickId, { payload: `BC:BOX:${other.boxNumber}`, idempotencyKey: k });
    expect((await scanPick(wh, pickId, { payload: `BC:BOX:${other.boxNumber}`, idempotencyKey: k })).replayed).toBe(true);
    await expectCode(scanPick(whRvs, pickId, { payload: `BC:BOX:${other.boxNumber}`, idempotencyKey: key() }), "not_found");
  });

  it("picks loose units by lot and quantity, refuses more than allocated, and needs a short-pick reason", async () => {
    await expect(scanPick(wh, pickId, { payload: `BC:LOT:${lotA.lotNumber}`, qty: "12", idempotencyKey: key() })).rejects.toMatchObject({ code: "conflict" });
    await scanPick(wh, pickId, { payload: `BC:LOT:${lotA.lotNumber}`, qty: "6", idempotencyKey: key() });
    await expectCode(completePick(wh, pickId, {}), "validation");
    const r = await completePick(wh, pickId, { shortPickReason: "Four bars damaged on the shelf" });
    expect(r.short).toHaveLength(1);
    expect((await shipmentRow(shipmentId)).status).toBe("picked");
    expect(await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, pickId), eq(auditEvents.action, "sales.pick.scanned")))).toHaveLength(3);
  });

  it("US-4-11: the picker cannot verify; over-shipment is 409 until a site manager (not the order creator) approves it", async () => {
    const view = await getPick(wh, pickId);
    const picked = view.lines.filter((l) => !l.voidedAt && l.boxNumber).map((l) => l.boxNumber!);
    await expectCode(scanPackVerification(wh, shipmentId, { payload: `BC:BOX:${picked[0]}`, idempotencyKey: key() }), "separation_of_duties");
    for (const b of picked) await scanPackVerification(mgr, shipmentId, { payload: `BC:BOX:${b}`, idempotencyKey: key() });
    expect((await scanPackVerification(mgr, shipmentId, { payload: `BC:BOX:${picked[0]}`, idempotencyKey: key() })).outcome).toBe("duplicate");
    await scanPackVerification(mgr, shipmentId, { payload: `BC:LOT:${lotA.lotNumber}`, qty: "6", idempotencyKey: key() });
    const extra = boxes.find((b) => !picked.includes(b.containerNumber))!;
    await expect(scanPackVerification(mgr, shipmentId, { payload: `BC:BOX:${extra.containerNumber}`, idempotencyKey: key() })).rejects.toMatchObject({ code: "conflict", details: { code: "OVER_SHIPMENT" } });
    const [pack] = await db.select().from(packs).where(eq(packs.shipmentId, shipmentId));
    expect(pack.verificationFailureCount).toBe(1);
    expect((await db.select().from(packVerificationScans).where(and(eq(packVerificationScans.packId, pack.id), eq(packVerificationScans.result, "not_in_pack")))).length).toBe(1);
    const line = (await db.select().from(shipmentLines).where(eq(shipmentLines.shipmentId, shipmentId)))[0].salesOrderLineId;
    const input = { kind: "over_shipment" as const, salesOrderLineId: line, extraQty: "24", reason: "Customer asked for one more box", customerReference: "PO-AMEND-118", password: "demo1234" };
    await expectCode(approveShipmentException(wh, shipmentId, input), "forbidden");
    await expectCode(approveShipmentException(mgr, shipmentId, { ...input, password: "wrong-password" }), "reauth_required");
    await approveShipmentException(mgr, shipmentId, input);
    const added = await scanPackVerification(mgr, shipmentId, { payload: `BC:BOX:${extra.containerNumber}`, idempotencyKey: key() });
    expect(added.overShipment).toBe(true);
    expect(await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, shipmentId), eq(auditEvents.action, "sales.shipment.over_shipment_approved")))).toHaveLength(1);
  });

  it("completes packing (checker ≠ packer): shipment packed, order packed, packing list generated", async () => {
    await expectCode(completePacking(wh, shipmentId, { carrierName: "Own truck", idempotencyKey: key() }), "separation_of_duties");
    const r = await completePacking(mgr, shipmentId, { carrierName: "Own truck", trackingNumber: "TRK-1", grossWeightKg: "9.5", packageCount: 3, idempotencyKey: key() });
    expect(r.packingListNumber).toMatch(/^DOC-/);
    expect((await shipmentRow(shipmentId)).status).toBe("packed");
    expect((await orderRow(o1)).status).toBe("packed");
    const [pack] = await db.select().from(packs).where(eq(packs.shipmentId, shipmentId));
    expect(pack.status).toBe("verified");
    expect(pack.checkedBy).not.toBe(pack.packedBy);
  });

  it("T-13: a draft DR posts no stock; dispatch re-checks status, posts one movement per line and reconciles", async () => {
    const before = await onHand(lotA.id, fg01);
    const draft = await generateDraftDeliveryReceipt(wh, shipmentId, { idempotencyKey: key() });
    expect(await onHand(lotA.id, fg01)).toBe(before);
    const [doc] = await db.select().from(generatedDocuments).where(eq(generatedDocuments.id, draft.documentId));
    expect(doc.watermark).toMatch(/DRAFT/);
    const json = JSON.stringify(doc.dataset);
    expect(json).not.toMatch(/unitPrice|"70"|BC:BOX:/); // sales.pricing_masked_on_pick_pack_dr
    // shipment.dispatch_rechecks_status: an on_hold or expired lot blocks posting.
    await db.update(inventoryLots).set({ qualityStatus: "on_hold" }).where(eq(inventoryLots.id, lotA.id));
    await expectCode(dispatchShipment(wh, shipmentId, { driverName: "Ramon", vehiclePlate: "NBC 1234", idempotencyKey: key() }), "blocked_lot");
    await db.update(inventoryLots).set({ qualityStatus: "released", expiresOn: "2020-01-01" }).where(eq(inventoryLots.id, lotA.id));
    await expectCode(dispatchShipment(wh, shipmentId, { driverName: "Ramon", vehiclePlate: "NBC 1234", idempotencyKey: key() }), "blocked_lot");
    await db.update(inventoryLots).set({ expiresOn: lotA.expiresOn }).where(eq(inventoryLots.id, lotA.id));
    expect(await onHand(lotA.id, fg01)).toBe(before);
    await expectCode(dispatchShipment(qa, shipmentId, { driverName: "Ramon", vehiclePlate: "NBC 1234", idempotencyKey: key() }), "forbidden");
    const k = key();
    const r = await dispatchShipment(wh, shipmentId, { driverName: "Ramon", vehiclePlate: "NBC 1234", idempotencyKey: k });
    expect((await dispatchShipment(wh, shipmentId, { driverName: "Ramon", vehiclePlate: "NBC 1234", idempotencyKey: k })).replayed).toBe(true);
    expect(r.drNumber).toMatch(/^DR-\d{2}-\d{5}$/);
    expect(r.movements).toBe(4);
    expect(Number(await onHand(lotA.id, fg01))).toBe(Number(before) - 78);
    expect((await orderRow(o1)).status).toBe("shipped");
    const rec = await shipmentReconciliation(wh, shipmentId);
    expect(rec).toMatchObject({ balanced: true, linesQty: "78" });
    expect(await findLedgerDifferences(db, { organizationId: kit.orgId, siteIds: [kit.nfd.id] })).toHaveLength(0);
    const shippedBoxes = await db.select().from(containers).where(eq(containers.status, "shipped"));
    expect(shippedBoxes).toHaveLength(3);
    const [dr] = await db.select().from(deliveryReceipts).where(and(eq(deliveryReceipts.shipmentId, shipmentId), eq(deliveryReceipts.status, "issued")));
    expect(dr.drNumber).toBe(r.drNumber);
    const [drDoc] = await db.select().from(generatedDocuments).where(eq(generatedDocuments.id, dr.generatedDocumentId!));
    expect((drDoc.dataset as { data: { copies: string[]; overShipmentText: string | null } }).data.copies).toEqual(["Customer", "Driver", "File"]);
    expect((drDoc.dataset as { data: { overShipmentText: string | null } }).data.overShipmentText).toMatch(/PO-AMEND-118/);
    expect((await db.select().from(generatedDocuments).where(eq(generatedDocuments.id, draft.documentId)))[0].status).not.toBe("ready");
  });

  it("shipment.reverse_returns_stock: reversal with reason posts reversals, reseals boxes, voids the DR and reopens the order", async () => {
    const before = await onHand(lotA.id, fg01);
    await expectCode(reverseShipment(wh, shipmentId, { reason: "Truck did not leave", idempotencyKey: key() }), "forbidden");
    const r = await reverseShipment(mgr, shipmentId, { reason: "Dispatched in error, truck did not leave", idempotencyKey: key() });
    expect(r.movements).toBe(4);
    expect(Number(await onHand(lotA.id, fg01))).toBe(Number(before) + 78);
    expect((await db.select().from(containers).where(eq(containers.status, "shipped")))).toHaveLength(0);
    expect((await shipmentRow(shipmentId)).status).toBe("reversed");
    expect((await orderRow(o1)).status).toBe("allocated");
    expect((await db.select().from(deliveryReceipts).where(eq(deliveryReceipts.shipmentId, shipmentId)))[0].status).toBe("voided");
    expect((await shipmentReconciliation(wh, shipmentId)).balanced).toBe(true);
    expect(await findLedgerDifferences(db, { organizationId: kit.orgId, siteIds: [kit.nfd.id] })).toHaveLength(0);
  });
});

describe("US-4-12/13 dispatch again, acknowledgment and the action centre", () => {
  let shipmentId: string;
  let o1: string;
  it("ships the re-opened allocations through the full flow (partial: order partially_shipped)", async () => {
    o1 = await allocatedTestOrder();
    const s = await shipOrder({ picker: wh, checker: mgr, dispatcher: wh }, o1);
    shipmentId = s.id;
    expect(s.status).toBe("dispatched");
    expect((await orderRow(o1)).status).toBe("partially_shipped");
  });

  it("lists DRs not acknowledged after the configured days and notifies the site once a day", async () => {
    await db.update(shipments).set({ dispatchedAt: new Date(Date.now() - 5 * 86_400_000) }).where(eq(shipments.id, shipmentId));
    expect((await unacknowledgedDeliveryReceipts(wh)).map((r) => r.shipmentId)).toContain(shipmentId);
    const run = { asOf: new Date() } as Parameters<typeof remindUnacknowledged>[0];
    const first = await remindUnacknowledged(run);
    expect(first.notified).toBeGreaterThan(0);
    expect((await remindUnacknowledged(run)).notified).toBe(0);
    const [u] = await db.select().from(users).where(eq(users.email, "warehouse.nfd@bryels-care.test"));
    expect(await db.select().from(notifications).where(and(eq(notifications.recipientUserId, u.id), eq(notifications.kind, "sales.delivery_receipt.unacknowledged"), eq(notifications.entityId, shipmentId)))).toHaveLength(1);
  });

  it("captures the acknowledgment with a drawn signature (evidence) and regenerates the DR as ACKNOWLEDGED", async () => {
    const base = { receivedByName: "Marco Tan", receivedByPosition: "Store supervisor", receivedAt: new Date(), remarks: "One box dented", idempotencyKey: key() };
    await expectCode(acknowledgeDeliveryReceipt(wh, shipmentId, { ...base, kind: "photo" }), "validation");
    await expectCode(acknowledgeDeliveryReceipt(whRvs, shipmentId, { ...base, kind: "name_only" }), "not_found");
    const r = await acknowledgeDeliveryReceipt(wh, shipmentId, { ...base, kind: "drawn", file: { fileName: "signature.png", declaredType: "image/png", bytes: new Uint8Array(PNG) } });
    expect(r.documentNumber).toMatch(/^DOC-/);
    expect((await shipmentRow(shipmentId)).status).toBe("delivered");
    const [dr] = await db.select().from(deliveryReceipts).where(eq(deliveryReceipts.shipmentId, shipmentId));
    expect(dr).toMatchObject({ status: "acknowledged", acknowledgmentKind: "drawn", receivedByName: "Marco Tan" });
    const [att] = await db.select().from(fileAttachments).where(eq(fileAttachments.id, dr.signatureAttachmentId!));
    expect(att).toMatchObject({ attachmentKind: "signature", isSensitive: true, entityType: "delivery_receipt" });
    const [doc] = await db.select().from(generatedDocuments).where(eq(generatedDocuments.id, dr.generatedDocumentId!));
    expect(doc.watermark).toMatch(/^ACKNOWLEDGED /);
    expect(JSON.stringify(doc.dataset)).toMatch(/data:image\/png;base64,/);
    await expectCode(acknowledgeDeliveryReceipt(wh, shipmentId, { ...base, kind: "name_only", idempotencyKey: key() }), "state");
  });

  it("the remainder is allocated again from partially_shipped and the CX-SHIP partial rule applies to full-shipment customers", async () => {
    await allocateOrder(wh, o1);
    expect((await orderRow(o1)).status).toBe("partially_shipped");
    const c1 = await createCustomer(sales, { code: `T3E-F${Date.now().toString(36).toUpperCase()}`, name: "Fictional Full Shipment Buyer", minShelfLifeDays: 0, shipToAddress: "2 Kamuning St., Calamba, Laguna" });
    const req = await draftRequirement(sales, { customerId: c1.id, requirementKind: "full_shipment_required", valueText: "true", effectiveFrom: manilaToday() });
    await submitRequirement(sales, req.id);
    await approveRequirement(qa, req.id);
    const o3 = await order(c1.code, "30");
    await allocateOrder(wh, o3.id);
    const { pickId, shipmentId: sid } = await startPick(wh, o3.id, { idempotencyKey: key() });
    const row = (await getPick(wh, pickId)).rows.find((r) => r.boxNumber)!;
    await scanPick(wh, pickId, { payload: `BC:BOX:${row.boxNumber}`, idempotencyKey: key() });
    await completePick(wh, pickId, { shortPickReason: "Loose units not found" });
    await scanPackVerification(mgr, sid, { payload: `BC:BOX:${row.boxNumber}`, idempotencyKey: key() });
    await expect(completePacking(mgr, sid, { carrierName: "Own truck", idempotencyKey: key() })).rejects.toMatchObject({ code: "conflict", details: { code: "CX_SHIP_PARTIAL" } });
    await approveShipmentException(mgr, sid, { kind: "partial_shipment", reason: "Customer accepts the rest next week", customerReference: "CALL-0712", password: "demo1234" });
    await completePacking(mgr, sid, { carrierName: "Own truck", idempotencyKey: key() });
    await dispatchShipment(wh, sid, { driverName: "Ramon", vehiclePlate: "NBC 1234", idempotencyKey: key() });
    expect((await orderRow(o3.id)).status).toBe("partially_shipped");
    expect((await db.select().from(stockAllocations).where(and(eq(stockAllocations.status, "open"), sql`${stockAllocations.salesOrderLineId} in (select id from sales_order_lines where sales_order_id = ${o3.id})`))).length).toBeGreaterThan(0);
  });
});

describe("US-4-14 interim shipment export and box-level traceability", () => {
  it("exports dispatched/delivered shipments with lots and boxes; prices masked without sales.price_list.view; audited", async () => {
    const f = { siteId: kit.nfd.id, from: manilaToday(), to: manilaToday() };
    f.from = new Date(Date.now() - 10 * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
    // sales_cs without the W3D price permission: prices are masked (and never read by the query).
    const noPrices = new AuthContext(sales.userId, sales.organizationId, sales.displayName, sales.email, sales.roleCodes, new Set([...sales.permissions].filter((p) => p !== "sales.price_list.view")), sales.allowedSites, kit.nfd.id);
    const priced = (await runExport(sales, shipmentExport, f, "csv")).body.toString("utf8");
    expect(priced.split("\r\n").find((l) => l.startsWith('"Dispatched (Asia/Manila)"'))).toContain("Unit price");
    const file = await runExport(noPrices, shipmentExport, f, "csv");
    const text = file.body.toString("utf8");
    expect(text).toContain(lotA.lotNumber);
    expect(text).toMatch(/DR-\d{2}-\d{5}/);
    const headerRow = text.split("\r\n").find((l) => l.startsWith('"Dispatched (Asia/Manila)"'))!;
    expect(headerRow).toContain('"Lot"');
    expect(headerRow).not.toContain("Unit price");
    expect(file.maskedColumns).toEqual(["Unit price", "Line amount"]);
    expect(text).not.toMatch(/SH-\d{2}-\d{5}.*reversed/);
    await expectCode(runExport(wh, shipmentExport, f, "csv"), "forbidden");
    await expectCode(runExport(salesRvsOnly, shipmentExport, f, "csv"), "not_found");
    const ev = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "platform.export.created"), eq(auditEvents.entityNumber, "sales.shipments")));
    expect(ev).toHaveLength(2);
  });

  it("genealogy: every shipped box of a lot resolves to its shipment and customer", async () => {
    const rows = await shippedBoxesForLot(qa, lotA.id);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.customerName && r.drNumber)).toBe(true);
    expect(rows.some((r) => r.boxNumber)).toBe(true);
    const mv = await db.select().from(stockMovements).where(and(eq(stockMovements.lotId, lotA.id), eq(stockMovements.movementType, "shipment")));
    expect(mv.some((m) => (m.meta as { containerNumber?: string }).containerNumber)).toBe(true);
    expect(await shippedBoxesForLot(whRvs, lotA.id).catch(() => [])).toHaveLength(0);
  });
});
