/**
 * Usability test 2026-10-30 (units): move, count and adjustment quantities typed in kg/L ("20 kg", or
 * 20 with the unit picker on kg) are converted to the lot's base unit on the SERVER with decimal.js;
 * unknown units and units of another kind are refused; migration-only adjustment reasons need
 * inventory.balance.admin.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { stockAdjustmentLines, stockCountEntries } from "@/db/schema";
import { createAdjustment } from "@/modules/inventory/adjustments";
import { createCount, recordCount, releaseCount } from "@/modules/inventory/counts";
import { scanMove } from "@/modules/inventory/moves";
import { resetTestDatabase } from "../../support/db";
import { expectDomain, key, loadWorld, loc, makeLot, onHand, type World } from "./w1c-fixtures";

let w: World;

beforeAll(async () => {
  await resetTestDatabase();
  w = await loadWorld();
});

describe("warehouse units (server-side conversion)", () => {
  it("scan-move: 20 kg of a gram lot moves 20,000 g; '20 kg' typed in the box works the same", async () => {
    const lot = await makeLot(w.owner, { siteId: w.nfd.id, locCode: "B-01", materialCode: "MAT-0061", qty: "60000" });
    expect(lot.baseUom).toBe("g");
    const b01 = await loc(w.nfd.id, "B-01");
    const b02 = await loc(w.nfd.id, "A-01");
    await scanMove(w.wh, { idempotencyKey: key(), source: { kind: "lot", lotId: lot.id, fromLocationId: b01.id, qty: "20", qtyUom: "kg" }, toLocationId: b02.id });
    expect(await onHand(lot.id, b02.id)).toBe("20000");
    await scanMove(w.wh, { idempotencyKey: key(), source: { kind: "lot", lotId: lot.id, fromLocationId: b01.id, qty: "0.5 kg" }, toLocationId: b02.id });
    expect(await onHand(lot.id, b02.id)).toBe("20500");
    expect(await onHand(lot.id, b01.id)).toBe("39500");
  });

  it("scan-move refuses an unknown unit and a unit of another kind, and says how much is loose in kg", async () => {
    const lot = await makeLot(w.owner, { siteId: w.nfd.id, locCode: "B-01", materialCode: "MAT-0061", qty: "1000" });
    const b01 = await loc(w.nfd.id, "B-01");
    const b02 = await loc(w.nfd.id, "A-01");
    await expectDomain(scanMove(w.wh, { idempotencyKey: key(), source: { kind: "lot", lotId: lot.id, fromLocationId: b01.id, qty: "2", qtyUom: "sacks" }, toLocationId: b02.id }), "validation");
    await expectDomain(scanMove(w.wh, { idempotencyKey: key(), source: { kind: "lot", lotId: lot.id, fromLocationId: b01.id, qty: "2", qtyUom: "L" }, toLocationId: b02.id }), "validation");
    const e = await scanMove(w.wh, { idempotencyKey: key(), source: { kind: "lot", lotId: lot.id, fromLocationId: b01.id, qty: "2", qtyUom: "kg" }, toLocationId: b02.id }).catch((x) => x);
    expect(e.code).toBe("insufficient_stock");
    expect(e.message).toContain("1 kg");
    expect(await onHand(lot.id, b01.id)).toBe("1000");
  });

  it("count: a count typed in kg is stored in g; an unknown unit is refused", async () => {
    const l = await loc(w.nfd.id, "A-02");
    const lot = await makeLot(w.owner, { siteId: w.nfd.id, locCode: "A-02", materialCode: "MAT-0061", qty: "25000" });
    const c = await createCount(w.manager, { countKind: "cycle", isBlind: true, locationIds: [l.id], counterUserIds: [w.wh.userId] });
    await releaseCount(w.manager, c.id);
    await expectDomain(recordCount(w.wh, { countId: c.id, locationId: l.id, lotId: lot.id, qty: "24", qtyUom: "buckets", idempotencyKey: key() }), "validation");
    const r = await recordCount(w.wh, { countId: c.id, locationId: l.id, lotId: lot.id, qty: "24.5", qtyUom: "kg", idempotencyKey: key() });
    const [entry] = await db.select().from(stockCountEntries).where(eq(stockCountEntries.id, r.entryId));
    expect(String(Number(entry.qtyBase))).toBe("24500");
    const r2 = await recordCount(w.wh, { countId: c.id, locationId: l.id, lotId: lot.id, qty: "25 kg", idempotencyKey: key() });
    const [e2] = await db.select().from(stockCountEntries).where(eq(stockCountEntries.id, r2.entryId));
    expect(String(Number(e2.qtyBase))).toBe("25000");
  });

  it("adjustment: 2 kg taken away is stored as 2,000 g; a unit of another kind is refused", async () => {
    const lot = await makeLot(w.owner, { siteId: w.nfd.id, locCode: "B-01", materialCode: "MAT-0061", qty: "5000" });
    const b01 = await loc(w.nfd.id, "B-01");
    const a = await createAdjustment(w.wh, { reasonCode: "damaged", lines: [{ lotId: lot.id, locationId: b01.id, direction: "decrease", qty: "2", qtyUom: "kg" }], idempotencyKey: key() });
    const [line] = await db.select().from(stockAdjustmentLines).where(eq(stockAdjustmentLines.stockAdjustmentId, a.id));
    expect(String(Number(line.qtyBase))).toBe("2000");
    await expectDomain(createAdjustment(w.wh, { reasonCode: "damaged", lines: [{ lotId: lot.id, locationId: b01.id, direction: "decrease", qty: "2", qtyUom: "pcs" }], idempotencyKey: key() }), "validation");
    // More than is there, in kg: refused with the amount in kg.
    const e = await createAdjustment(w.wh, { reasonCode: "lost", lines: [{ lotId: lot.id, locationId: b01.id, direction: "decrease", qty: "6 kg" }], idempotencyKey: key() }).catch((x) => x);
    expect(e.code).toBe("insufficient_stock");
    expect(e.message).toContain("5 kg");
  });

  it("migration-only reasons are refused for a warehouse operator and accepted for a site manager (inventory.balance.admin)", async () => {
    const lot = await makeLot(w.owner, { siteId: w.nfd.id, locCode: "B-01", materialCode: "MAT-0061", qty: "5000" });
    const b01 = await loc(w.nfd.id, "B-01");
    for (const reasonCode of ["opening_balance", "data_correction"]) {
      await expectDomain(createAdjustment(w.wh, { reasonCode, reasonNote: "test", lines: [{ lotId: lot.id, locationId: b01.id, direction: "increase", qty: "1" }], idempotencyKey: key() }), "forbidden");
    }
    const ok = await createAdjustment(w.manager, { reasonCode: "data_correction", reasonNote: "migration fix", lines: [{ lotId: lot.id, locationId: b01.id, direction: "increase", qty: "1" }], idempotencyKey: key() });
    expect(ok.id).toBeTruthy();
  });
});
