import "server-only";
import { and, asc, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { db, type DbOrTx, type Tx } from "@/db/client";
import {
  containerContents,
  containers,
  inventoryBalances,
  inventoryLots,
  locations,
  pickLines,
  picks,
  products,
  salesOrderLines,
  salesOrders,
  stockAllocations,
} from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import { D, daysUntil, fmtQty } from "@/lib/qty";
import { lockOrder } from "./orders";
import { transitionOrder } from "./fulfilment-state";
import { customerFulfilmentRequirements } from "./fulfilment-requirements";
import {
  convertReservationsForDemands,
  looseQty,
  OPEN_ALLOCATION_ORDER_STATUSES,
  reservedByLotLocation,
  resolveAllocationStrategy,
  sortCandidates,
} from "@/modules/inventory";

/** Orders whose open allocations still hold stock (fulfilled allocations were already issued from stock). */
export const OPEN_ALLOCATION_STATUSES = OPEN_ALLOCATION_ORDER_STATUSES;
/** Order states from which (more) stock may be allocated: a confirmed order, or the backorder of a partial shipment. */
const ALLOCATABLE_STATUSES = ["confirmed", "partially_shipped"];

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
export async function availableStock(q: DbOrTx, siteId: string, productIds?: string[], opts: { excludeDemandIds?: string[] } = {}): Promise<StockCandidate[]> {
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
    .where(and(eq(stockAllocations.status, "open"), inArray(salesOrders.status, OPEN_ALLOCATION_STATUSES)))
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

/** Product options for order entry with released available units at the current site. */
export async function productAvailability(ctx: AuthContext) {
  ctx.require("sales.sales_order.create");
  ctx.requireSite(ctx.currentSiteId);
  const prods = await db
    .select({ id: products.id, skuCode: products.skuCode, name: products.name })
    .from(products)
    .where(and(eq(products.organizationId, ctx.organizationId), eq(products.status, "active"))) // W2G: only active products are sold
    .orderBy(products.skuCode);
  const stock = await availableStock(db, ctx.currentSiteId);
  return prods.map((p) => ({
    ...p,
    available: stock.filter((s) => s.productId === p.id).reduce((sum, s) => sum.plus(s.available), new Decimal(0)).toString(),
  }));
}

export type AllocationRow = { sku: string; lotNumber: string; locationCode: string; qty: string; boxNumber: string | null; partialBox: boolean };

export type AllocationResult = {
  orderNumber: string;
  fullyAllocated: boolean;
  created: AllocationRow[];
  shortfalls: { sku: string; ordered: string; short: string }[];
  skippedForShelfLife: { lotNumber: string; daysLeft: number }[];
  skippedForLotAge: { lotNumber: string; ageDays: number }[];
  minShelfLifeDays: number;
  maxLotAgeDays: number | null;
  requirementSource: "customer_requirement" | "customer_default";
};

type Insert = { salesOrderLineId: string; lotId: string; locationId: string; qtyUnits: string; containerId: string | null };

/** Boxes at a location holding only this lot, not allocated to any open allocation, full boxes first. */
async function freeBoxes(q: DbOrTx, lotId: string, locationId: string) {
  return q
    .select({ id: containers.id, number: containers.containerNumber, qty: containerContents.qtyBase, isPartial: containers.isPartial })
    .from(containers)
    .innerJoin(containerContents, and(eq(containerContents.containerId, containers.id), eq(containerContents.lotId, lotId), gt(containerContents.qtyBase, "0")))
    .where(
      and(
        eq(containers.currentLocationId, locationId),
        inArray(containers.status, ["open", "sealed"]),
        sql`not exists (select 1 from ${containerContents} o where o.container_id = ${containers.id} and o.lot_id <> ${lotId} and o.qty_base > 0)`,
        sql`not exists (select 1 from ${stockAllocations} a where a.container_id = ${containers.id} and a.status = 'open')`,
      ),
    )
    .orderBy(asc(containers.isPartial), asc(containers.containerNumber));
}

/** Loose (unboxed) quantity of a lot at a location that no open allocation already claims. */
async function freeLoose(q: Tx, lotId: string, locationId: string) {
  const loose = await looseQty(q, lotId, locationId);
  const [a] = await q
    .select({ qty: sql<string>`coalesce(sum(${stockAllocations.qtyUnits}), 0)::text` })
    .from(stockAllocations)
    .innerJoin(salesOrderLines, eq(salesOrderLines.id, stockAllocations.salesOrderLineId))
    .innerJoin(salesOrders, eq(salesOrders.id, salesOrderLines.salesOrderId))
    // Rows from before Wave 3 keep status open after shipping; only open orders hold stock.
    .where(and(eq(stockAllocations.lotId, lotId), eq(stockAllocations.locationId, locationId), eq(stockAllocations.status, "open"), isNull(stockAllocations.containerId), inArray(salesOrders.status, OPEN_ALLOCATION_STATUSES)));
  return Decimal.max(loose.minus(a?.qty ?? 0), 0);
}

/**
 * Splits a lot/location quantity into allocation rows: whole boxes first, then loose units, then
 * (only when nothing else fits) part of a box, which the picker takes out of the box at the shelf.
 */
async function boxPlan(tx: Tx, lotId: string, locationId: string, want: Decimal, usedBoxes: Set<string>, looseUsed: Map<string, Decimal>) {
  const out: { containerId: string | null; boxNumber: string | null; qty: Decimal; partialBox: boolean }[] = [];
  let left = want;
  const boxes = (await freeBoxes(tx, lotId, locationId)).filter((b) => !usedBoxes.has(b.id));
  for (const b of boxes) {
    if (left.lte(0)) break;
    const q = D(b.qty);
    if (q.lte(left)) {
      out.push({ containerId: b.id, boxNumber: b.number, qty: q, partialBox: false });
      usedBoxes.add(b.id);
      left = left.minus(q);
    }
  }
  if (left.gt(0)) {
    const key = `${lotId}|${locationId}`;
    const loose = (await freeLoose(tx, lotId, locationId)).minus(looseUsed.get(key) ?? 0);
    const take = Decimal.min(Decimal.max(loose, 0), left);
    if (take.gt(0)) {
      out.push({ containerId: null, boxNumber: null, qty: take, partialBox: false });
      looseUsed.set(key, (looseUsed.get(key) ?? new Decimal(0)).plus(take));
      left = left.minus(take);
    }
  }
  if (left.gt(0)) {
    const b = boxes.filter((x) => !usedBoxes.has(x.id) && D(x.qty).gt(left)).sort((a, z) => D(a.qty).comparedTo(z.qty))[0];
    if (b) {
      out.push({ containerId: b.id, boxNumber: b.number, qty: left, partialBox: true });
      usedBoxes.add(b.id);
      left = new Decimal(0);
    }
  }
  return out;
}

const ageInDays = (manufacturedOn: string | null, createdAt: Date) => {
  const from = manufacturedOn ? new Date(manufacturedOn + "T00:00:00+08:00") : createdAt;
  return Math.floor((Date.now() - from.getTime()) / 86_400_000);
};

/**
 * FEFO/FIFO allocation (W09-05, US-4-09, A-PROC-09): for each order line, allocates released,
 * unexpired finished-goods lots of the product at the order's site by the configured rule (US-2-20),
 * skipping lots below the customer's minimum remaining shelf life or above its maximum lot age
 * (customer requirements, read through `customerFulfilmentRequirements`), and proposes boxes
 * (whole boxes, then loose units). Partial allocation is kept; the order moves `confirmed → allocated`
 * only when every line is covered. Serialization: the order row, then the candidate lot rows
 * (sorted by id) are locked, the lock order of dispatch posting.
 */
export async function allocateOrder(ctx: AuthContext, orderId: string): Promise<AllocationResult> {
  ctx.require("inventory.allocation.create");
  return db.transaction(async (tx) => {
    const o = await lockOrder(tx, ctx, orderId);
    ctx.requireAt("inventory.allocation.create", o.siteId);
    if (o.status === "allocated") throw new DomainError("state", `Order ${o.orderNumber} is already fully allocated.`);
    if (!ALLOCATABLE_STATUSES.includes(o.status)) throw new DomainError("state", `Order ${o.orderNumber} is ${o.status.replace(/_/g, " ")}; only confirmed orders (or the remainder of a partial shipment) can be allocated.`);

    const lines = await tx
      .select({ id: salesOrderLines.id, productId: salesOrderLines.productId, qty: salesOrderLines.qtyUnits, sku: products.skuCode })
      .from(salesOrderLines)
      .innerJoin(products, eq(products.id, salesOrderLines.productId))
      .where(eq(salesOrderLines.salesOrderId, o.id))
      .orderBy(asc(salesOrderLines.lineNo));
    const existing = lines.length
      ? await tx.select().from(stockAllocations).where(and(inArray(stockAllocations.salesOrderLineId, lines.map((l) => l.id)), ne(stockAllocations.status, "released")))
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
    const candidates = await availableStock(tx, o.siteId, productIds, { excludeDemandIds: lines.map((l) => l.id) });
    const remaining = new Map(candidates.map((c) => [`${c.lotId}|${c.locationId}`, D(c.available)]));

    const firstReq = await customerFulfilmentRequirements(tx, o.organizationId, o.customerId, lines[0]?.productId ?? null);
    const result: AllocationResult = {
      orderNumber: o.orderNumber,
      fullyAllocated: true,
      created: [],
      shortfalls: [],
      skippedForShelfLife: [],
      skippedForLotAge: [],
      minShelfLifeDays: firstReq.minRemainingShelfLifeDays,
      maxLotAgeDays: firstReq.maxLotAgeDays,
      requirementSource: firstReq.source,
    };
    const skipped = new Map<string, number>();
    const tooOld = new Map<string, number>();
    const inserts: Insert[] = [];
    const usedBoxes = new Set<string>();
    const looseUsed = new Map<string, Decimal>();

    for (const line of lines) {
      const already = existing.filter((a) => a.salesOrderLineId === line.id).reduce((s, a) => s.plus(a.qtyUnits), new Decimal(0));
      let need = D(line.qty).minus(already);
      if (need.lte(0)) continue;
      const req = await customerFulfilmentRequirements(tx, o.organizationId, o.customerId, line.productId);
      // FEFO/FIFO rule per product and customer (US-2-20), the same order the recommendation shows.
      const rule = await resolveAllocationStrategy(tx, o.organizationId, { productId: line.productId, customerId: o.customerId });
      const lineMin = Math.max(req.minRemainingShelfLifeDays, rule.minShelfLifeDays ?? 0);
      result.minShelfLifeDays = Math.max(result.minShelfLifeDays, lineMin);
      for (const c of sortCandidates(candidates.filter((x) => x.productId === line.productId), rule.strategy)) {
        if (need.lte(0)) break;
        const left = daysUntil(c.expiresOn);
        if (left !== null && left < lineMin) {
          skipped.set(c.lotNumber, left);
          continue;
        }
        if (req.maxLotAgeDays !== null) {
          const age = ageInDays(c.manufacturedOn, c.lotCreatedAt);
          if (age > req.maxLotAgeDays) {
            tooOld.set(c.lotNumber, age);
            continue;
          }
        }
        const key = `${c.lotId}|${c.locationId}`;
        const avail = remaining.get(key) ?? new Decimal(0);
        if (avail.lte(0)) continue;
        const want = Decimal.min(avail, need);
        const plan = await boxPlan(tx, c.lotId, c.locationId, want, usedBoxes, looseUsed);
        for (const p of plan) {
          remaining.set(key, (remaining.get(key) ?? new Decimal(0)).minus(p.qty));
          need = need.minus(p.qty);
          inserts.push({ salesOrderLineId: line.id, lotId: c.lotId, locationId: c.locationId, qtyUnits: p.qty.toString(), containerId: p.containerId });
          result.created.push({ sku: line.sku, lotNumber: c.lotNumber, locationCode: c.locationCode, qty: p.qty.toString(), boxNumber: p.boxNumber, partialBox: p.partialBox });
        }
      }
      if (need.gt(0)) {
        result.fullyAllocated = false;
        result.shortfalls.push({ sku: line.sku, ordered: D(line.qty).toString(), short: need.toString() });
      }
    }
    result.skippedForShelfLife = [...skipped].map(([lotNumber, daysLeft]) => ({ lotNumber, daysLeft }));
    result.skippedForLotAge = [...tooOld].map(([lotNumber, ageDays]) => ({ lotNumber, ageDays }));

    if (inserts.length === 0) {
      if (!result.fullyAllocated) throw new DomainError("insufficient_stock", describeShortfall(result, "No stock could be allocated."));
    } else {
      await tx.insert(stockAllocations).values(inserts.map((i) => ({ ...i, status: "open", createdBy: ctx.userId })));
    }
    if (result.fullyAllocated) await convertReservationsForDemands(tx, lines.map((l) => l.id));
    const before = o.status;
    if (result.fullyAllocated && o.status === "confirmed") await transitionOrder(tx, ctx, o, "allocated");
    await audit(tx, ctx, {
      action: "inventory.stock_allocation.created",
      entityType: "sales_order",
      entityId: o.id,
      entityNumber: o.orderNumber,
      siteId: o.siteId,
      before: { status: before },
      after: {
        status: o.status,
        allocations: result.created,
        shortfalls: result.shortfalls,
        skippedForShelfLife: result.skippedForShelfLife,
        skippedForLotAge: result.skippedForLotAge,
        minShelfLifeDays: result.minShelfLifeDays,
        requirementSource: result.requirementSource,
      },
    });
    return result;
  });
}

/**
 * Releases open allocations of an order (all, or the listed ones) with a reason (inventory.allocation.void).
 * Allocations on an open pick must be un-picked or the pick cancelled first. An allocated order whose
 * lines are no longer covered returns to confirmed.
 */
export async function releaseAllocations(ctx: AuthContext, orderId: string, input: { allocationIds?: string[]; reason: string }) {
  ctx.require("inventory.allocation.void");
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 3) throw new DomainError("validation", "Say why the allocation is released (at least 3 characters).", { field: "reason" });
  return db.transaction(async (tx) => {
    const o = await lockOrder(tx, ctx, orderId);
    ctx.requireAt("inventory.allocation.void", o.siteId);
    if (!["confirmed", "allocated", "partially_shipped"].includes(o.status)) throw new DomainError("state", `Order ${o.orderNumber} is ${o.status.replace(/_/g, " ")}; allocations can be released before picking starts.`);
    const lineIds = (await tx.select({ id: salesOrderLines.id }).from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, o.id))).map((l) => l.id);
    if (lineIds.length === 0) throw new DomainError("state", "The order has no lines.");
    const conds = [inArray(stockAllocations.salesOrderLineId, lineIds), eq(stockAllocations.status, "open")];
    if (input.allocationIds?.length) conds.push(inArray(stockAllocations.id, input.allocationIds));
    const rows = await tx.select().from(stockAllocations).where(and(...conds)).for("update");
    if (rows.length === 0) throw new DomainError("state", "Nothing open to release on this order.");
    const onPick = await tx
      .select({ id: pickLines.id })
      .from(pickLines)
      .innerJoin(picks, eq(picks.id, pickLines.pickId))
      .where(and(inArray(pickLines.allocationId, rows.map((r) => r.id)), isNull(pickLines.voidedAt), inArray(picks.status, ["draft", "in_progress"])))
      .limit(1);
    if (onPick.length) throw new DomainError("state", "Some of these allocations are already picked on an open pick list. Cancel the pick first.");
    await tx
      .update(stockAllocations)
      .set({ status: "released", releasedAt: new Date(), releasedBy: ctx.userId, releaseReason: reason })
      .where(inArray(stockAllocations.id, rows.map((r) => r.id)));
    const before = o.status;
    if (o.status === "allocated") await transitionOrder(tx, ctx, o, "confirmed", reason);
    await audit(tx, ctx, {
      action: "inventory.stock_allocation.released",
      entityType: "sales_order",
      entityId: o.id,
      entityNumber: o.orderNumber,
      siteId: o.siteId,
      reason,
      before: { status: before, allocations: rows.map((r) => ({ id: r.id, lotId: r.lotId, qty: r.qtyUnits, containerId: r.containerId })) },
      after: { status: o.status },
    });
    return { released: rows.length };
  });
}

