/**
 * Item page read model (owner question 2026-10-30: "Palm oil has different lots: how much in total, from
 * which suppliers and brands, and what expires?"). getItemStock: totals equal the sum of the lots by status;
 * the supplier/brand split adds up to the total; 30/60/90-day expiry buckets with a fixed business date;
 * set aside (reservations) only on ready stock; where it is; lots in the order to use them; movements as
 * sentences. Cross-site negative (another site's lots never counted unless "All my sites" is allowed) and
 * role negative (no inventory.lot.view → forbidden).
 */
import { beforeAll, describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { and, eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { db } from "@/db/client";
import { inventoryLots, locations, materialReorderPolicies, materials, products, stockReservations } from "@/db/schema";
import { AuthContext } from "@/lib/auth/context";
import { getItemStock, movementSentence, postMovement, type ItemStock } from "@/modules/inventory";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, type Kit, loadKit, loc, makeLot } from "../../support/kit";

const AS_OF = "2030-01-01";
const plus = (n: number) => new Date(Date.parse(`${AS_OF}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

let kit: Kit;
let wh: AuthContext;
let whRvs: AuthContext;
let owner: AuthContext;
let finance: AuthContext;
let mat: typeof materials.$inferSelect;
const lot: Record<string, string> = {};
let rvsLotId: string;

const D = (s: Decimal.Value) => new Decimal(s);
const sumQty = (xs: { qty: string }[]) => xs.reduce((t, x) => t.plus(x.qty), new Decimal(0));

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  wh = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
  whRvs = await asUser(kit, "warehouse.rvs@bryels-care.test", "warehouse_operator", [kit.rvs]);
  owner = await asUser(kit, "owner@bryels-care.test", "owner_director", [kit.rvs, kit.nfd]); // current site RVS
  finance = await asUser(kit, "finance@bryels-care.test", "finance", [kit.nfd]);
  const code = `TST-ITM-${uuidv7().slice(-6)}`;
  [mat] = await db.insert(materials).values({ organizationId: kit.orgId, code, name: "Sampaguita Butter (fictional test)", baseUom: "g", shelfLifeDays: 540 }).returning();
  const a01 = await loc(kit.nfd.id, "A-01");
  const a02 = await loc(kit.nfd.id, "A-02");
  const mk = async (key: string, qty: string, status: string, expiresOn: string | null, supplierName: string | null, brand: string | null) => {
    const l = await makeLot(wh, kit.nfd.id, a01.id, qty, { status: "released", expiresOn, materialCode: code });
    await db.update(inventoryLots).set({ qualityStatus: status, supplierName, brand }).where(eq(inventoryLots.id, l.id));
    lot[key] = l.id;
  };
  await mk("d30", "1000", "released", plus(10), "Laguna Oleo (fictional)", "Sunny Leaf");
  await mk("d60", "2000.5", "released", plus(45), "Laguna Oleo (fictional)", "Sunny Leaf");
  await mk("d90", "500", "quarantine", plus(80), "Mindanao Fats (fictional)", "Golden Bud");
  await mk("hold", "250", "on_hold", plus(200), "Mindanao Fats (fictional)", null);
  await mk("expired", "300", "released", plus(-5), "Laguna Oleo (fictional)", "Sunny Leaf");
  await mk("rejected", "40", "rejected", plus(300), null, null);
  // A second place for the d60 lot: 499.5 g more at A-02.
  await db.transaction((tx) => postMovement(tx, wh, { movementType: "receipt", lotId: lot.d60, toLocationId: a02.id, qtyBase: "499.5", sourceDocumentType: "test_fixture" }));
  // 200 g of the 30-day lot is set aside for a batch.
  await db.insert(stockReservations).values({ organizationId: kit.orgId, siteId: kit.nfd.id, reservationNumber: `RSV-T-${uuidv7().slice(-8)}`, lotId: lot.d30, locationId: a01.id, qtyBase: "200", baseUom: "g", demandType: "manual", demandReference: "test hold", createdBy: wh.userId });
  // Set aside on a waiting lot never reduces "free to use" (it is not ready anyway).
  await db.insert(stockReservations).values({ organizationId: kit.orgId, siteId: kit.nfd.id, reservationNumber: `RSV-T-${uuidv7().slice(-8)}`, lotId: lot.d90, locationId: a01.id, qtyBase: "100", baseUom: "g", demandType: "manual", demandReference: "test hold", createdBy: wh.userId });
  // The same material at RVS.
  const [rvsLoc] = await db.select().from(locations).where(and(eq(locations.siteId, kit.rvs.id), eq(locations.kind, "storage"))).limit(1);
  rvsLotId = (await makeLot(whRvs, kit.rvs.id, rvsLoc.id, "777", { materialCode: code, expiresOn: plus(400) })).id;
  await db.insert(materialReorderPolicies).values({ organizationId: kit.orgId, siteId: kit.nfd.id, materialId: mat.id, minStockBase: "10000", updatedBy: wh.userId });
}, 240_000);

describe("getItemStock", () => {
  let r: ItemStock;
  beforeAll(async () => {
    r = await getItemStock(wh, { kind: "material", id: mat.id, asOf: AS_OF });
  });

  it("header: name, code, unit, shelf life, minimum and below-minimum flag", () => {
    expect(r.item.name).toMatch(/^Sampaguita/);
    expect(r.item.unit).toBe("g");
    expect(r.item.shelfLifeDays).toBe(540);
    expect(r.minimum?.text).toBe("10 kg");
    expect(r.belowMinimum).toBe(true);
    expect(r.scope.all).toBe(false);
  });

  it("totals equal the sum of the lots' balances by status (decimal-exact)", () => {
    expect(r.lots).toHaveLength(6);
    expect(D(r.totals.inStock.qty).eq(sumQty(r.lots))).toBe(true);
    expect(r.totals.inStock.qty).toBe("4590");
    expect(r.totals.ready.qty).toBe("3500"); // 1000 + 2000.5 + 499.5
    expect(r.totals.waiting.qty).toBe("500");
    expect(r.totals.onHold.qty).toBe("250");
    expect(r.totals.doNotUse.qty).toBe("340"); // expired by date 300 + rejected 40
    expect(r.totals.expired.qty).toBe("300");
    expect(r.totals.bad.qty).toBe("40");
    expect(r.totals.promised.qty).toBe("0"); // a manual reservation is set aside, not promised to a customer
    expect(r.orders).toBeNull(); // materials have no customer orders
    expect(D(r.totals.ready.qty).plus(r.totals.waiting.qty).plus(r.totals.onHold.qty).plus(r.totals.doNotUse.qty).eq(r.totals.inStock.qty)).toBe(true);
    expect(r.totals.ready.text).toBe("3.5 kg");
    expect(r.totals.setAside.qty).toBe("200");
    expect(r.totals.free.qty).toBe("3300");
    expect(r.totals.expiringSoon.qty).toBe("1000");
  });

  it("supplier and brand split adds up to the total", () => {
    expect(D(sumQty(r.bySupplier.map((s) => s.total))).eq(r.totals.inStock.qty)).toBe(true);
    expect(D(sumQty(r.bySupplier.map((s) => s.ready))).eq(r.totals.ready.qty)).toBe(true);
    const sunny = r.bySupplier.find((s) => s.brand === "Sunny Leaf")!;
    expect(sunny.supplierName).toBe("Laguna Oleo (fictional)");
    expect(sunny.lots).toBe(3);
    expect(sunny.ready.qty).toBe("3500");
    expect(sunny.doNotUse.qty).toBe("300");
    expect(sunny.nearestExpiry).toBe(plus(10)); // nearest usable expiry, not the expired lot
    const golden = r.bySupplier.find((s) => s.brand === "Golden Bud")!;
    expect(golden.waiting.qty).toBe("500");
    const mindanaoNoBrand = r.bySupplier.find((s) => s.supplierName === "Mindanao Fats (fictional)" && s.brand === null)!;
    expect(mindanaoNoBrand.onHold.qty).toBe("250");
    expect(r.bySupplier.find((s) => s.supplierName === null)!.total.qty).toBe("40");
  });

  it("totals per supplier and per brand each add up to the total", () => {
    expect(D(sumQty(r.bySupplierTotal.map((s) => s.total))).eq(r.totals.inStock.qty)).toBe(true);
    expect(D(sumQty(r.byBrandTotal.map((s) => s.total))).eq(r.totals.inStock.qty)).toBe(true);
    expect(r.bySupplierTotal.find((s) => s.name === "Laguna Oleo (fictional)")!.total.qty).toBe("3800");
    expect(r.byBrandTotal.find((s) => s.name === "Sunny Leaf")!.lots).toBe(3);
    expect(r.byBrandTotal.find((s) => s.name === null)!.total.qty).toBe("290"); // 250 on hold + 40 rejected
  });

  it("products: by batch; customer orders not yet set aside and free to sell, only with sales.sales_order.view", async () => {
    const [p] = await db.select().from(products).where(eq(products.skuCode, "ACS-135"));
    expect(owner.can("sales.sales_order.view")).toBe(true);
    const x = await getItemStock(owner, { kind: "product", id: p.id, all: true, asOf: AS_OF });
    expect(x.bySupplierTotal).toEqual([]);
    expect(x.orders).not.toBeNull();
    expect(D(x.totals.free.qty).eq(D(x.totals.ready.qty).minus(x.totals.setAside.qty))).toBe(true);
    expect(D(x.orders!.freeToSell.qty).eq(Decimal.max(D(x.totals.free.qty).minus(x.orders!.notSetAside.qty), 0))).toBe(true);
    expect(D(x.totals.promised.qty).lte(x.totals.setAside.qty)).toBe(true);
    const viewOnly = new AuthContext(wh.userId, kit.orgId, wh.displayName, wh.email, ["custom"], new Set(["inventory.lot.view"]), [kit.nfd], kit.nfd.id);
    expect((await getItemStock(viewOnly, { kind: "product", id: p.id, asOf: AS_OF })).orders).toBeNull();
  });

  it("expiry buckets with a fixed business date: 30 / 60 / 90 days and already expired", () => {
    const b = Object.fromEntries(r.expiring.map((x) => [x.key, x]));
    expect(b.d30.lots.map((l) => l.lotId)).toEqual([lot.d30]);
    expect(b.d30.lots[0].daysLeft).toBe(10);
    expect(b.d60.lots.map((l) => l.lotId)).toEqual([lot.d60]);
    expect(b.d60.total.qty).toBe("2500");
    expect(b.d90.lots.map((l) => l.lotId)).toEqual([lot.d90]);
    expect(b.expired.lots.map((l) => l.lotId)).toEqual([lot.expired]);
    expect(b.expired.lots[0].daysLeft).toBe(-5);
    // Rejected stock is "do not use", never "expiring".
    expect(r.expiring.flatMap((x) => x.lots).some((l) => l.lotId === lot.rejected)).toBe(false);
  });

  it("all lots: ready first, earliest expiry first; set aside only on ready lots; locations listed", () => {
    expect(r.lots.map((l) => l.lotId)).toEqual([lot.d30, lot.d60, lot.d90, lot.hold, lot.expired, lot.rejected]);
    expect(r.lots[0].setAside).toBe("200");
    expect(r.lots.find((l) => l.lotId === lot.d90)!.setAside).toBe("0");
    expect(r.lots[1].where).toMatch(/A-01.*\(2 kg\).*A-02.*\(499\.5 g\)/);
    expect(r.lots[1].qtyText).toBe("2.5 kg");
  });

  it("where it is: per section and location, adding up to the total", () => {
    expect(D(sumQty(r.places.map((p) => p.total))).eq(r.totals.inStock.qty)).toBe(true);
    const locs = r.places.flatMap((p) => p.locations);
    expect(locs.find((l) => l.code === "A-02")!.qty).toBe("499.5");
    expect(r.places[0].sectionLabel).toBe("Raw materials");
  });

  it("recent movements are plain sentences, newest first, at most 10", () => {
    expect(r.movements.length).toBeGreaterThan(0);
    expect(r.movements.length).toBeLessThanOrEqual(10);
    expect(r.movements.every((m) => m.sentence.length > 0)).toBe(true);
    expect(r.movements[0].sentence).toBe("Received 499.5 g from Laguna Oleo (fictional)");
  });

  it("movement sentences in plain words", () => {
    expect(movementSentence({ movementType: "receipt", qtyText: "25 kg", supplierName: "Laguna Oleo" })).toBe("Received 25 kg from Laguna Oleo");
    expect(movementSentence({ movementType: "consumption", qtyText: "3.7 kg", docType: "batch", docNumber: "B-26-0004" })).toBe("Used 3.7 kg in batch B-26-0004");
    expect(movementSentence({ movementType: "transfer", qtyText: "10 kg", toName: "A-01" })).toBe("Moved 10 kg to A-01");
  });

  it("cross-site: another site's lots are never counted on the current site", async () => {
    const nfd = await getItemStock(wh, { kind: "material", id: mat.id, asOf: AS_OF, all: true }); // one site only: "all" is ignored
    expect(nfd.scope.all).toBe(false);
    expect(nfd.lots.map((l) => l.lotId)).not.toContain(rvsLotId);
    const rvs = await getItemStock(whRvs, { kind: "material", id: mat.id, asOf: AS_OF });
    expect(rvs.lots.map((l) => l.lotId)).toEqual([rvsLotId]);
    expect(rvs.totals.inStock.qty).toBe("777");
    const ownerHere = await getItemStock(owner, { kind: "material", id: mat.id, asOf: AS_OF });
    expect(ownerHere.lots.map((l) => l.lotId)).toEqual([rvsLotId]);
    expect(ownerHere.movements.every((m) => m.lotId === rvsLotId)).toBe(true);
  });

  it("all my sites: a two-site owner may add both sites", async () => {
    const all = await getItemStock(owner, { kind: "material", id: mat.id, asOf: AS_OF, all: true });
    expect(all.scope.all).toBe(true);
    expect(all.totals.inStock.qty).toBe("5367"); // 4590 + 777
    expect(all.lots.find((l) => l.lotId === rvsLotId)!.siteCode).toBe(kit.rvs.code);
  });

  it("role negative and bad input", async () => {
    expect(finance.can("inventory.lot.view")).toBe(false);
    await expectCode(getItemStock(finance, { kind: "material", id: mat.id }), "forbidden");
    await expectCode(getItemStock(wh, { kind: "lot", id: mat.id }), "not_found");
    await expectCode(getItemStock(wh, { kind: "product", id: mat.id }), "not_found");
    await expectCode(getItemStock(wh, { kind: "material", id: "nope" }), "not_found");
  });
});
