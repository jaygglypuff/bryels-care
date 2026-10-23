import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, like } from "drizzle-orm";
import { db } from "@/db/client";
import { inventoryBalances, inventoryLots, locations, organizations, sites, stockMovements, users } from "@/db/schema";
import { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { assertLotUsable, postMovement } from "@/modules/inventory/ledger";
import { resetTestDatabase } from "../support/db";

let ctxNfd: AuthContext;
let ctxRvsOnly: AuthContext;
let nfdId: string;

async function lotByName(materialLike: string) {
  const rows = await db.select().from(inventoryLots).where(like(inventoryLots.supplierLotNumber, materialLike));
  return rows[0];
}
async function loc(siteId: string, code: string) {
  const [l] = await db.select().from(locations).where(and(eq(locations.siteId, siteId), eq(locations.code, code)));
  return l;
}
async function onHand(lotId: string, locationId: string) {
  const [b] = await db.select().from(inventoryBalances).where(and(eq(inventoryBalances.lotId, lotId), eq(inventoryBalances.locationId, locationId)));
  return b ? Number(b.qtyBase) : 0;
}

beforeAll(async () => {
  await resetTestDatabase();
  const [org] = await db.select().from(organizations);
  const allSites = await db.select().from(sites);
  const nfd = allSites.find((s) => s.code === "NFD")!;
  const rvs = allSites.find((s) => s.code === "RVS")!;
  nfdId = nfd.id;
  const [u] = await db.select().from(users).where(eq(users.email, "warehouse.nfd@bryels-care.test"));
  const perms = new Set(["inventory.movement.post", "inventory.lot.view"]);
  ctxNfd = new AuthContext(u.id, org.id, u.displayName, u.email, ["warehouse_operator"], perms, [nfd], nfd.id);
  ctxRvsOnly = new AuthContext(u.id, org.id, u.displayName, u.email, ["warehouse_operator"], perms, [rvs], rvs.id);
});

describe("stock ledger (ADR-006)", () => {
  it("moves stock and keeps the projection equal to the movement", async () => {
    const lot = await lotByName("LOS-24871");
    const a01 = await loc(nfdId, "A-01");
    const prd = await loc(nfdId, "PRD-01");
    const before = await onHand(lot.id, a01.id);
    await db.transaction((tx) => postMovement(tx, ctxNfd, { movementType: "transfer", lotId: lot.id, fromLocationId: a01.id, toLocationId: prd.id, qtyBase: "1000" }));
    expect(await onHand(lot.id, a01.id)).toBeCloseTo(before - 1000, 6);
    expect(await onHand(lot.id, prd.id)).toBeCloseTo(1000, 6);
  });

  it("rejects a movement that would make stock negative and writes nothing", async () => {
    const lot = await lotByName("LOS-24871");
    const a01 = await loc(nfdId, "A-01");
    const before = await onHand(lot.id, a01.id);
    const count = (await db.select().from(stockMovements).where(eq(stockMovements.lotId, lot.id))).length;
    await expect(
      db.transaction((tx) => postMovement(tx, ctxNfd, { movementType: "consumption", lotId: lot.id, fromLocationId: a01.id, qtyBase: String(before + 1) })),
    ).rejects.toMatchObject({ code: "insufficient_stock" });
    expect(await onHand(lot.id, a01.id)).toBeCloseTo(before, 6);
    expect((await db.select().from(stockMovements).where(eq(stockMovements.lotId, lot.id))).length).toBe(count);
  });

  it("is idempotent: the same key posts once", async () => {
    const lot = await lotByName("LOS-24871");
    const a01 = await loc(nfdId, "A-01");
    const before = await onHand(lot.id, a01.id);
    const input = { movementType: "consumption" as const, lotId: lot.id, fromLocationId: a01.id, qtyBase: "10", idempotencyKey: "test-idem-1" };
    const first = await db.transaction((tx) => postMovement(tx, ctxNfd, input));
    const second = await db.transaction((tx) => postMovement(tx, ctxNfd, input));
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.movement.id).toBe(first.movement.id);
    expect(await onHand(lot.id, a01.id)).toBeCloseTo(before - 10, 6);
  });

  it("serializes concurrent issues so the balance never goes below zero", async () => {
    const lot = await lotByName("LB-7712");
    const b01 = await loc(nfdId, "B-01");
    const avail = await onHand(lot.id, b01.id);
    const each = Math.floor(avail / 3) + 1; // three of these cannot all fit
    const results = await Promise.allSettled(
      [1, 2, 3].map(() => db.transaction((tx) => postMovement(tx, ctxNfd, { movementType: "consumption", lotId: lot.id, fromLocationId: b01.id, qtyBase: String(each) }))),
    );
    const ok = results.filter((r) => r.status === "fulfilled").length;
    expect(ok).toBe(2);
    expect(await onHand(lot.id, b01.id)).toBeCloseTo(avail - 2 * each, 6);
  });

  it("denies posting against another site's lot (site scope)", async () => {
    const lot = await lotByName("LOS-24871");
    const a01 = await loc(nfdId, "A-01");
    await expect(
      db.transaction((tx) => postMovement(tx, ctxRvsOnly, { movementType: "consumption", lotId: lot.id, fromLocationId: a01.id, qtyBase: "1" })),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("the database constraint blocks a negative balance even outside the service", async () => {
    const lot = await lotByName("LOS-24871");
    const a01 = await loc(nfdId, "A-01");
    await expect(db.update(inventoryBalances).set({ qtyBase: "-1" }).where(and(eq(inventoryBalances.lotId, lot.id), eq(inventoryBalances.locationId, a01.id)))).rejects.toThrow();
  });
});

describe("lot usability", () => {
  it("blocks quarantined, on-hold and expired lots", () => {
    expect(() => assertLotUsable({ lotNumber: "L1", qualityStatus: "quarantine", expiresOn: null })).toThrow(DomainError);
    expect(() => assertLotUsable({ lotNumber: "L2", qualityStatus: "on_hold", expiresOn: null })).toThrow(DomainError);
    expect(() => assertLotUsable({ lotNumber: "L3", qualityStatus: "released", expiresOn: "2000-01-01" })).toThrow(/expired/);
    expect(() => assertLotUsable({ lotNumber: "L4", qualityStatus: "released", expiresOn: "2999-12-31" })).not.toThrow();
  });
});
