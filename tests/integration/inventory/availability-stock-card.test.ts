/**
 * US-2-05 (docs/testing.md §4.15, T-15): availability.formula (SQL = pure function, vocabulary
 * formula holds), availability.site_scoped, and the stock card (opening from the ledger, running
 * balance, reversal markers, closing compared with the projection).
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import { inventoryBalances, inventoryLots, products, salesOrderLines, salesOrders, stockAllocations, stockMovements, customers } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { availabilityRows, computeAvailability } from "@/modules/inventory/availability";
import { postMovement } from "@/modules/inventory/ledger";
import { transferStock } from "@/modules/inventory/movements";
import { reverseMovement } from "@/modules/inventory/reversal";
import { getStockCard } from "@/modules/inventory/stock-card";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, type Kit, loadKit, loc, makeLot } from "../../support/kit";

let kit: Kit;
let wh: AuthContext;
let whRvs: AuthContext;
let manager: AuthContext;
const AS_OF = "2027-01-15";

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  wh = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
  whRvs = await asUser(kit, "warehouse.rvs@bryels-care.test", "warehouse_operator", [kit.rvs]);
  manager = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
});

describe("availability.formula", () => {
  it("SQL and the pure function agree for lots covering every status, an allocation and an expiry on the as-of date", async () => {
    const a01 = await loc(kit.nfd.id, "A-01");
    const fixtures = [
      { status: "released", expiresOn: "2030-01-01", qty: "100" },
      { status: "released", expiresOn: AS_OF, qty: "40" }, // expires on the as-of day: still usable that day
      { status: "released", expiresOn: "2027-01-14", qty: "30" }, // past expiry by date
      { status: "quarantine", expiresOn: "2030-01-01", qty: "20" },
      { status: "on_hold", expiresOn: "2030-01-01", qty: "15" },
      { status: "expired", expiresOn: "2026-12-01", qty: "12" },
      { status: "recalled", expiresOn: "2030-01-01", qty: "9" },
      { status: "rejected", expiresOn: "2030-01-01", qty: "7" },
    ];
    const lots: { id: string }[] = [];
    for (const f of fixtures) {
      const lot = await makeLot(wh, kit.nfd.id, a01.id, f.qty, { status: "released", expiresOn: f.expiresOn });
      await db.update(inventoryLots).set({ qualityStatus: f.status }).where(eq(inventoryLots.id, lot.id));
      lots.push(lot);
    }
    // An open allocation of 25 on the first lot (sales order confirmed).
    const [cust] = await db.select().from(customers).limit(1);
    const [prod] = await db.select().from(products).limit(1);
    const [so] = await db
      .insert(salesOrders)
      .values({ organizationId: kit.orgId, siteId: kit.nfd.id, orderNumber: `SO-T-${randomUUID().slice(0, 6)}`, customerId: cust.id, status: "confirmed", createdBy: wh.userId })
      .returning();
    const [line] = await db.insert(salesOrderLines).values({ salesOrderId: so.id, lineNo: 1, productId: prod.id, qtyUnits: "25" }).returning();
    await db.insert(stockAllocations).values({ salesOrderLineId: line.id, lotId: lots[0].id, locationId: a01.id, qtyUnits: "25" });

    const rows = (await availabilityRows(wh, { siteId: kit.nfd.id, asOf: AS_OF })).filter((r) => lots.some((l) => l.id === r.lotId));
    expect(rows).toHaveLength(fixtures.length);
    const sum = (k: keyof (typeof rows)[number]) => rows.reduce((s, r) => s.plus(r[k] as string), new Decimal(0)).toString();
    const pure = computeAvailability(
      rows.map((r) => ({ qualityStatus: r.qualityStatus, expiresOn: r.expiresOn, onHand: r.onHand, reserved: r.reserved, allocated: new Decimal(r.allocated).plus(r.allocatedBlocked) })),
      AS_OF,
    );
    for (const k of ["onHand", "reserved", "allocated", "quarantined", "onHold", "expired", "recalled", "rejected", "available"] as const) expect(sum(k)).toBe(pure[k]);
    expect(pure).toMatchObject({ onHand: "233", allocated: "25", quarantined: "20", onHold: "15", expired: "42", recalled: "9", rejected: "7", available: "115" });
    const identity = new Decimal(pure.onHand).minus(pure.reserved).minus(pure.allocated).minus(pure.quarantined).minus(pure.onHold).minus(pure.expired).minus(pure.recalled).minus(pure.rejected);
    expect(identity.toString()).toBe(pure.available);
  });

  it("allocations on blocked stock are reported, not subtracted twice", () => {
    const r = computeAvailability([{ qualityStatus: "on_hold", expiresOn: null, onHand: "10", reserved: "0", allocated: "4" }], AS_OF);
    expect(r).toMatchObject({ onHand: "10", onHold: "10", allocated: "0", available: "0", allocatedBlocked: "4" });
  });
});

describe("availability.site_scoped", () => {
  it("an RVS balance never contributes to an NFD query, and an NFD user cannot query RVS", async () => {
    const fg = await loc(kit.rvs.id, "FG-01");
    const rvsLot = await makeLot(whRvs, kit.rvs.id, fg.id, "999");
    const nfdRows = await availabilityRows(wh, { siteId: kit.nfd.id, asOf: AS_OF, includeEmpty: true });
    expect(nfdRows.some((r) => r.lotId === rvsLot.id)).toBe(false);
    await expectCode(availabilityRows(wh, { siteId: kit.rvs.id }), "not_found");
    // Even a corrupted balance row claiming NFD for an RVS lot is excluded (lot site must match).
    await db.update(inventoryBalances).set({ siteId: kit.nfd.id }).where(eq(inventoryBalances.lotId, rvsLot.id));
    expect((await availabilityRows(wh, { siteId: kit.nfd.id, asOf: AS_OF })).some((r) => r.lotId === rvsLot.id)).toBe(false);
    await db.update(inventoryBalances).set({ siteId: kit.rvs.id }).where(eq(inventoryBalances.lotId, rvsLot.id));
  });

  it("requires inventory.balance.view", async () => {
    const noBalance = await asUser(kit, "qa.nfd@bryels-care.test", [], [kit.nfd]);
    await expectCode(availabilityRows(noBalance, { siteId: kit.nfd.id }), "forbidden");
  });
});

describe("stock card (T-15)", () => {
  it("opening from the ledger, every movement with running balance, reversal markers, closing equal to the projection", async () => {
    const a01 = await loc(kit.nfd.id, "A-01");
    const a02 = await loc(kit.nfd.id, "A-02");
    const lot = await makeLot(wh, kit.nfd.id, a01.id, "500");
    // Back-date the receipt so it is the opening balance of today's card.
    await db.update(stockMovements).set({ postedAt: new Date("2026-01-05T02:00:00Z") }).where(eq(stockMovements.lotId, lot.id));
    await db.transaction((tx) => postMovement(tx, wh, { movementType: "consumption", lotId: lot.id, fromLocationId: a01.id, qtyBase: "120", reason: "batch use", sourceDocumentType: "batch", sourceDocumentNumber: "B-T-1" }));
    const t = await transferStock(wh, { lotId: lot.id, fromLocationId: a01.id, toLocationId: a02.id, qty: "80", reason: "put-away", idempotencyKey: randomUUID() });
    await reverseMovement(manager, { movementId: t.movementId, reason: "wrong rack", confirmation: "REVERSE", idempotencyKey: randomUUID() });
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

    const card = await getStockCard(wh, { lotId: lot.id, from: "2026-02-01", to: today });
    expect(card.opening).toBe("500");
    expect(card.lines.map((l) => l.movementType)).toEqual(["consumption", "transfer", "reversal"]);
    expect(card.lines[0]).toMatchObject({ qtyOut: "120", running: "380", number: "B-T-1", statusAtPosting: "released", reason: "batch use" });
    expect(card.lines[1]).toMatchObject({ qtyMoved: "80", running: "380", reversedBy: expect.any(String) });
    expect(card.lines[2].reversalOf).toContain("transfer");
    expect(card.closing).toBe("380");
    expect(card.check).toMatchObject({ ledgerNow: "380", projection: "380", flagged: false });

    const atA02 = await getStockCard(wh, { lotId: lot.id, from: "2026-02-01", to: today, locationId: a02.id });
    expect(atA02.opening).toBe("0");
    expect(atA02.lines.map((l) => [l.qtyIn, l.qtyOut])).toEqual([["80", null], [null, "80"]]);
    expect(atA02.closing).toBe("0");

    // A projection fault is printed and flagged on the closing line.
    await db.update(inventoryBalances).set({ qtyBase: "370" }).where(and(eq(inventoryBalances.lotId, lot.id), eq(inventoryBalances.locationId, a01.id)));
    const flagged = await getStockCard(wh, { lotId: lot.id, from: "2026-02-01", to: today });
    expect(flagged.check).toMatchObject({ ledgerNow: "380", projection: "370", difference: "-10", flagged: true });
    await db.update(inventoryBalances).set({ qtyBase: "380" }).where(and(eq(inventoryBalances.lotId, lot.id), eq(inventoryBalances.locationId, a01.id)));
  });

  it("authz.cross_site.url: another site's lot is not_found; dates are validated", async () => {
    const fg = await loc(kit.rvs.id, "FG-01");
    const rvsLot = await makeLot(whRvs, kit.rvs.id, fg.id, "5");
    await expectCode(getStockCard(wh, { lotId: rvsLot.id, from: "2026-01-01", to: "2026-12-31" }), "not_found");
    await expectCode(getStockCard(whRvs, { lotId: rvsLot.id, from: "2026-12-31", to: "2026-01-01" }), "validation");
  });
});
