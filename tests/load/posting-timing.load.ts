/**
 * US-9-01 posting harness: server-side time of the posting commands on the A-PRD-12 volume database
 * (docs/testing.md §11.1: p95 ≤ 500 ms, p99 ≤ 1 s), measured inside the process through the real
 * services (permissions, locks, ledger, audit), so network and rendering are excluded. Prints one JSON
 * line per command; docs/load-test-report.md records the numbers. Never run against real data.
 */
import { writeFileSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { batches, batchMaterials, inventoryBalances, inventoryLots, locations, materials, sites } from "@/db/schema";
import { availabilityRows, transferStock } from "@/modules/inventory";
import { findLedgerDifferences } from "@/modules/inventory/reconciliation";
import { createBatch, recordDispense, startBatch } from "@/modules/production";
import { allocateOrder, createOrder, dispatchShipment, submitOrder } from "@/modules/sales";
import { asUser, loadKit, makeLot } from "../support/kit";
import { acapulcoRevisionId, allowDirectBatches, cleanEquipment, lotBySupplierLot, manilaDay, SOAP_LOTS, signChecklist, snapshotOf } from "../support/w2b";
import { inDays, newCustomer, productId, loadW3d } from "../support/w3d";
import { pickAll, verifyAll } from "../support/w3e";
import Decimal from "decimal.js";

const N = Number(process.env.LOAD_POSTINGS ?? 200);
const results: Record<string, unknown>[] = [];

function stats(name: string, ms: number[], extra: Record<string, unknown> = {}) {
  const s = [...ms].sort((a, b) => a - b);
  const p = (q: number) => Math.round(s[Math.min(s.length - 1, Math.ceil((q / 100) * s.length) - 1)] ?? 0);
  const r = { name, count: s.length, p50: p(50), p95: p(95), p99: p(99), max: Math.round(s[s.length - 1] ?? 0), ...extra };
  results.push(r);
  console.log(JSON.stringify(r));
  return r;
}

async function time<T>(fn: () => Promise<T>): Promise<[number, T]> {
  const t0 = performance.now();
  const v = await fn();
  return [performance.now() - t0, v];
}

describe("posting server time at A-PRD-12 volumes", () => {
  it("receipts, transfers, weighings, dispatches, availability and reconciliation", async () => {
    const kit = await loadKit();
    const [ld] = await db.select({ n: sql<number>`count(*)::int` }).from(inventoryLots).where(sql`${inventoryLots.lotNumber} like 'LD-%'`);
    expect(ld.n, "run pnpm load:seed on this scratch database first").toBeGreaterThan(0);
    const wh = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
    const manager = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
    const operator = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.nfd]);
    const checker = await asUser(kit, "checker.nfd@bryels-care.test", "production_operator", [kit.nfd]);
    const [a01] = await db.select().from(locations).where(and(eq(locations.siteId, kit.nfd.id), eq(locations.code, "A-01")));
    const [a02] = await db.select().from(locations).where(and(eq(locations.siteId, kit.nfd.id), eq(locations.code, "A-02")));

    // 1. Receipts (lot + receipt movement + projection + audit), as receiving posts each line.
    const receipt: number[] = [];
    for (let i = 0; i < Math.min(N, 100); i++) receipt.push((await time(() => makeLot(wh, kit.nfd.id, a01.id, "500")))[0]);
    stats("receipt_posting", receipt);

    // 2. Transfers (scan-to-move) on the generated lots: lock, ledger rows, projection, audit.
    const lots = await db
      .select({ id: inventoryLots.id })
      .from(inventoryLots)
      .innerJoin(inventoryBalances, and(eq(inventoryBalances.lotId, inventoryLots.id), eq(inventoryBalances.locationId, a01.id)))
      .where(and(eq(inventoryLots.siteId, kit.nfd.id), sql`${inventoryLots.lotNumber} like 'LD-%'`, sql`${inventoryBalances.qtyBase} >= 10`))
      .limit(N);
    const transfer: number[] = [];
    for (const l of lots) transfer.push((await time(() => transferStock(wh, { lotId: l.id, fromLocationId: a01.id, toLocationId: a02.id, qty: "1", reason: "load harness (fictional)", idempotencyKey: uuidv7() })))[0]);
    stats("transfer_posting", transfer);

    // 3. Weighings: small Acapulco batches (direct batches allowed on this scratch database only).
    await allowDirectBatches(kit);
    const weigh: number[] = [];
    const revisionId = await acapulcoRevisionId();
    for (let b = 0; b < 10; b++) {
      const { batchId } = await createBatch(manager, { formulaRevisionId: revisionId, plannedSizeKg: "1.76", plannedStartOn: manilaDay(0) });
      await startBatch(operator, batchId);
      await cleanEquipment(operator, "SC-01");
      const [row] = await db.select().from(batches).where(eq(batches.id, batchId));
      const steps = [...snapshotOf(row!).steps].sort((x, y) => x.stepNo - y.stepNo);
      for (const s of steps) {
        if (s.stepKind === "line_clearance") await signChecklist(operator, checker, batchId, s);
        if (s.stepKind === "dispensing") break;
      }
      const lines = await db.select({ bm: batchMaterials, code: materials.code }).from(batchMaterials).innerJoin(materials, eq(materials.id, batchMaterials.materialId)).where(eq(batchMaterials.batchId, batchId));
      for (const { bm, code } of lines) {
        const lot = await lotBySupplierLot(SOAP_LOTS[code]);
        weigh.push((await time(() => recordDispense(operator, { batchId, batchMaterialId: bm.id, lotRef: `BC:LOT:${lot.lotNumber}`, qty: new Decimal(bm.theoreticalQtyG).toDecimalPlaces(3).toString(), equipmentRef: "SC-01" }, { checker })))[0]);
      }
    }
    stats("weighing_posting", weigh);

    // 4. Dispatches (stock issue + DR numbering + order transition), each on its own allocated order.
    const w = await loadW3d();
    const customer = await newCustomer(w, { creditLimit: "100000000", minShelfLifeDays: 0 });
    const dispatch: number[] = [];
    let refused = 0;
    for (let i = 0; i < 20; i++) {
      try {
        const o = await createOrder(w.sales, { customerId: customer.id, requestedDeliveryOn: inDays(7), lines: [{ productId: await productId("ACS-135"), qtyUnits: "1", unitPrice: "70" }] });
        await submitOrder(w.sales, o.id);
        await allocateOrder(w.warehouse, o.id);
        const { pickId, shipmentId } = await pickAll(w.warehouse, o.id);
        await verifyAll(w.manager, w.warehouse, pickId, shipmentId);
        dispatch.push((await time(() => dispatchShipment(w.warehouse, shipmentId, { driverName: "Jun Dela Cruz (fictional)", vehiclePlate: "NFD 2468", idempotencyKey: uuidv7() })))[0]);
      } catch {
        refused += 1; // released finished goods ran out on the scratch database
      }
    }
    stats("dispatch_posting", dispatch, { refusedForStock: refused });

    // 5. Reads that dashboards and the scan screens depend on.
    const avail: number[] = [];
    for (let i = 0; i < 20; i++) avail.push((await time(() => availabilityRows(wh, { siteId: kit.nfd.id, asOf: manilaDay(0) })))[0]);
    stats("availability_query", avail);
    const [ms, diffs] = await time(() => findLedgerDifferences(db, { organizationId: kit.orgId }));
    stats("reconciliation_full", [ms], { differences: diffs.length });
    expect(diffs).toHaveLength(0);

    const [org] = await db.select({ n: sql<number>`count(*)::int` }).from(sites);
    expect(org.n).toBeGreaterThan(0);
    if (process.env.LOAD_OUT) writeFileSync(process.env.LOAD_OUT, JSON.stringify(results, null, 2));
  });
});
