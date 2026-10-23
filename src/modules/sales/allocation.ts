import "server-only";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { db, type DbOrTx } from "@/db/client";
import { customers, inventoryBalances, inventoryLots, locations, products, salesOrderLines, salesOrders, stockAllocations } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import { D, daysUntil, fmtQty } from "@/lib/qty";
import { assertTransition, lockOrder } from "./orders";

/** Orders whose allocations still hold stock (shipped allocations were already issued from stock). */
const OPEN_ALLOCATION_STATUSES = ["confirmed", "allocated"];

export type StockCandidate = {
  lotId: string;
  lotNumber: string;
  productId: string;
  expiresOn: string | null;
  locationId: string;
  locationCode: string;
  onHand: string;
  reserved: string;
  available: string;
};

/**
 * Released finished-goods stock in storage locations of a site, net of open allocations,
 * in FEFO order (earliest expiry first, lots without expiry last). Expired lots are excluded.
 */
export async function availableStock(q: DbOrTx, siteId: string, productIds?: string[]): Promise<StockCandidate[]> {
  const where = [
    eq(inventoryLots.siteId, siteId),
    eq(inventoryLots.itemKind, "product"),
    eq(inventoryLots.qualityStatus, "released"),
    eq(locations.kind, "storage"),
    eq(locations.isActive, true),
    gt(inventoryBalances.qtyBase, "0"),
  ];
  if (productIds) {
    if (productIds.length === 0) return [];
    where.push(inArray(inventoryLots.productId, productIds));
  }
  const reserved = q
    .select({
      lotId: stockAllocations.lotId,
      locationId: stockAllocations.locationId,
      qty: sql<string>`sum(${stockAllocations.qtyUnits})`.as("reserved_qty"),
    })
    .from(stockAllocations)
    .innerJoin(salesOrderLines, eq(salesOrderLines.id, stockAllocations.salesOrderLineId))
    .innerJoin(salesOrders, eq(salesOrders.id, salesOrderLines.salesOrderId))
    .where(inArray(salesOrders.status, OPEN_ALLOCATION_STATUSES))
    .groupBy(stockAllocations.lotId, stockAllocations.locationId)
    .as("reserved");
  const rows = await q
    .select({
      lotId: inventoryLots.id,
      lotNumber: inventoryLots.lotNumber,
      productId: inventoryLots.productId,
      expiresOn: inventoryLots.expiresOn,
      locationId: locations.id,
      locationCode: locations.code,
      onHand: inventoryBalances.qtyBase,
      reserved: sql<string>`coalesce(${reserved.qty}, 0)::text`,
    })
    .from(inventoryBalances)
    .innerJoin(inventoryLots, eq(inventoryLots.id, inventoryBalances.lotId))
    .innerJoin(locations, eq(locations.id, inventoryBalances.locationId))
    .leftJoin(reserved, and(eq(reserved.lotId, inventoryBalances.lotId), eq(reserved.locationId, inventoryBalances.locationId)))
    .where(and(...where))
    .orderBy(sql`${inventoryLots.expiresOn} asc nulls last`, asc(inventoryLots.lotNumber), asc(locations.code));
  return rows
    .filter((r) => {
      const d = daysUntil(r.expiresOn);
      return d === null || d >= 0;
    })
    .map((r) => ({ ...r, productId: r.productId!, available: Decimal.max(D(r.onHand).minus(r.reserved), 0).toString() }));
}

/** Product options for order entry with released available units at the current site. */
export async function productAvailability(ctx: AuthContext) {
  ctx.require("sales.sales_order.create");
  ctx.requireSite(ctx.currentSiteId);
  const prods = await db
    .select({ id: products.id, skuCode: products.skuCode, name: products.name })
    .from(products)
    .where(eq(products.organizationId, ctx.organizationId))
    .orderBy(products.skuCode);
  const stock = await availableStock(db, ctx.currentSiteId);
  return prods.map((p) => ({
    ...p,
    available: stock.filter((s) => s.productId === p.id).reduce((sum, s) => sum.plus(s.available), new Decimal(0)).toString(),
  }));
}

export type AllocationResult = {
  orderNumber: string;
  fullyAllocated: boolean;
  created: { sku: string; lotNumber: string; locationCode: string; qty: string }[];
  shortfalls: { sku: string; ordered: string; short: string }[];
  skippedForShelfLife: { lotNumber: string; daysLeft: number }[];
  minShelfLifeDays: number;
};

/**
 * FEFO allocation (W09-05, A-PROC-09): for each order line, reserves released finished-goods lots of
 * the product at the order's site, earliest expiry first, skipping lots whose remaining shelf life
 * is below the customer's minimum. Partial allocation is kept and the order stays confirmed.
 * Serialization: the order row, then the candidate lot rows (sorted by id) are locked, matching the
 * lock order of dispatch posting.
 */
