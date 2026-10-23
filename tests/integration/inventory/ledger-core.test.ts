/**
 * US-2-01 acceptance criteria against the posting pipeline (docs/testing.md §4.1, §4.3, §4.14):
 * concurrency.double_issue_prevented, concurrency.deadlock_free, ledger.projection.updated_in_transaction,
 * stock.negative.*, uom.entered_and_base_stored, inventory.operator_movement_types, audit of every posting.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { and, count, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, inventoryBalances, settings, stockMovements } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { postMovement, postMovements, type PostMovementInput } from "@/modules/inventory/ledger";
import { transferStock } from "@/modules/inventory/movements";
import { findLedgerDifferences } from "@/modules/inventory/reconciliation";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, type Kit, loadKit, loc, makeLot, onHand } from "../../support/kit";

let kit: Kit;
let wh: AuthContext;
let operator: AuthContext;
let manager: AuthContext;

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  wh = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
  operator = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  manager = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
});

describe("concurrency", () => {
  it("concurrency.double_issue_prevented: balance 10, two concurrent issues of 8 → one ok, one 409, balance 2, one ledger row", async () => {
    const a01 = await loc(kit.nfd.id, "A-01");
    const lot = await makeLot(wh, kit.nfd.id, a01.id, "10");
    const issue = () => db.transaction((tx) => postMovement(tx, wh, { movementType: "consumption", lotId: lot.id, fromLocationId: a01.id, qtyBase: "8", sourceDocumentType: "test" }));
    const results = await Promise.allSettled([issue(), issue()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(failed.reason).toMatchObject({ code: "insufficient_stock" });
    expect(await onHand(lot.id, a01.id)).toBe("2");
    const [n] = await db.select({ n: count() }).from(stockMovements).where(and(eq(stockMovements.lotId, lot.id), eq(stockMovements.movementType, "consumption")));
    expect(n.n).toBe(1);
  });

  it("concurrency.deadlock_free: 200 randomised multi-lot postings over 8 connections never deadlock and reconcile to zero differences", async () => {
    const locs = await Promise.all(["A-01", "A-02", "B-01", "PRD-01"].map((c) => loc(kit.nfd.id, c)));
    const lots = [];
    for (let i = 0; i < 6; i++) lots.push(await makeLot(wh, kit.nfd.id, locs[i % 3].id, "1000"));
    // Deterministic pseudo-random sequence so a failure is reproducible.
    let seed = 20261023;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const jobs: (() => Promise<unknown>)[] = [];
    for (let i = 0; i < 200; i++) {
      const k = 1 + rnd(3);
      const inputs: PostMovementInput[] = [];
      for (let j = 0; j < k; j++) {
        const lot = lots[rnd(lots.length)];
        const from = locs[rnd(locs.length)];
        let to = locs[rnd(locs.length)];
        if (to.id === from.id) to = locs[(locs.indexOf(from) + 1) % locs.length];
        inputs.push({ movementType: "transfer", lotId: lot.id, fromLocationId: from.id, toLocationId: to.id, qtyBase: String(1 + rnd(40)), sourceDocumentType: "test" });
      }
      if (i % 4 === 0) {
        const m = inputs[0];
        jobs.push(() => transferStock(wh, { lotId: m.lotId, fromLocationId: m.fromLocationId!, toLocationId: m.toLocationId!, qty: String(m.qtyBase), reason: "randomised test", idempotencyKey: randomUUID() }));
      } else {
        jobs.push(() => db.transaction((tx) => postMovements(tx, wh, inputs)));
      }
    }
    const errors: unknown[] = [];
    let next = 0;
    await Promise.all(
      Array.from({ length: 8 }, async () => {
        while (next < jobs.length) {
          const job = jobs[next++];
          try {
            await job();
          } catch (e) {
            errors.push(e);
          }
        }
      }),
    );
    // Only business refusals (not enough stock at a random source) are acceptable failures.
    const unexpected = errors.filter((e) => (e as { code?: string }).code !== "insufficient_stock");
    expect(unexpected.map((e) => String((e as Error).message ?? e))).toEqual([]);
    expect(errors.length).toBeLessThan(200);
    expect(await findLedgerDifferences(db, { organizationId: kit.orgId, lotIds: lots.map((l) => l.id) })).toEqual([]);
  });
});

describe("transaction integrity", () => {
  it("ledger.projection.updated_in_transaction / audit.same_transaction: a failure after the ledger insert leaves no row, no balance change, no audit", async () => {
    const a01 = await loc(kit.nfd.id, "A-01");
    const a02 = await loc(kit.nfd.id, "A-02");
    const lot = await makeLot(wh, kit.nfd.id, a01.id, "500");
    const key = `inject-${randomUUID()}`;
    const [auditBefore] = await db.select({ n: count() }).from(auditEvents).where(eq(auditEvents.action, "inventory.stock_movement.posted"));
    await expect(
      db.transaction(async (tx) => {
        await postMovement(tx, wh, { movementType: "transfer", lotId: lot.id, fromLocationId: a01.id, toLocationId: a02.id, qtyBase: "100", idempotencyKey: key });
        throw new Error("injected failure after ledger insert");
      }),
    ).rejects.toThrow("injected failure");
    expect(await db.select().from(stockMovements).where(eq(stockMovements.idempotencyKey, key))).toHaveLength(0);
    expect(await onHand(lot.id, a01.id)).toBe("500");
    expect(await onHand(lot.id, a02.id)).toBe("0");
    const [auditAfter] = await db.select({ n: count() }).from(auditEvents).where(eq(auditEvents.action, "inventory.stock_movement.posted"));
    expect(auditAfter.n).toBe(auditBefore.n);
  });

  it("writes inventory.stock_movement.posted for every new movement (not for an idempotent replay)", async () => {
    const a01 = await loc(kit.nfd.id, "A-01");
    const lot = await makeLot(wh, kit.nfd.id, a01.id, "50");
    const input = { movementType: "consumption" as const, lotId: lot.id, fromLocationId: a01.id, qtyBase: "5", idempotencyKey: `audit-${randomUUID()}` };
    const first = await db.transaction((tx) => postMovement(tx, wh, input));
    const again = await db.transaction((tx) => postMovement(tx, wh, input));
    expect(again.replayed).toBe(true);
    const ev = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, first.movement.id), eq(auditEvents.action, "inventory.stock_movement.posted")));
    expect(ev).toHaveLength(1);
    expect(ev[0].actorId).toBe(wh.userId);
    expect(ev[0].siteId).toBe(kit.nfd.id);
    expect(first.movement.qualityStatusAtPosting).toBe("released");
  });
});

describe("no negative stock and ledger constraints", () => {
  it("stock.negative.no_policy_exception: even the owner's full permission set cannot drive a balance below zero", async () => {
    const owner = await asUser(kit, "owner@bryels-care.test", "owner_director", [kit.nfd, kit.rvs]);
    const a01 = await loc(kit.nfd.id, "A-01");
    const lot = await makeLot(wh, kit.nfd.id, a01.id, "5");
    await expectCode(db.transaction((tx) => postMovement(tx, owner, { movementType: "consumption", lotId: lot.id, fromLocationId: a01.id, qtyBase: "10" })), "insufficient_stock");
    expect(await onHand(lot.id, a01.id)).toBe("5");
  });

  it("stock.negative.check_constraint: a direct SQL update to a negative balance fails on the CHECK", async () => {
    await expect(db.execute(sql`update inventory_balances set qty_base = -1 where id = (select id from inventory_balances limit 1)`)).rejects.toThrow();
  });

  it("ck_stock_movements_locations rejects rows whose from/to do not match the type, even outside the service", async () => {
    const [m] = await db.select().from(stockMovements).where(eq(stockMovements.movementType, "transfer")).limit(1);
    const base = { ...m, id: undefined, idempotencyKey: null, postedAt: undefined } as Record<string, unknown>;
    delete base.id;
    delete base.postedAt;
    await expect(db.insert(stockMovements).values({ ...(base as typeof m), toLocationId: null })).rejects.toThrow();
    await expect(db.insert(stockMovements).values({ ...(base as typeof m), movementType: "reversal", reversalOfId: null })).rejects.toThrow();
    await expect(db.insert(stockMovements).values({ ...(base as typeof m), qtyBase: "0" })).rejects.toThrow();
  });

  it("refuses a location of another site (cross-site body injection)", async () => {
    const a01 = await loc(kit.nfd.id, "A-01");
    const rvsFg = await loc(kit.rvs.id, "FG-01");
    const lot = await makeLot(wh, kit.nfd.id, a01.id, "20");
    await expectCode(db.transaction((tx) => postMovement(tx, wh, { movementType: "transfer", lotId: lot.id, fromLocationId: a01.id, toLocationId: rvsFg.id, qtyBase: "1" })), "validation");
    expect(await onHand(lot.id, rvsFg.id)).toBe("0");
  });
});

describe("units", () => {
  it("uom.entered_and_base_stored: entered 1.5 kg is stored with base 1500 g; a mismatch is refused", async () => {
    const a01 = await loc(kit.nfd.id, "A-01");
    const lot = await makeLot(wh, kit.nfd.id, a01.id, "5000");
    const { movement } = await db.transaction((tx) =>
      postMovement(tx, wh, { movementType: "consumption", lotId: lot.id, fromLocationId: a01.id, qtyBase: "1500", entered: { qty: "1.5", uom: "kg" } }),
    );
    expect(Number(movement.qtyEntered)).toBe(1.5);
    expect(movement.enteredUom).toBe("kg");
    expect(Number(movement.qtyBase)).toBe(1500);
    expect(movement.baseUom).toBe("g");
    await expectCode(
      db.transaction((tx) => postMovement(tx, wh, { movementType: "consumption", lotId: lot.id, fromLocationId: a01.id, qtyBase: "1500", entered: { qty: "1.4", uom: "kg" } })),
      "validation",
    );
    await expectCode(
      db.transaction((tx) => postMovement(tx, wh, { movementType: "consumption", lotId: lot.id, fromLocationId: a01.id, qtyBase: "1", entered: { qty: "1", uom: "pcs" } })),
      "validation",
    );
  });
});

describe("inventory.operator_movement_types (A-PM-06)", () => {
  it("a production_operator may not transfer between two non-production locations (403) but may move to or from production", async () => {
    const a01 = await loc(kit.nfd.id, "A-01");
    const a02 = await loc(kit.nfd.id, "A-02");
    const prd = await loc(kit.nfd.id, "PRD-01");
    const lot = await makeLot(wh, kit.nfd.id, a01.id, "300");
    const move = (from: string, to: string) => transferStock(operator, { lotId: lot.id, fromLocationId: from, toLocationId: to, qty: "10", reason: "operator move", idempotencyKey: randomUUID() });
    await expectCode(move(a01.id, a02.id), "forbidden");
    expect(await onHand(lot.id, a02.id)).toBe("0");
    await move(a01.id, prd.id);
    await move(prd.id, a02.id);
    expect(await onHand(lot.id, a02.id)).toBe("10");
  });

  it("a production_operator may not post a movement type outside the configured list", async () => {
    const a01 = await loc(kit.nfd.id, "A-01");
    const lot = await makeLot(wh, kit.nfd.id, a01.id, "30");
    await expectCode(db.transaction((tx) => postMovement(tx, operator, { movementType: "shipment", lotId: lot.id, fromLocationId: a01.id, qtyBase: "1" })), "forbidden");
    await db.transaction((tx) => postMovement(tx, operator, { movementType: "consumption", lotId: lot.id, fromLocationId: a01.id, qtyBase: "1" }));
  });

  it("the rule is configuration: a site setting can widen it, and a second unrestricted role lifts it", async () => {
    const a01 = await loc(kit.nfd.id, "A-01");
    const a02 = await loc(kit.nfd.id, "A-02");
    const lot = await makeLot(wh, kit.nfd.id, a01.id, "100");
    const [row] = await db
      .insert(settings)
      .values({ organizationId: kit.orgId, scope: "site", siteId: kit.nfd.id, key: "inventory.role_movement_types", value: { production_operator: { movementTypes: ["consumption", "output", "transfer"] } } })
      .returning();
    await transferStock(operator, { lotId: lot.id, fromLocationId: a01.id, toLocationId: a02.id, qty: "5", reason: "widened", idempotencyKey: randomUUID() });
    await db.delete(settings).where(eq(settings.id, row.id));
    const both = await asUser(kit, "operator.nfd@bryels-care.test", ["production_operator", "warehouse_operator"], [kit.nfd]);
    await transferStock(both, { lotId: lot.id, fromLocationId: a01.id, toLocationId: a02.id, qty: "5", reason: "two roles", idempotencyKey: randomUUID() });
    expect(await onHand(lot.id, a02.id)).toBe("10");
    await expectCode(transferStock(operator, { lotId: lot.id, fromLocationId: a01.id, toLocationId: a02.id, qty: "5", reason: "restored", idempotencyKey: randomUUID() }), "forbidden");
  });

  it("site managers are not restricted by the operator rule", async () => {
    const a01 = await loc(kit.nfd.id, "A-01");
    const a02 = await loc(kit.nfd.id, "A-02");
    const lot = await makeLot(wh, kit.nfd.id, a01.id, "20");
    await transferStock(manager, { lotId: lot.id, fromLocationId: a01.id, toLocationId: a02.id, qty: "20", reason: "manager move", idempotencyKey: randomUUID() });
    const [b] = await db.select().from(inventoryBalances).where(and(eq(inventoryBalances.lotId, lot.id), eq(inventoryBalances.locationId, a02.id)));
    expect(Number(b.qtyBase)).toBe(20);
  });
});
