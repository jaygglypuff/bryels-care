import "server-only";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import type { DbOrTx } from "@/db/client";
import { inventoryBalances, inventoryLots, locations, salesOrderLines, salesOrders, stockAllocations } from "@/db/schema";
import { D, daysUntil } from "@/lib/qty";
import { OPEN_ALLOCATION_ORDER_STATUSES, reservedByLotLocation } from "./reservations";

/**
 * ADR-110 C2: the ONE definition of "free stock" of finished goods, used by set-aside (sales allocation)
 * and by "Make for this order" (production salesOrderShortfalls): released, not expired, in an active
 * STORAGE location (never the shipping area, the QA cage or the production area), minus open set-asides
 * of open orders and active inventory reservations.
 */
export type StockCandidate = {
  lotId: string;
  lotNumber: string;
  productId: string;
  expiresOn: string | null;
  manufacturedOn: string | null;
  lotCreatedAt: Date;
  locationId: string;
  locationCode: string;
  onHand: string;
  reserved: string;
  available: string;
};

/**
 * Released finished-goods stock in storage locations of a site, net of open allocations and active
 * reservations, in FEFO order (earliest expiry first, lots without expiry last). Expired lots are excluded.
 */
export async function freeFinishedStock(q: DbOrTx, siteId: string, productIds?: string[], opts: { excludeDemandIds?: string[] } = {}): Promise<StockCandidate[]> {
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
    .where(and(eq(stockAllocations.status, "open"), inArray(salesOrders.status, OPEN_ALLOCATION_ORDER_STATUSES)))
    .groupBy(stockAllocations.lotId, stockAllocations.locationId)
    .as("reserved");
  const rows = await q
    .select({
      lotId: inventoryLots.id,
      lotNumber: inventoryLots.lotNumber,
      productId: inventoryLots.productId,
      expiresOn: inventoryLots.expiresOn,
      manufacturedOn: inventoryLots.manufacturedOn,
      lotCreatedAt: inventoryLots.createdAt,
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
  // Inventory reservations (US-2-20) reduce available-to-promise, except the demand being allocated.
  const held = await reservedByLotLocation(q, siteId, { excludeDemandIds: opts.excludeDemandIds });
  return rows
    .filter((r) => {
      const d = daysUntil(r.expiresOn);
      return d === null || d >= 0;
    })
    .map((r) => {
      const reservedQty = D(r.reserved).plus(held.get(`${r.lotId}|${r.locationId}`) ?? 0);
      return { ...r, productId: r.productId!, reserved: reservedQty.toString(), available: Decimal.max(D(r.onHand).minus(reservedQty), 0).toString() };
    });
}