export async function allocateOrder(ctx: AuthContext, orderId: string): Promise<AllocationResult> {
  ctx.require("sales.allocation.post");
  return db.transaction(async (tx) => {
    const o = await lockOrder(tx, ctx, orderId);
    if (o.status === "allocated") throw new DomainError("state", `Order ${o.orderNumber} is already fully allocated.`);
    if (o.status !== "confirmed") throw new DomainError("state", `Order ${o.orderNumber} is ${o.status}; only confirmed orders can be allocated.`);
    const [cust] = await tx.select({ minShelfLifeDays: customers.minShelfLifeDays }).from(customers).where(eq(customers.id, o.customerId)).limit(1);
    const minShelf = cust?.minShelfLifeDays ?? 0;

    const lines = await tx
      .select({ id: salesOrderLines.id, productId: salesOrderLines.productId, qty: salesOrderLines.qtyUnits, sku: products.skuCode })
      .from(salesOrderLines)
      .innerJoin(products, eq(products.id, salesOrderLines.productId))
      .where(eq(salesOrderLines.salesOrderId, o.id))
      .orderBy(asc(salesOrderLines.lineNo));
    const existing = lines.length
      ? await tx.select().from(stockAllocations).where(inArray(stockAllocations.salesOrderLineId, lines.map((l) => l.id)))
      : [];

    const productIds = [...new Set(lines.map((l) => l.productId))];
    // Lock candidate lot rows in a deterministic order so concurrent allocations / dispatches serialize.
    if (productIds.length) {
      await tx
        .select({ id: inventoryLots.id })
        .from(inventoryLots)
        .where(and(eq(inventoryLots.siteId, o.siteId), eq(inventoryLots.itemKind, "product"), inArray(inventoryLots.productId, productIds)))
        .orderBy(asc(inventoryLots.id))
        .for("update");
    }
    const candidates = await availableStock(tx, o.siteId, productIds);
    const remaining = new Map(candidates.map((c) => [`${c.lotId}|${c.locationId}`, D(c.available)]));

    const result: AllocationResult = { orderNumber: o.orderNumber, fullyAllocated: true, created: [], shortfalls: [], skippedForShelfLife: [], minShelfLifeDays: minShelf };
    const skipped = new Map<string, number>();
    const inserts: { salesOrderLineId: string; lotId: string; locationId: string; qtyUnits: string }[] = [];

    for (const line of lines) {
      const already = existing.filter((a) => a.salesOrderLineId === line.id).reduce((s, a) => s.plus(a.qtyUnits), new Decimal(0));
      let need = D(line.qty).minus(already);
      for (const c of candidates) {
        if (need.lte(0)) break;
        if (c.productId !== line.productId) continue;
        const left = daysUntil(c.expiresOn);
        if (left !== null && left < minShelf) {
          skipped.set(c.lotNumber, left);
          continue;
        }
        const key = `${c.lotId}|${c.locationId}`;
        const avail = remaining.get(key) ?? new Decimal(0);
        if (avail.lte(0)) continue;
        const take = Decimal.min(avail, need);
        remaining.set(key, avail.minus(take));
        need = need.minus(take);
        inserts.push({ salesOrderLineId: line.id, lotId: c.lotId, locationId: c.locationId, qtyUnits: take.toString() });
        result.created.push({ sku: line.sku, lotNumber: c.lotNumber, locationCode: c.locationCode, qty: take.toString() });
      }
      if (need.gt(0)) {
        result.fullyAllocated = false;
        result.shortfalls.push({ sku: line.sku, ordered: D(line.qty).toString(), short: need.toString() });
      }
    }
    result.skippedForShelfLife = [...skipped].map(([lotNumber, daysLeft]) => ({ lotNumber, daysLeft }));

    if (inserts.length === 0) {
      if (result.fullyAllocated) {
        // Nothing to add but nothing short (e.g. a previous partial allocation has since been completed).
      } else {
        throw new DomainError("insufficient_stock", describeShortfall(result, "No stock could be allocated."));
      }
    } else {
      await tx.insert(stockAllocations).values(inserts);
    }
    if (result.fullyAllocated) {
      assertTransition(o.status, "allocated", o.orderNumber);
      await tx.update(salesOrders).set({ status: "allocated" }).where(eq(salesOrders.id, o.id));
    }
    await audit(tx, ctx, {
      action: "sales.allocation.posted",
      entityType: "sales_order",
      entityId: o.id,
      entityNumber: o.orderNumber,
      siteId: o.siteId,
      before: { status: o.status },
      after: { status: result.fullyAllocated ? "allocated" : o.status, allocations: result.created, shortfalls: result.shortfalls, skippedForShelfLife: result.skippedForShelfLife },
    });
    return result;
  });
}

export function describeShortfall(r: AllocationResult, prefix: string): string {
  const parts = r.shortfalls.map((s) => `${s.sku}: ${fmtQty(s.short, "pcs", 0)} short of ${fmtQty(s.ordered, "pcs", 0)} ordered`);
  let msg = `${prefix} Not enough released stock — ${parts.join("; ")}. The order stays confirmed; allocate again when more stock is released.`;
  if (r.skippedForShelfLife.length) {
    msg += ` Skipped lot(s) below the customer's minimum shelf life of ${r.minShelfLifeDays} days: ${r.skippedForShelfLife.map((s) => `${s.lotNumber} (${s.daysLeft} days left)`).join(", ")}.`;
  }
  return msg;
}
