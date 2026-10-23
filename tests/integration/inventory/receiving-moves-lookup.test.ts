import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, goodsReceiptLines, goodsReceipts, inventoryBalances, inventoryLots, locations, materials, organizations, sites, stockMovements, users } from "@/db/schema";
import { AuthContext, type SiteRef } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { ROLE_BUNDLES } from "@/lib/permissions";
import { getLotDetail, listLots } from "@/modules/inventory/lots";
import { resolveScan } from "@/modules/inventory/lookup";
import { transferStock } from "@/modules/inventory/movements";
import { postGoodsReceipt } from "@/modules/inventory/receiving";
import { resetTestDatabase } from "../../support/db";

let orgId: string;
let nfd: SiteRef;
let rvs: SiteRef;
let whNfd: AuthContext;
let whRvs: AuthContext;
let viewer: AuthContext;

const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

async function ctxFor(email: string, perms: readonly string[], siteList: SiteRef[]) {
  const [u] = await db.select().from(users).where(eq(users.email, email));
  return new AuthContext(u.id, orgId, u.displayName, u.email, ["test"], new Set(perms), siteList, siteList[0].id);
}
async function loc(siteId: string, code: string) {
  const [l] = await db.select().from(locations).where(and(eq(locations.siteId, siteId), eq(locations.code, code)));
  return l;
}
async function mat(code: string) {
  const [m] = await db.select().from(materials).where(eq(materials.code, code));
  return m;
}
async function onHand(lotId: string, locationId: string) {
  const [b] = await db.select().from(inventoryBalances).where(and(eq(inventoryBalances.lotId, lotId), eq(inventoryBalances.locationId, locationId)));
  return b?.qtyBase ?? "0";
}
async function expectDomain(p: Promise<unknown>, code: string) {
  const e = await p.then(() => null, (x) => x);
  expect(e).toBeInstanceOf(DomainError);
  expect((e as DomainError).code).toBe(code);
}

async function receiptInput(key = randomUUID()) {
  const coconut = await mat("MAT-0012");
  const wrapper = await mat("PKG-0101");
  return {
    idempotencyKey: key,
    supplierName: "Test Supplier (fictional)",
    supplierDocumentNumber: "DR-TEST-1",
    lines: [
      { materialId: coconut.id, qty: "25000", supplierLotNumber: "SUP-A", expiresOn: future(400), locationId: (await loc(nfd.id, "QUA-01")).id },
      { materialId: wrapper.id, qty: "500", supplierLotNumber: "SUP-B", manufacturedOn: future(-10), expiresOn: future(1000), locationId: (await loc(nfd.id, "RCV")).id },
    ],
  };
}

beforeAll(async () => {
  await resetTestDatabase();
  const [org] = await db.select().from(organizations);
  orgId = org.id;
  const all = await db.select({ id: sites.id, code: sites.code, name: sites.name }).from(sites);
  nfd = all.find((s) => s.code === "NFD")!;
  rvs = all.find((s) => s.code === "RVS")!;
  whNfd = await ctxFor("warehouse.nfd@bryels-care.test", ROLE_BUNDLES.warehouse_operator.permissions, [nfd]);
  whRvs = await ctxFor("warehouse.rvs@bryels-care.test", ROLE_BUNDLES.warehouse_operator.permissions, [rvs]);
  viewer = await ctxFor("auditor@bryels-care.test", ROLE_BUNDLES.auditor.permissions, [nfd, rvs]);
});

describe("goods receipt", () => {
  it("creates a receipt, quarantined lots, lines, receipt movements and one audit event in one go", async () => {
    const input = await receiptInput();
    const r = await postGoodsReceipt(whNfd, input);
    expect(r.replayed).toBe(false);
    expect(r.receiptNumber).toMatch(/^GR-\d{2}-\d{5}$/);
    const lines = await db.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.goodsReceiptId, r.receiptId));
    expect(lines).toHaveLength(2);
    for (const l of lines) {
      const [lot] = await db.select().from(inventoryLots).where(eq(inventoryLots.id, l.lotId!));
      expect(lot.qualityStatus).toBe("quarantine");
      expect(lot.siteId).toBe(nfd.id);
      expect(lot.lotNumber).toMatch(/^L-\d{4}-\d{5}$/);
      expect(await onHand(l.lotId!, l.locationId)).toBe(l.qtyBase);
    }
    const mv = await db.select().from(stockMovements).where(eq(stockMovements.sourceDocumentId, r.receiptId));
    expect(mv.map((m) => m.movementType)).toEqual(["receipt", "receipt"]);
    const ev = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, r.receiptId), eq(auditEvents.action, "procurement.goods_receipt.posted")));
    expect(ev).toHaveLength(1);
  });

  it("is idempotent: the same submission key never doubles stock, even when submitted concurrently", async () => {
    const input = await receiptInput();
    const [a, b] = await Promise.all([postGoodsReceipt(whNfd, input), postGoodsReceipt(whNfd, input)]);
    expect(a.receiptId).toBe(b.receiptId);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    const c = await postGoodsReceipt(whNfd, input);
    expect(c.receiptId).toBe(a.receiptId);
    const receipts = await db.select().from(goodsReceipts).where(eq(goodsReceipts.id, a.receiptId));
    expect(receipts).toHaveLength(1);
    const lines = await db.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.goodsReceiptId, a.receiptId));
    expect(lines).toHaveLength(2);
  });

  it("rejects expired material, fractional pieces and locations of another site", async () => {
    const base = await receiptInput();
    await expectDomain(postGoodsReceipt(whNfd, { ...base, lines: [{ ...base.lines[0], expiresOn: future(-1) }] }), "validation");
    await expectDomain(postGoodsReceipt(whNfd, { ...base, idempotencyKey: randomUUID(), lines: [{ ...base.lines[1], qty: "10.5" }] }), "validation");
    const rvsQua = await loc(rvs.id, "QUA-01");
    await expectDomain(postGoodsReceipt(whNfd, { ...base, idempotencyKey: randomUUID(), lines: [{ ...base.lines[0], locationId: rvsQua.id }] }), "validation");
  });

  it("refuses roles without inventory.receipt.post", async () => {
    await expectDomain(postGoodsReceipt(viewer, await receiptInput()), "forbidden");
  });
});

