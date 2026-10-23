import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import { customers, inventoryLots, locations, organizations, products, salesOrderLines, salesOrders, shipments, sites, stockAllocations, stockMovements, users } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import { nextNumber } from "@/lib/numbering";
import { D } from "@/lib/qty";
import { assertLotUsable, postMovement } from "@/modules/inventory/ledger";
import { assertTransition, lockOrder } from "./orders";

export type DispatchInput = { carrier: string; driverName: string; vehiclePlate: string; packageCount: number };

/**
 * Dispatch posting (W09-08). One transaction: re-checks every allocated lot is still released and
 * unexpired, numbers the DR, posts one shipment movement per allocation (stock is issued now),
 * and moves the order to shipped. Ships exactly the allocations, so over-shipment is impossible.
 */
export async function dispatchOrder(ctx: AuthContext, orderId: string, input: DispatchInput) {
  ctx.require("sales.shipment.post");
  return db.transaction(async (tx) => {
    const o = await lockOrder(tx, ctx, orderId);
    assertTransition(o.status, "shipped", o.orderNumber);
    const lines = await tx
      .select({ id: salesOrderLines.id, qty: salesOrderLines.qtyUnits, sku: products.skuCode })
      .from(salesOrderLines)
      .innerJoin(products, eq(products.id, salesOrderLines.productId))
      .where(eq(salesOrderLines.salesOrderId, o.id));
    const allocs = lines.length
      ? await tx
          .select({ alloc: stockAllocations, lot: inventoryLots })
          .from(stockAllocations)
          .innerJoin(inventoryLots, eq(inventoryLots.id, stockAllocations.lotId))
          .where(inArray(stockAllocations.salesOrderLineId, lines.map((l) => l.id)))
          .orderBy(asc(stockAllocations.lotId), asc(stockAllocations.locationId))
      : [];
    if (allocs.length === 0) throw new DomainError("state", "Nothing is allocated to this order.");
    // Over-shipment guard: allocations can never exceed the ordered quantity.
    for (const l of lines) {
      const sum = allocs.filter((a) => a.alloc.salesOrderLineId === l.id).reduce((s, a) => s.plus(a.alloc.qtyUnits), new Decimal(0));
      if (sum.gt(l.qty)) throw new DomainError("conflict", `Allocated quantity for ${l.sku} exceeds the ordered quantity; re-allocate the order.`);
    }
    // Lock lots (sorted by id, matching allocation) and re-check status/expiry at posting time.
    const lotIds = [...new Set(allocs.map((a) => a.lot.id))].sort();
    const lockedLots = await tx.select().from(inventoryLots).where(inArray(inventoryLots.id, lotIds)).orderBy(asc(inventoryLots.id)).for("update");
    for (const lot of lockedLots) {
      if (lot.siteId !== o.siteId) throw new DomainError("conflict", `Lot ${lot.lotNumber} is not at this order's site.`);
      try {
        assertLotUsable(lot);
      } catch (e) {
        if (e instanceof DomainError) throw new DomainError("blocked_lot", `${e.message} Dispatch was not posted; ask QA, or cancel and re-allocate the order.`);
        throw e;
      }
    }

    const drNumber = await nextNumber(tx, ctx.organizationId, "DR");
    const [shipment] = await tx
      .insert(shipments)
      .values({
        organizationId: ctx.organizationId,
        siteId: o.siteId,
        salesOrderId: o.id,
        deliveryReceiptNumber: drNumber,
        carrier: input.carrier,
        driverName: input.driverName,
        vehiclePlate: input.vehiclePlate,
        packageCount: input.packageCount,
        dispatchedBy: ctx.userId,
      })
      .returning();
    const posted: { lotNumber: string; qty: string; movementId: string }[] = [];
    for (const { alloc, lot } of allocs) {
      const { movement } = await postMovement(tx, ctx, {
        movementType: "shipment",
        lotId: alloc.lotId,
        fromLocationId: alloc.locationId,
        toLocationId: null,
        qtyBase: alloc.qtyUnits,
        sourceDocumentType: "shipment",
        sourceDocumentId: shipment.id,
        sourceDocumentNumber: drNumber,
        reason: `Dispatch of ${o.orderNumber}`,
        idempotencyKey: `shipment:${alloc.id}`,
        meta: { salesOrderId: o.id, salesOrderNumber: o.orderNumber, allocationId: alloc.id },
      });
      posted.push({ lotNumber: lot.lotNumber, qty: D(alloc.qtyUnits).toString(), movementId: movement.id });
    }
    await tx.update(salesOrders).set({ status: "shipped" }).where(eq(salesOrders.id, o.id));
    await audit(tx, ctx, {
      action: "sales.shipment.dispatched",
      entityType: "shipment",
      entityId: shipment.id,
      entityNumber: drNumber,
      siteId: o.siteId,
      before: { orderStatus: o.status },
      after: { orderNumber: o.orderNumber, orderStatus: "shipped", shipment, movements: posted },
    });
    return shipment;
  });
}

