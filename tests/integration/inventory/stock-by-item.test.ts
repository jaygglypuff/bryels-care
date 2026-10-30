/**
 * Stock by item (owner review 2026-10-30): the stock screen shows ONE row per material/product at the
 * current site with usable quantity, worst status in plain words and nearest expiry; expired / rejected /
 * recalled lots go to a separate "Do not use" group. Words search (AND) over item name, code, lot number
 * and supplier lot. Cross-site negative (another site's lots never appear) and role negative.
 */
import { beforeAll, describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { and, eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { db } from "@/db/client";
import { inventoryLots, locations, materialReorderPolicies, materials } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { stockByItem, type StockByItemResult } from "@/modules/inventory";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, type Kit, loadKit, loc, makeLot } from "../../support/kit";

let kit: Kit;
let wh: AuthContext;
let whRvs: AuthContext;
let owner: AuthContext;
let finance: AuthContext;
let mat: typeof materials.$inferSelect;
const lotIds: Record<string, string> = {};
let rvsLotId: string;

const ids = (r: StockByItemResult) => [...r.items, ...r.doNotUse].flatMap((i) => i.lots.map((l) => l.lotId));
const row = (r: StockByItemResult) => r.items.find((i) => i.id === mat.id);

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  wh = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
  whRvs = await asUser(kit, "warehouse.rvs@bryels-care.test", "warehouse_operator", [kit.rvs]);
  owner = await asUser(kit, "owner@bryels-care.test", "owner_director", [kit.rvs, kit.nfd]); // current site RVS
  finance = await asUser(kit, "finance@bryels-care.test", "finance", [kit.nfd]);
  // A fresh fictional material so totals are exact and independent of the demo seed.
  const code = `TST-SBI-${uuidv7().slice(-6)}`;
  [mat] = await db.insert(materials).values({ organizationId: kit.orgId, code, name: "Calamansi Peel Extract (fictional test)", baseUom: "g" }).returning();
  const a01 = await loc(kit.nfd.id, "A-01");
  const mk = async (key: string, qty: string, status: string, expiresOn: string | null) => {
    const lot = await makeLot(wh, kit.nfd.id, a01.id, qty, { status: "released", expiresOn, materialCode: code });
    if (status !== "released") await db.update(inventoryLots).set({ qualityStatus: status }).where(eq(inventoryLots.id, lot.id));
    lotIds[key] = lot.id;
    return lot;
  };
  await mk("ok1", "1000.1", "released", "2030-06-30");
  await mk("ok2", "2000.2", "released", "2030-01-31");
  await mk("waiting", "500", "quarantine", "2031-01-01");
  await mk("hold", "250", "on_hold", "2031-02-01");
  await mk("pastDate", "300", "released", "2020-01-01");
  await mk("rejected", "40", "rejected", "2031-03-01");
  await db.update(inventoryLots).set({ supplierLotNumber: "ZQX-77812" }).where(eq(inventoryLots.id, lotIds.ok1));
  // The same material at RVS: must never show for an NFD-only or NFD-current caller.
  const [rvsLoc] = await db.select().from(locations).where(and(eq(locations.siteId, kit.rvs.id), eq(locations.kind, "storage"))).limit(1);
  rvsLotId = (await makeLot(whRvs, kit.rvs.id, rvsLoc.id, "777", { materialCode: code })).id;
}, 240_000);