describe("stock transfer", () => {
  it("keeps quarantined lots in quarantine-type locations and posts an idempotent transfer", async () => {
    const r = await postGoodsReceipt(whNfd, await receiptInput());
    const [line] = await db
      .select()
      .from(goodsReceiptLines)
      .where(and(eq(goodsReceiptLines.goodsReceiptId, r.receiptId), eq(goodsReceiptLines.locationId, (await loc(nfd.id, "RCV")).id)));
    const rcv = await loc(nfd.id, "RCV");
    const qua = await loc(nfd.id, "QUA-01");
    const storage = await loc(nfd.id, "PKG-01");

    await expectDomain(
      transferStock(whNfd, { lotId: line.lotId!, fromLocationId: rcv.id, toLocationId: storage.id, qty: "100", reason: "put away", idempotencyKey: randomUUID() }),
      "blocked_lot",
    );
    const key = randomUUID();
    const t1 = await transferStock(whNfd, { lotId: line.lotId!, fromLocationId: rcv.id, toLocationId: qua.id, qty: "200", reason: "to cage", idempotencyKey: key });
    const t2 = await transferStock(whNfd, { lotId: line.lotId!, fromLocationId: rcv.id, toLocationId: qua.id, qty: "200", reason: "to cage", idempotencyKey: key });
    expect(t1.number).toMatch(/^MOV-\d{2}-\d{6}$/);
    expect(t2.replayed).toBe(true);
    expect(t2.movementId).toBe(t1.movementId);
    expect(await onHand(line.lotId!, rcv.id)).toBe("300.000000");
    expect(await onHand(line.lotId!, qua.id)).toBe("200.000000");
    const ev = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, t1.movementId), eq(auditEvents.action, "inventory.stock_movement.transferred")));
    expect(ev).toHaveLength(1);

    await expectDomain(
      transferStock(whNfd, { lotId: line.lotId!, fromLocationId: rcv.id, toLocationId: qua.id, qty: "301", reason: "too much", idempotencyKey: randomUUID() }),
      "insufficient_stock",
    );
    // Another site's warehouse operator cannot see or move it.
    await expectDomain(
      transferStock(whRvs, { lotId: line.lotId!, fromLocationId: rcv.id, toLocationId: qua.id, qty: "1", reason: "cross site", idempotencyKey: randomUUID() }),
      "not_found",
    );
  });
});

describe("site scope and look-up", () => {
  it("hides NFD lots from an RVS-only user in lists, detail and scans", async () => {
    const [nfdLot] = await db.select().from(inventoryLots).where(eq(inventoryLots.siteId, nfd.id)).limit(1);
    const rvsLots = await listLots(whRvs, { includeEmpty: true });
    expect(rvsLots.some((l) => l.id === nfdLot.id)).toBe(false);
    await expectDomain(getLotDetail(whRvs, nfdLot.id), "not_found");
    const scan = await resolveScan(whRvs, `BC:LOT:${nfdLot.lotNumber}`);
    expect(scan.ok).toBe(false);
  });

  it("resolves typed payloads, raw lot numbers and batch numbers within allowed sites", async () => {
    const [nfdLot] = await db.select().from(inventoryLots).where(eq(inventoryLots.siteId, nfd.id)).limit(1);
    expect(await resolveScan(whNfd, `BC:LOT:${nfdLot.lotNumber}`)).toMatchObject({ ok: true, href: `/inventory/${nfdLot.id}` });
    expect(await resolveScan(whNfd, ` ${nfdLot.lotNumber.toLowerCase()}\n`)).toMatchObject({ ok: true, href: `/inventory/${nfdLot.id}` });
    // Warehouse operators have no production.batch.view: a batch number is recognised but not opened.
    const b = await resolveScan(whNfd, "B-26-0001");
    expect(b.ok).toBe(false);
    const asViewer = await resolveScan(viewer, "B-26-0001");
    expect(asViewer).toMatchObject({ ok: true });
    expect((await resolveScan(whNfd, "NOPE-123")).ok).toBe(false);
    expect((await resolveScan(whNfd, "BC:BOX:C-1")).ok).toBe(false);
  });
});
