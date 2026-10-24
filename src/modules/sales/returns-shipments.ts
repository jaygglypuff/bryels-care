import "server-only";
import { and, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import type { DbOrTx, Tx } from "@/db/client";
import { containerContents, containers, customerReturnLines, customerReturns, customers, inventoryLots, salesOrders, shipmentLines, shipments, stockMovements } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { transitionShipment, type ShipmentRow } from "./fulfilment-state";

/** Shipment states in which goods are (or were) at the customer: the ones that count for complaints, returns and recall. */
export const LEFT_SITE_SHIPMENT_STATUSES = ["dispatched", "delivered", "returned"] as const;

/**
 * Shipment read model used by complaints (US-4-15), customer returns (US-4-16) and the recall
 * explorer (US-4-17).
 *
 * Integration (Wave 3, W3E fulfilment):
 * - What was shipped per lot is read from the ledger: `shipment` movements whose source document is
 *   the shipment and that were not reversed. This stays valid with any shipment model.
 * - Which BOX left on which shipment is answered ONLY by `shipmentBoxes()` / `shipmentsOfBox()`:
 *   W3E's `shipment_lines` (one row per box, posted when `stock_movement_id` is set) of shipments that
 *   left and were not reversed; shipments from before Wave 3 (no shipment lines) fall back to the MVP
 *   link, `meta.containerId` on their shipment movements.
 * - The shipment state change of a posted return (W09-11) is done ONLY by `applyShipmentReturned()`:
 *   a fully returned shipment moves `dispatched | delivered → returned` through W3E's shipment
 *   machine (`transitionShipment`, transition row + reason); a partial return is recorded by the
 *   audit event `sales.shipment.returned` with `partial: true` and the shipment keeps its state.
 */

/** Movements that have not been reversed. */
const notReversed = sql`not exists (select 1 from ${stockMovements} r where r.reversal_of_id = ${stockMovements.id})`;

export type ShippedLot = { lotId: string; lotNumber: string; productId: string | null; baseUom: string; qtyBase: string };

/** Per lot, the quantity a shipment issued (ledger, reversed rows excluded). */
export async function shippedLotsOf(q: DbOrTx, shipmentId: string): Promise<ShippedLot[]> {
  const rows = await q
    .select({ lotId: stockMovements.lotId, lotNumber: inventoryLots.lotNumber, productId: inventoryLots.productId, baseUom: inventoryLots.baseUom, qty: sql<string>`sum(${stockMovements.qtyBase})::text` })
    .from(stockMovements)
    .innerJoin(inventoryLots, eq(inventoryLots.id, stockMovements.lotId))
    .where(and(eq(stockMovements.sourceDocumentType, "shipment"), eq(stockMovements.sourceDocumentId, shipmentId), eq(stockMovements.movementType, "shipment"), notReversed))
    .groupBy(stockMovements.lotId, inventoryLots.lotNumber, inventoryLots.productId, inventoryLots.baseUom)
    .orderBy(inventoryLots.lotNumber);
  return rows.map((r) => ({ lotId: r.lotId, lotNumber: r.lotNumber, productId: r.productId, baseUom: r.baseUom, qtyBase: new Decimal(r.qty).toString() }));
}

export type ShipmentBox = { shipmentId: string; containerId: string; containerNumber: string; lotId: string; qtyBase: string };

/**
 * Boxes that left on the given shipments (see the integration note above): W3E shipment lines with a
 * box, posted and on a shipment that left and was not reversed; shipments without shipment lines
 * (before Wave 3) use the MVP link `meta.containerId` on their shipment movements.
 */
export async function shipmentBoxes(q: DbOrTx, organizationId: string, shipmentIds: string[]): Promise<ShipmentBox[]> {
  if (!shipmentIds.length) return [];
  const lineRows = await q
    .select({
      shipmentId: shipmentLines.shipmentId,
      containerId: containers.id,
      containerNumber: containers.containerNumber,
      lotId: shipmentLines.lotId,
      qty: sql<string>`sum(${shipmentLines.qtyBase})::text`,
    })
    .from(shipmentLines)
    .innerJoin(shipments, eq(shipments.id, shipmentLines.shipmentId))
    .innerJoin(containers, eq(containers.id, shipmentLines.containerId))
    .where(
      and(
        eq(shipmentLines.organizationId, organizationId),
        inArray(shipmentLines.shipmentId, shipmentIds),
        isNotNull(shipmentLines.stockMovementId),
        inArray(shipments.status, [...LEFT_SITE_SHIPMENT_STATUSES]),
      ),
    )
    .groupBy(shipmentLines.shipmentId, containers.id, containers.containerNumber, shipmentLines.lotId);
  const withLines = new Set(
    (await q.select({ id: shipmentLines.shipmentId }).from(shipmentLines).where(inArray(shipmentLines.shipmentId, shipmentIds)).groupBy(shipmentLines.shipmentId)).map((r) => r.id),
  );
  const legacyIds = shipmentIds.filter((id) => !withLines.has(id));
  const legacyRows = legacyIds.length
    ? await q
        .select({
          shipmentId: stockMovements.sourceDocumentId,
          containerId: containers.id,
          containerNumber: containers.containerNumber,
          lotId: stockMovements.lotId,
          qty: sql<string>`sum(${stockMovements.qtyBase})::text`,
        })
        .from(stockMovements)
        .innerJoin(containers, sql`${containers.id}::text = ${stockMovements.meta}->>'containerId'`)
        .where(
          and(
            eq(stockMovements.organizationId, organizationId),
            eq(stockMovements.sourceDocumentType, "shipment"),
            eq(stockMovements.movementType, "shipment"),
            inArray(stockMovements.sourceDocumentId, legacyIds),
            sql`${stockMovements.meta}->>'containerId' is not null`,
            notReversed,
          ),
        )
        .groupBy(stockMovements.sourceDocumentId, containers.id, containers.containerNumber, stockMovements.lotId)
    : [];
  return [...lineRows, ...legacyRows].map((r) => ({ shipmentId: r.shipmentId!, containerId: r.containerId, containerNumber: r.containerNumber, lotId: r.lotId, qtyBase: new Decimal(r.qty).toString() }));
}

/** Shipments a box left on (inverse of `shipmentBoxes`, same sources). */
export async function shipmentsOfBox(q: DbOrTx, organizationId: string, containerId: string): Promise<ShipmentBox[]> {
  const viaLines = await q
    .select({ shipmentId: shipmentLines.shipmentId })
    .from(shipmentLines)
    .where(and(eq(shipmentLines.organizationId, organizationId), eq(shipmentLines.containerId, containerId)));
  const viaMeta = await q
    .select({ shipmentId: stockMovements.sourceDocumentId })
    .from(stockMovements)
    .where(and(eq(stockMovements.organizationId, organizationId), eq(stockMovements.movementType, "shipment"), sql`${stockMovements.meta}->>'containerId' = ${containerId}`, notReversed));
  const ids = [...new Set([...viaLines, ...viaMeta].map((r) => r.shipmentId).filter((x): x is string => !!x))];
  return (await shipmentBoxes(q, organizationId, ids)).filter((b) => b.containerId === containerId);
}

/**
 * Lots a box holds or held: current contents, historical movements tagged with the box and the
 * contract's shipment links. Used to resolve a scanned box to the lot(s) inside it.
 */
export async function lotsOfBox(q: DbOrTx, organizationId: string, containerId: string): Promise<string[]> {
  const cc = await q.select({ lotId: containerContents.lotId }).from(containerContents).where(eq(containerContents.containerId, containerId));
  const mv = await q
    .select({ lotId: stockMovements.lotId })
    .from(stockMovements)
    .where(and(eq(stockMovements.organizationId, organizationId), sql`${stockMovements.meta}->>'containerId' = ${containerId}`, ne(stockMovements.movementType, "return")));
  const sb = await shipmentsOfBox(q, organizationId, containerId);
  return [...new Set([...cc.map((r) => r.lotId), ...mv.map((r) => r.lotId), ...sb.map((r) => r.lotId)])];
}

export type CustomerShipment = { shipmentId: string; siteId: string; drNumber: string; dispatchedAt: Date; deliveredAt: Date | null; orderId: string; orderNumber: string; lotIds: string[] };

/** Shipments of a customer at the given sites (newest first) with the lots each issued. */
export async function shipmentsOfCustomer(q: DbOrTx, organizationId: string, customerId: string, siteIds: string[]): Promise<CustomerShipment[]> {
  if (!siteIds.length) return [];
  const rows = await q
    .select({ shipment: shipments, orderNumber: salesOrders.orderNumber })
    .from(shipments)
    .innerJoin(salesOrders, eq(salesOrders.id, shipments.salesOrderId))
    .where(and(eq(shipments.organizationId, organizationId), eq(salesOrders.customerId, customerId), inArray(shipments.siteId, siteIds), inArray(shipments.status, [...LEFT_SITE_SHIPMENT_STATUSES]), isNotNull(shipments.dispatchedAt)))
    .orderBy(desc(shipments.dispatchedAt));
  if (!rows.length) return [];
  const lots = await q
    .select({ shipmentId: stockMovements.sourceDocumentId, lotId: stockMovements.lotId })
    .from(stockMovements)
    .where(and(eq(stockMovements.sourceDocumentType, "shipment"), eq(stockMovements.movementType, "shipment"), inArray(stockMovements.sourceDocumentId, rows.map((r) => r.shipment.id)), notReversed));
  return rows.map((r) => ({
    shipmentId: r.shipment.id,
    siteId: r.shipment.siteId,
    drNumber: shipmentRef(r.shipment),
    dispatchedAt: r.shipment.dispatchedAt!,
    deliveredAt: r.shipment.deliveredAt,
    orderId: r.shipment.salesOrderId,
    orderNumber: r.orderNumber,
    lotIds: [...new Set(lots.filter((l) => l.shipmentId === r.shipment.id).map((l) => l.lotId))],
  }));
}

/** The shipment with its order and customer, when it is at one of the user's sites. */
export async function shipmentInScope(q: DbOrTx, ctx: AuthContext, shipmentId: string, opts: { lock?: boolean } = {}) {
  const base = q
    .select({ shipment: shipments, orderNumber: salesOrders.orderNumber, customerId: customers.id, customerName: customers.name })
    .from(shipments)
    .innerJoin(salesOrders, eq(salesOrders.id, shipments.salesOrderId))
    .innerJoin(customers, eq(customers.id, salesOrders.customerId))
    .where(and(eq(shipments.id, shipmentId), eq(shipments.organizationId, ctx.organizationId), inArray(shipments.siteId, ctx.allowedSiteIds)))
    .limit(1);
  const [row] = opts.lock ? await base.for("update", { of: shipments }) : await base;
  return row ?? null;
}

/** Quantity per origin lot already on returns of a shipment (all statuses except cancelled), optionally only posted lines. */
export async function returnedQtyByLot(q: DbOrTx, shipmentIds: string[], opts: { postedOnly?: boolean; excludeReturnId?: string } = {}): Promise<Map<string, Decimal>> {
  const out = new Map<string, Decimal>();
  if (!shipmentIds.length) return out;
  const rows = await q
    .select({ shipmentId: customerReturns.shipmentId, lotId: customerReturnLines.lotId, qty: sql<string>`sum(${customerReturnLines.qtyBase})::text` })
    .from(customerReturnLines)
    .innerJoin(customerReturns, eq(customerReturns.id, customerReturnLines.customerReturnId))
    .where(
      and(
        inArray(customerReturns.shipmentId, shipmentIds),
        ne(customerReturns.status, "cancelled"),
        opts.postedOnly ? isNotNull(customerReturnLines.stockMovementId) : undefined,
        opts.excludeReturnId ? ne(customerReturns.id, opts.excludeReturnId) : undefined,
      ),
    )
    .groupBy(customerReturns.shipmentId, customerReturnLines.lotId);
  for (const r of rows) out.set(`${r.shipmentId}:${r.lotId}`, new Decimal(r.qty));
  return out;
}

/** Shipped vs returned (posted) per lot of one shipment, and whether it is now fully or partly returned. */
export async function shipmentReturnState(q: DbOrTx, shipmentId: string) {
  const shipped = await shippedLotsOf(q, shipmentId);
  const returned = await returnedQtyByLot(q, [shipmentId], { postedOnly: true });
  const lines = shipped.map((s) => ({ ...s, returnedQty: (returned.get(`${shipmentId}:${s.lotId}`) ?? new Decimal(0)).toString() }));
  const any = lines.some((l) => new Decimal(l.returnedQty).gt(0));
  const full = lines.length > 0 && lines.every((l) => new Decimal(l.returnedQty).gte(l.qtyBase));
  return { lines, state: full ? ("returned" as const) : any ? ("partially_returned" as const) : ("not_returned" as const) };
}

/** The number people know a shipment by: its DR number once dispatched, else the shipment number. */
export function shipmentRef(s: { deliveryReceiptNumber: string | null; shipmentNumber: string | null }): string {
  return s.deliveryReceiptNumber ?? s.shipmentNumber ?? "—";
}

/**
 * Shipment state change after a posted return (integration note above). The caller holds the
 * shipment row lock (`shipmentInScope(..., { lock: true })`).
 */
export async function applyShipmentReturned(tx: Tx, ctx: AuthContext, shipment: ShipmentRow, info: { returnNumber: string }) {
  const s = await shipmentReturnState(tx, shipment.id);
  const before = shipment.status;
  if (s.state === "returned" && (shipment.status === "dispatched" || shipment.status === "delivered")) {
    await transitionShipment(tx, ctx, shipment, "returned", {}, `Customer return ${info.returnNumber}`);
  }
  await audit(tx, ctx, {
    action: "sales.shipment.returned",
    entityType: "shipment",
    entityId: shipment.id,
    entityNumber: shipmentRef(shipment),
    siteId: shipment.siteId,
    before: { status: before, delivered: !!shipment.deliveredAt },
    after: { status: s.state === "returned" ? "returned" : before, state: s.state, partial: s.state !== "returned", returnNumber: info.returnNumber, lines: s.lines.map((l) => ({ lot: l.lotNumber, shipped: l.qtyBase, returned: l.returnedQty })) },
  });
  return s.state;
}
