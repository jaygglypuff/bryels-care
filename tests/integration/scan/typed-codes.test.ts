/**
 * Owner decision 2026-11-08 (A-SCAN-TYPED-01): every place that asks to scan a label also takes the number printed
 * on it, typed (any case, with or without dashes). A typed entry is recorded as typed in the same fields the scan
 * writes; it counts for verification checks; a tap in a list still does not; a wrong or other-site number is refused.
 * Families: picking, second check of the box, label verification, put-away, count, ScanOrPick resolver. Weighing lot
 * confirmation and the materials list: tests/integration/production/flow-v2-g2.test.ts; code rules: tests/unit/scan/typed-codes.test.ts.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { db } from "@/db/client";
import { auditEvents, customers, inventoryLots, labelVerifications, packVerificationScans, packs, pickLines, products, stockMovements } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { createBox, createCount, findLotForCount, postMovement, putAwayLot, recordCount, releaseCount } from "@/modules/inventory";
import { verifyLabelScan } from "@/modules/quality";
import { allocateOrder, completePick, confirmOrder, createOrder, getPick, manilaToday, scanPackVerification, scanPick, startPick } from "@/modules/sales";
import { resolvePickRef } from "@/modules/scan/pick";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, loadKit, loc, makeLot, type Kit } from "../../support/kit";

const key = () => uuidv7();
const loose = (code: string) => code.replace(/-/g, "").toLowerCase();

let kit: Kit;
let sales: AuthContext;
let wh: AuthContext;
let whRvs: AuthContext;
let mgr: AuthContext;
let mgrRvs: AuthContext;
let productId: string;
let fg01: string;
const spare: { id: string; containerNumber: string }[] = [];
let pickId: string;
let shipmentId: string;
let picked: string[] = [];

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  sales = await asUser(kit, "sales@bryels-care.test", "sales_cs", [kit.nfd]);
  wh = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
  whRvs = await asUser(kit, "warehouse.rvs@bryels-care.test", "warehouse_operator", [kit.rvs]);
  mgr = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  mgrRvs = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.rvs]);
  const [p] = await db.insert(products).values({ organizationId: kit.orgId, skuCode: "TST-TYP-01", name: "Test Calamansi Bar 135 g (fictional)", family: "Soap", unitNetMassG: "135", unitsPerBox: 24 }).returning();
  productId = p.id;
  fg01 = (await loc(kit.nfd.id, "FG-01")).id;
  const expires = new Date(Date.now() + 600 * 86_400_000).toISOString().slice(0, 10);
  const [l] = await db.insert(inventoryLots).values({ organizationId: kit.orgId, siteId: kit.nfd.id, lotNumber: `L-TYP-${uuidv7().slice(-6).toUpperCase()}`, itemKind: "product", productId, expiresOn: expires, manufacturedOn: manilaToday(), qualityStatus: "released", baseUom: "pcs" }).returning();
  await db.transaction((tx) => postMovement(tx, mgr, { movementType: "receipt", lotId: l.id, toLocationId: fg01, qtyBase: "96", sourceDocumentType: "test_fixture" }));
  for (let i = 0; i < 4; i++) spare.push(await createBox(wh, { lotId: l.id, locationId: fg01, qty: "24", idempotencyKey: uuidv7() }));
  const [c] = await db.select().from(customers).where(eq(customers.code, "CUS-002"));
  const o = await createOrder(sales, { customerId: c.id, requestedDeliveryOn: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10), lines: [{ productId, qtyUnits: "48", unitPrice: "70" }] });
  await confirmOrder(sales, o.id);
  await allocateOrder(wh, o.id);
  ({ pickId, shipmentId } = await startPick(wh, o.id, { idempotencyKey: key() }));
  picked = (await getPick(wh, pickId)).rows.filter((r) => r.boxNumber).map((r) => r.boxNumber!);
  expect(picked).toHaveLength(2);
}, 180_000);

describe("picking: a typed box number is taken and recorded as typed", () => {
  it("typed (small letters, no dashes) picks the box with entry_mode typed and the typed text as evidence", async () => {
    const r = await scanPick(wh, pickId, { payload: loose(picked[0]), via: "typed", idempotencyKey: key() });
    expect(r.outcome).toBe("picked");
    const [line] = await db.select().from(pickLines).where(and(eq(pickLines.pickId, pickId), eq(pickLines.entryMode, "typed")));
    expect(line.scanPayload).toBe(loose(picked[0]));
    const [au] = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, pickId), eq(auditEvents.action, "sales.pick.scanned")));
    expect((au.after as { via: string }).via).toBe("typed");
  });

  it("a typed number that is not on the order is refused in plain words; a tap needs a reason and is saved as by hand", async () => {
    const e = await expectCode(scanPick(wh, pickId, { payload: "BX-99999999", via: "typed", idempotencyKey: key() }), "conflict");
    expect(e.message).toMatch(/not on this order/);
    await expectCode(scanPick(wh, pickId, { payload: `BC:BOX:${picked[1]}`, via: "tap", idempotencyKey: key() }), "validation");
    await scanPick(wh, pickId, { payload: `BC:BOX:${picked[1]}`, via: "tap", manualEntryReason: "Label would not scan: tapped in the list", idempotencyKey: key() });
    const modes = (await db.select().from(pickLines).where(eq(pickLines.pickId, pickId))).map((l) => l.entryMode).sort();
    expect(modes).toEqual(["manual", "typed"]);
    await completePick(wh, pickId, {});
  });
});

describe("second check of the box: typing the box number counts as the check", () => {
  it("typed box number is checked and recorded with entry_mode typed", async () => {
    const r = await scanPackVerification(mgr, shipmentId, { payload: loose(picked[0]), via: "typed", idempotencyKey: key() });
    expect(r.outcome).toBe("verified");
    const [pack] = await db.select().from(packs).where(eq(packs.shipmentId, shipmentId));
    const ok = await db.select().from(packVerificationScans).where(and(eq(packVerificationScans.packId, pack.id), eq(packVerificationScans.result, "ok")));
    expect(ok.map((x) => x.entryMode)).toEqual(["typed"]);
  });

  it("a tap from the list is refused; a scan still works and stays a scan", async () => {
    const e = await expectCode(scanPackVerification(mgr, shipmentId, { payload: `BC:BOX:${picked[1]}`, via: "tap", idempotencyKey: key() }), "validation");
    expect(e.details?.code).toBe("TAP_NOT_A_CHECK");
    expect(e.message).toMatch(/does not count as a check/);
  });

  it("a typed number that is not on the order, a box of another order and another site are refused", async () => {
    const e1 = await expectCode(scanPackVerification(mgr, shipmentId, { payload: "BX-99999999", via: "typed", idempotencyKey: key() }), "conflict");
    expect(e1.message).toBe("That number is not on this order. Check the label and type it again.");
    const notPicked = spare.find((b) => !picked.includes(b.containerNumber))!;
    const e2 = await expectCode(scanPackVerification(mgr, shipmentId, { payload: notPicked.containerNumber, via: "typed", idempotencyKey: key() }), "conflict");
    expect(e2.details?.code).toBe("NOT_ON_PICK_LIST");
    await expectCode(scanPackVerification(mgrRvs, shipmentId, { payload: picked[1], via: "typed", idempotencyKey: key() }), "not_found");
    // Refusals are kept as evidence with how they were read.
    const [pack] = await db.select().from(packs).where(eq(packs.shipmentId, shipmentId));
    const refused = await db.select().from(packVerificationScans).where(and(eq(packVerificationScans.packId, pack.id), eq(packVerificationScans.result, "unknown_box")));
    expect(refused.some((x) => x.entryMode === "typed")).toBe(true);
    const r = await scanPackVerification(mgr, shipmentId, { payload: `BC:BOX:${picked[1]}`, via: "scan", idempotencyKey: key() });
    expect(r.outcome).toBe("verified");
  });
});

describe("label verification: a typed label number is recorded as typed", () => {
  it("typed box number verifies with entry_mode typed; tap and other site are refused", async () => {
    const box = spare.find((b) => !picked.includes(b.containerNumber))!;
    await expectCode(verifyLabelScan(wh, { locationId: fg01, scan: `BC:BOX:${box.containerNumber}`, via: "tap" }), "validation");
    const r = await verifyLabelScan(wh, { locationId: fg01, scan: loose(box.containerNumber), via: "typed" });
    expect(r).toMatchObject({ status: "verified", kind: "box", number: box.containerNumber });
    const [row] = await db.select().from(labelVerifications).where(eq(labelVerifications.containerId, box.id));
    expect(row.entryMode).toBe("typed");
    expect(row.scanPayload).toBe(`BC:BOX:${box.containerNumber}`);
    const rvsFg = await loc(kit.rvs.id, "FG-01");
    await expectCode(verifyLabelScan(whRvs, { locationId: rvsFg.id, scan: box.containerNumber, via: "typed" }), "not_found");
    await expectCode(verifyLabelScan(wh, { locationId: fg01, scan: "BX-99999999", via: "typed" }), "not_found");
  });
});

describe("put-away and the ScanOrPick resolver: a typed shelf code", () => {
  it("resolvePickRef finds a shelf, box and lot typed without dashes; another site's number is not found", async () => {
    expect((await resolvePickRef(wh, "location", "a01")).code).toBe("A-01");
    expect((await resolvePickRef(wh, "container", loose(spare[3].containerNumber))).code).toBe(spare[3].containerNumber);
    const rcv = await loc(kit.nfd.id, "RCV");
    const lot = await makeLot(mgr, kit.nfd.id, rcv.id, "5000");
    expect((await resolvePickRef(wh, "lot", loose(lot.lotNumber))).value).toBe(lot.id);
    await expectCode(resolvePickRef(whRvs, "lot", loose(lot.lotNumber)), "not_found");
  });

  it("the put-away records the shelf as typed in the movement", async () => {
    const rcv = await loc(kit.nfd.id, "RCV");
    const a01 = await loc(kit.nfd.id, "A-01");
    const lot = await makeLot(mgr, kit.nfd.id, rcv.id, "5000");
    const shelf = await resolvePickRef(wh, "location", "a-01");
    const r = await putAwayLot(wh, { lotRef: lot.id, locationRef: shelf.value, locationVia: "typed", idempotencyKey: randomUUID() });
    expect(r.toCode).toBe("A-01");
    const [m] = await db.select().from(stockMovements).where(and(eq(stockMovements.lotId, lot.id), eq(stockMovements.toLocationId, a01.id)));
    expect((m.meta as { locationVia: string }).locationVia).toBe("typed");
  });
});

describe("counting: a typed lot number", () => {
  it("findLotForCount takes the lot number without dashes; another site's lot is not found; the count records lotVia typed", async () => {
    const b01 = await loc(kit.nfd.id, "B-01");
    const lot = await makeLot(mgr, kit.nfd.id, b01.id, "2000");
    const rvsLot = await makeLot(mgrRvs, kit.rvs.id, (await loc(kit.rvs.id, "FG-01")).id, "10");
    const c = await createCount(mgr, { countKind: "cycle", isBlind: true, locationIds: [b01.id], counterUserIds: [wh.userId] });
    await releaseCount(mgr, c.id);
    const found = await findLotForCount(wh, c.id, loose(lot.lotNumber));
    expect(found?.id).toBe(lot.id);
    expect(await findLotForCount(wh, c.id, rvsLot.lotNumber)).toBeNull();
    await recordCount(wh, { countId: c.id, locationId: b01.id, lotId: found!.id, qty: "2000", lotVia: "typed", idempotencyKey: key() });
    const [au] = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, c.id), eq(auditEvents.action, "inventory.stock_count.line_counted")));
    expect((au.after as { lotVia: string }).lotVia).toBe("typed");
  });
});