describe("stockByItem", () => {
  it("one row per item; usable quantity is decimal-exact; worst status; lots earliest expiry first", async () => {
    const r = await stockByItem(wh, { kind: "material" });
    const rows = r.items.filter((i) => i.id === mat.id);
    expect(rows).toHaveLength(1);
    const x = rows[0];
    expect(new Decimal(x.usable).eq("3000.3")).toBe(true);
    expect(x.usableText).toBe("3 kg"); // 3000.3 g → 3.0003 kg, two decimals
    expect(x.waitingText).toBe("500 g");
    expect(x.onHoldText).toBe("250 g");
    expect(x.state).toBe("on_hold");
    expect(x.lots.map((l) => l.lotId)).toEqual([lotIds.ok2, lotIds.ok1, lotIds.waiting, lotIds.hold]);
    expect(x.nearestExpiry).toBe("2030-01-31");
    expect(x.name).toMatch(/^Calamansi/);
  });

  it("expired (by date or status) and rejected lots go to the separate Do not use group, never in the main row", async () => {
    const r = await stockByItem(wh, { kind: "material" });
    expect(row(r)!.lots.some((l) => l.lotId === lotIds.pastDate || l.lotId === lotIds.rejected)).toBe(false);
    const bad = r.doNotUse.find((i) => i.id === mat.id)!;
    expect(bad.lots.map((l) => l.lotId).sort()).toEqual([lotIds.pastDate, lotIds.rejected].sort());
    expect(bad.state).toBe("rejected");
    expect(bad.lots.find((l) => l.lotId === lotIds.pastDate)!.state).toBe("expired");
    expect(bad.totalText).toBe("340 g");
  });

  it("status chips filter at lot level", async () => {
    const waiting = await stockByItem(wh, { kind: "material", status: "waiting" });
    expect(row(waiting)!.lots.map((l) => l.lotId)).toEqual([lotIds.waiting]);
    expect(waiting.doNotUse).toEqual([]);
    const ok = await stockByItem(wh, { kind: "material", status: "ok" });
    expect(row(ok)!.lots.map((l) => l.lotId).sort()).toEqual([lotIds.ok1, lotIds.ok2].sort());
    expect(row(ok)!.state).toBe("ok");
    const hold = await stockByItem(wh, { kind: "material", status: "on_hold" });
    expect(row(hold)!.state).toBe("on_hold");
    const dnu = await stockByItem(wh, { kind: "material", status: "do_not_use" });
    expect(dnu.items).toEqual([]);
    expect(dnu.doNotUse.some((i) => i.id === mat.id)).toBe(true);
    expect(ok.counts.ok).toBeGreaterThan(0);
    expect(ok.counts.all).toBeGreaterThanOrEqual(ok.counts.ok);
  });

  it("words search: any case, every word must match name, code, lot number or supplier lot", async () => {
    expect(row(await stockByItem(wh, { q: "  CALAMANSI peel " }))).toBeTruthy();
    expect(row(await stockByItem(wh, { q: "calamansi zzzz" }))).toBeUndefined();
    const bySupplierLot = await stockByItem(wh, { q: "zqx-778" });
    expect(row(bySupplierLot)!.lots.map((l) => l.lotId)).toEqual([lotIds.ok1]);
    const [lot] = await db.select().from(inventoryLots).where(eq(inventoryLots.id, lotIds.waiting));
    expect(row(await stockByItem(wh, { q: lot.lotNumber.toLowerCase() }))!.lots.map((l) => l.lotId)).toEqual([lotIds.waiting]);
    expect(row(await stockByItem(wh, { q: mat.code.toLowerCase() }))).toBeTruthy();
    // LIKE wildcards are plain characters, not "match everything".
    expect((await stockByItem(wh, { q: "%%" })).items.length).toBeGreaterThan(0);
  });

  it("low stock: below the owner's minimum flags the row and the Low stock chip lists it", async () => {
    await db.insert(materialReorderPolicies).values({ organizationId: kit.orgId, siteId: kit.nfd.id, materialId: mat.id, minStockBase: "5000", updatedBy: wh.userId });
    const r = await stockByItem(wh, { kind: "material" });
    expect(row(r)!.low).toBe(true);
    expect(row(r)!.minimumText).toBe("5 kg");
    const low = await stockByItem(wh, { kind: "material", status: "low" });
    expect(low.items.some((i) => i.id === mat.id)).toBe(true);
    expect(low.items.every((i) => i.low && i.state === "low")).toBe(true);
    expect(low.doNotUse).toEqual([]);
    expect(low.counts.low).toBeGreaterThan(0);
  });

  it("cross-site: an RVS caller sees only the RVS lot; a two-site owner sees only the current site", async () => {
    const rvs = await stockByItem(whRvs, { q: mat.code });
    expect(ids(rvs)).toEqual([rvsLotId]);
    expect(row(rvs)!.usableText).toBe("777 g");
    const own = await stockByItem(owner, { q: mat.code });
    expect(ids(own)).toEqual([rvsLotId]);
    const nfd = await stockByItem(wh, { q: mat.code });
    expect(ids(nfd)).not.toContain(rvsLotId);
  });

  it("role negative: without inventory.lot.view the read model refuses", async () => {
    expect(finance.can("inventory.lot.view")).toBe(false);
    await expectCode(stockByItem(finance, {}), "forbidden");
  });
});