export async function recordDelivery(ctx: AuthContext, shipmentId: string, input: { receivedByName: string; deliveredAt: Date }) {
  ctx.require("sales.shipment.post");
  if (input.deliveredAt.getTime() > Date.now() + 5 * 60_000) throw new DomainError("validation", "Delivery time cannot be in the future.");
  return db.transaction(async (tx) => {
    const [s] = await tx
      .select()
      .from(shipments)
      .where(and(eq(shipments.id, shipmentId), eq(shipments.organizationId, ctx.organizationId), inArray(shipments.siteId, ctx.allowedSiteIds)))
      .for("update")
      .limit(1);
    if (!s) throw new DomainError("not_found", "Shipment not found in your sites.");
    ctx.requireSite(s.siteId);
    if (s.deliveredAt) throw new DomainError("state", `Delivery of ${s.deliveryReceiptNumber} is already recorded.`);
    // The form captures minutes only, so compare against the dispatch minute.
    if (input.deliveredAt.getTime() < Math.floor(s.dispatchedAt.getTime() / 60_000) * 60_000) throw new DomainError("validation", "Delivery time cannot be before dispatch.");
    await tx.update(shipments).set({ receivedByName: input.receivedByName, deliveredAt: input.deliveredAt }).where(eq(shipments.id, s.id));
    await audit(tx, ctx, {
      action: "sales.shipment.delivered",
      entityType: "shipment",
      entityId: s.id,
      entityNumber: s.deliveryReceiptNumber,
      siteId: s.siteId,
      before: { receivedByName: s.receivedByName, deliveredAt: s.deliveredAt },
      after: { receivedByName: input.receivedByName, deliveredAt: input.deliveredAt },
    });
  });
}

/** Data for the printed delivery receipt; items come from the posted shipment movements (the ledger). */
export async function getDeliveryReceipt(ctx: AuthContext, shipmentId: string) {
  ctx.require("sales.shipment.view");
  const [row] = await db
    .select({ shipment: shipments, order: salesOrders, customer: customers, site: sites, organizationName: organizations.name, dispatcher: users.displayName })
    .from(shipments)
    .innerJoin(salesOrders, eq(salesOrders.id, shipments.salesOrderId))
    .innerJoin(customers, eq(customers.id, salesOrders.customerId))
    .innerJoin(sites, eq(sites.id, shipments.siteId))
    .innerJoin(organizations, eq(organizations.id, shipments.organizationId))
    .innerJoin(users, eq(users.id, shipments.dispatchedBy))
    .where(and(eq(shipments.id, shipmentId), eq(shipments.organizationId, ctx.organizationId), inArray(shipments.siteId, ctx.allowedSiteIds)))
    .limit(1);
  if (!row) throw new DomainError("not_found", "Shipment not found in your sites.");
  const items = await db
    .select({
      movementId: stockMovements.id,
      qty: stockMovements.qtyBase,
      uom: stockMovements.baseUom,
      lotNumber: inventoryLots.lotNumber,
      expiresOn: inventoryLots.expiresOn,
      sku: products.skuCode,
      productName: products.name,
      locationCode: locations.code,
    })
    .from(stockMovements)
    .innerJoin(inventoryLots, eq(inventoryLots.id, stockMovements.lotId))
    .innerJoin(products, eq(products.id, inventoryLots.productId))
    .leftJoin(locations, eq(locations.id, stockMovements.fromLocationId))
    .where(and(eq(stockMovements.sourceDocumentType, "shipment"), eq(stockMovements.sourceDocumentId, row.shipment.id), eq(stockMovements.movementType, "shipment")))
    .orderBy(asc(products.skuCode), asc(inventoryLots.lotNumber));
  return { ...row, items, totalQty: items.reduce((s, i) => s.plus(i.qty), new Decimal(0)).toString() };
}