/** Open allocations of an order with lot, box and location (pick list rows, allocation summary). */
export async function openAllocationsForOrder(q: DbOrTx, orderId: string) {
  return q
    .select({
      id: stockAllocations.id,
      salesOrderLineId: stockAllocations.salesOrderLineId,
      lotId: stockAllocations.lotId,
      locationId: stockAllocations.locationId,
      containerId: stockAllocations.containerId,
      qty: stockAllocations.qtyUnits,
      status: stockAllocations.status,
      lotNumber: inventoryLots.lotNumber,
      expiresOn: inventoryLots.expiresOn,
      qualityStatus: inventoryLots.qualityStatus,
      baseUom: inventoryLots.baseUom,
      locationCode: locations.code,
      locationName: locations.name,
      boxNumber: containers.containerNumber,
      sku: products.skuCode,
      productName: products.name,
      productId: products.id,
      lineNo: salesOrderLines.lineNo,
    })
    .from(stockAllocations)
    .innerJoin(salesOrderLines, eq(salesOrderLines.id, stockAllocations.salesOrderLineId))
    .innerJoin(products, eq(products.id, salesOrderLines.productId))
    .innerJoin(inventoryLots, eq(inventoryLots.id, stockAllocations.lotId))
    .innerJoin(locations, eq(locations.id, stockAllocations.locationId))
    .leftJoin(containers, eq(containers.id, stockAllocations.containerId))
    .where(and(eq(salesOrderLines.salesOrderId, orderId), eq(stockAllocations.status, "open")))
    .orderBy(asc(locations.code), sql`${inventoryLots.expiresOn} asc nulls last`, asc(inventoryLots.lotNumber), asc(containers.containerNumber));
}

export function describeShortfall(r: AllocationResult, prefix: string): string {
  const parts = r.shortfalls.map((s) => `${s.sku}: ${fmtQty(s.short, "pcs", 0)} short of ${fmtQty(s.ordered, "pcs", 0)} ordered`);
  let msg = `${prefix} Not enough released stock — ${parts.join("; ")}. The order stays confirmed; allocate again when more stock is released.`;
  if (r.skippedForShelfLife.length) {
    msg += ` Skipped lot(s) below the customer's minimum shelf life of ${r.minShelfLifeDays} days: ${r.skippedForShelfLife.map((s) => `${s.lotNumber} (${s.daysLeft} days left)`).join(", ")}.`;
  }
  if (r.skippedForLotAge.length) {
    msg += ` Skipped lot(s) older than the customer's maximum lot age of ${r.maxLotAgeDays} days: ${r.skippedForLotAge.map((s) => `${s.lotNumber} (${s.ageDays} days old)`).join(", ")}.`;
  }
  return msg;
}
