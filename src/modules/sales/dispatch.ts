import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { randomUUID } from "node:crypto";
import { db, type Tx } from "@/db/client";
import {
  containerContents,
  containers,
  customers,
  deliveryReceipts,
  generatedDocuments,
  inventoryLots,
  locations,
  packs,
  picks,
  products,
  salesOrderLines,
  salesOrders,
  shipmentExceptions,
  shipmentLines,
  shipmentStateTransitions,
  shipments,
  stockAllocations,
  stockMovements,
  users,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { nextNumber } from "@/lib/numbering";
import { D } from "@/lib/qty";
import { getSetting } from "@/lib/settings";
import { addContent, assertLotUsable, claimIdempotencyKey, containerMachine, contentsOf, lockContainers, lockLots, postMovement, storeIdempotentResult, takeContent } from "@/modules/inventory";
import { markDocumentVoid } from "@/modules/documents";
import { lockOrder } from "./orders";
import { openAllocationsForOrder } from "./allocation";
import { issueDeliveryReceiptInTx, liveDeliveryReceipt, voidDeliveryReceiptInTx } from "./delivery-receipts";
import { CUSTOMER_HEADER_COLUMNS, ORDER_HEADER_COLUMNS, isUuid, lockShipment, peekShipment, advanceOrder, transitionShipment, type OrderRow, type ShipmentRow } from "./fulfilment-state";
import { shippedByOrderLine } from "./packing";

/**
 * Dispatch posting (US-4-12, W09-08, AC-17). One transaction: re-checks every lot (released, not
 * expired: an `on_hold` lot blocks posting even if it was allocated) and every box, posts one
 * `shipment` movement per shipment line through `postMovement` (stock is issued now, never when a
 * draft DR is printed), marks fully shipped boxes `shipped`, fulfils the allocations, numbers the DR,
 * closes the verification pack and moves the order to shipped / partially_shipped. Σ shipment_lines
 * equals the shipment's movements (`shipmentReconciliation`). Reversal posts reversal movements back
 * to the original locations, returns the boxes to `sealed`, re-opens the allocations and voids the DR.
 */

export type DispatchShipmentInput = { driverName: string; vehiclePlate: string; carrierName?: string | null; idempotencyKey: string };

type DispatchResult = { shipmentId: string; shipmentNumber: string | null; drNumber: string; orderStatus: string; movements: number; documentNumber: string | null };

function validateDriver(input: { driverName: string; vehiclePlate: string }) {
  const fe: Record<string, string> = {};
  if ((input.driverName?.trim() ?? "").length < 1) fe.driverName = "Enter the driver's name.";
  if ((input.vehiclePlate?.trim() ?? "").length < 2) fe.vehiclePlate = "Enter the vehicle plate.";
  if ((input.driverName ?? "").length > 80) fe.driverName = "At most 80 characters.";
  if ((input.vehiclePlate ?? "").length > 20) fe.vehiclePlate = "At most 20 characters.";
  if (Object.keys(fe).length) throw new DomainError("validation", Object.values(fe)[0], { fieldErrors: fe });
}

/** Order status after a dispatch or reversal, from the dispatched quantities per line. */
async function fulfilmentStatus(tx: Tx, orderId: string): Promise<"shipped" | "partially_shipped" | "none"> {
  const lines = await tx.select({ id: salesOrderLines.id, qty: salesOrderLines.qtyUnits }).from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, orderId));
  const shipped = await shippedByOrderLine(tx, orderId);
  if ([...shipped.values()].every((v) => v.lte(0))) return "none";
  return lines.every((l) => (shipped.get(l.id) ?? new Decimal(0)).gte(l.qty)) ? "shipped" : "partially_shipped";
}

/** The core of a dispatch, shared by the shipment flow and the (switched-off) direct dispatch. */
async function postDispatch(tx: Tx, ctx: AuthContext, o: OrderRow, s: ShipmentRow, input: { driverName: string; vehiclePlate: string; carrierName?: string | null; packageCount?: number | null }): Promise<DispatchResult> {
  const lines = await tx.select().from(shipmentLines).where(eq(shipmentLines.shipmentId, s.id)).orderBy(asc(shipmentLines.lotId), asc(shipmentLines.id));
  if (lines.length === 0) throw new DomainError("state", "This shipment has no verified lines.");
  // Lot locks (id order) and the status re-check at posting time (V-HOLD / V-EXP / V-REC).
  const lots = await lockLots(tx, lines.map((l) => l.lotId));
  for (const lot of lots) {
    if (lot.siteId !== s.siteId) throw new DomainError("conflict", `Lot ${lot.lotNumber} is not at this shipment's site.`);
    try {
      assertLotUsable(lot);
    } catch (e) {
      if (e instanceof DomainError) throw new DomainError("blocked_lot", `${e.message} Dispatch was not posted; ask QA, or re-allocate the order.`, { rule: "shipment.dispatch_rechecks_status" });
      throw e;
    }
  }
  // Boxes: still open/sealed, at the line's location, holding at least the line's quantity.
  const boxIds = lines.map((l) => l.containerId).filter((x): x is string => !!x);
  const boxes = boxIds.length ? await lockContainers(tx, ctx, boxIds) : [];
  for (const l of lines.filter((x) => x.containerId)) {
    const b = boxes.find((x) => x.id === l.containerId)!;
    if (!["open", "sealed"].includes(b.status) || b.currentLocationId !== l.fromLocationId) throw new DomainError("conflict", `Box ${b.containerNumber} is ${b.status} or has moved since it was verified. Verify the shipment again.`);
    const [c] = await tx.select().from(containerContents).where(and(eq(containerContents.containerId, b.id), eq(containerContents.lotId, l.lotId))).limit(1);
    if (!c || D(c.qtyBase).lt(l.qtyBase)) throw new DomainError("conflict", `Box ${b.containerNumber} no longer holds what was verified. Verify the shipment again.`);
  }
  // Allocations still open (not released meanwhile).
  const allocIds = [...new Set(lines.map((l) => l.allocationId).filter((x): x is string => !!x))];
  const allocs = allocIds.length ? await tx.select().from(stockAllocations).where(inArray(stockAllocations.id, allocIds)).for("update") : [];
  for (const a of allocs) if (a.status !== "open") throw new DomainError("conflict", "An allocation of this shipment was released meanwhile. Re-allocate and pick again.");

  const correlationId = randomUUID();
  const posted: { lotNumber: string; qty: string; movementId: string; box: string | null }[] = [];
  for (const l of lines) {
    const lot = lots.find((x) => x.id === l.lotId)!;
    const box = l.containerId ? boxes.find((b) => b.id === l.containerId)! : null;
    const { movement } = await postMovement(tx, ctx, {
      movementType: "shipment",
      lotId: l.lotId,
      fromLocationId: l.fromLocationId,
      toLocationId: null,
      qtyBase: l.qtyBase,
      sourceDocumentType: "shipment",
      sourceDocumentId: s.id,
      sourceDocumentNumber: s.shipmentNumber ?? undefined,
      reason: `Dispatch of ${o.orderNumber}`,
      idempotencyKey: `shipment_line:${l.id}`,
      correlationId,
      meta: { salesOrderId: o.id, salesOrderNumber: o.orderNumber, shipmentNumber: s.shipmentNumber, allocationId: l.allocationId, containerId: l.containerId, containerNumber: box?.containerNumber ?? null, overShipment: l.isOverShipment },
    });
    await tx.update(shipmentLines).set({ stockMovementId: movement.id }).where(eq(shipmentLines.id, l.id));
    posted.push({ lotNumber: lot.lotNumber, qty: D(l.qtyBase).toString(), movementId: movement.id, box: box?.containerNumber ?? null });
  }
  // Boxes: a box shipped whole is `shipped` (contents kept as its record); part of a box leaves the rest in it.
  for (const b of boxes) {
    const shippedFromBox = lines.filter((l) => l.containerId === b.id);
    const contents = await contentsOf(tx, b.id);
    const whole = contents.every((c) => shippedFromBox.filter((l) => l.lotId === c.lotId).reduce((a, l) => a.plus(l.qtyBase), new Decimal(0)).eq(c.qtyBase));
    if (whole) {
      containerMachine.assert(b.status, "shipped", `Box ${b.containerNumber}`);
      await tx.update(containers).set({ status: "shipped", updatedAt: new Date() }).where(eq(containers.id, b.id));
    } else {
      for (const l of shippedFromBox) await takeContent(tx, b.id, l.lotId, D(l.qtyBase));
      if (b.status === "sealed") await tx.update(containers).set({ status: "open", updatedAt: new Date() }).where(eq(containers.id, b.id));
    }
  }
  // Allocations: fulfilled for the shipped part; an unshipped remainder stays open as its own row.
  for (const a of allocs) {
    const shippedQty = lines.filter((l) => l.allocationId === a.id).reduce((x, l) => x.plus(l.qtyBase), new Decimal(0));
    const rest = D(a.qtyUnits).minus(shippedQty);
    await tx.update(stockAllocations).set({ status: "fulfilled", fulfilledShipmentId: s.id, qtyUnits: Decimal.min(shippedQty, a.qtyUnits).toString() }).where(eq(stockAllocations.id, a.id));
    if (rest.gt(0)) {
      await tx.insert(stockAllocations).values({ salesOrderLineId: a.salesOrderLineId, lotId: a.lotId, locationId: a.locationId, qtyUnits: rest.toString(), containerId: a.containerId, status: "open", createdBy: ctx.userId });
    }
  }
  // Numbering last (data-model §5.4).
  const drNumber = await nextNumber(tx, ctx.organizationId, "DR");
  const packageCount = input.packageCount ?? s.packageCount ?? Math.max(boxes.length, 1);
  await transitionShipment(tx, ctx, s, "dispatched", {
    deliveryReceiptNumber: drNumber,
    dispatchedAt: new Date(),
    dispatchedBy: ctx.userId,
    driverName: input.driverName.trim(),
    vehiclePlate: input.vehiclePlate.trim().toUpperCase(),
    carrier: input.carrierName?.trim() || s.carrier || "Own truck",
    packageCount,
    correlationId,
  });
  const status = await fulfilmentStatus(tx, o.id);
  const before = o.status;
  await advanceOrder(tx, ctx, o, status === "shipped" ? "shipped" : "partially_shipped");
  if (status === "shipped") {
    // Fully shipped: allocations not used by any shipment no longer hold stock.
    const lineIds = (await tx.select({ id: salesOrderLines.id }).from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, o.id))).map((l) => l.id);
    await tx
      .update(stockAllocations)
      .set({ status: "released", releasedAt: new Date(), releasedBy: ctx.userId, releaseReason: `Order ${o.orderNumber} fully shipped by ${s.shipmentNumber ?? drNumber}` })
      .where(and(inArray(stockAllocations.salesOrderLineId, lineIds), eq(stockAllocations.status, "open")));
  }
  await tx.update(packs).set({ status: "closed", closedAt: new Date(), updatedAt: new Date() }).where(and(eq(packs.shipmentId, s.id), eq(packs.status, "verified")));
  const [fresh] = await tx.select().from(shipments).where(eq(shipments.id, s.id));
  const { document } = await issueDeliveryReceiptInTx(tx, ctx, fresh, drNumber);
  await audit(tx, ctx, {
    action: "sales.shipment.dispatched",
    entityType: "shipment",
    entityId: s.id,
    entityNumber: drNumber,
    siteId: s.siteId,
    correlationId,
    before: { status: s.status, orderStatus: before },
    after: { shipmentNumber: s.shipmentNumber, orderNumber: o.orderNumber, orderStatus: o.status, driver: input.driverName.trim(), plate: input.vehiclePlate.trim().toUpperCase(), movements: posted, documentNumber: document?.documentNumber ?? null },
  });
  return { shipmentId: s.id, shipmentNumber: s.shipmentNumber, drNumber, orderStatus: o.status, movements: posted.length, documentNumber: document?.documentNumber ?? null };
}

/** "Dispatch shipment" (sales.shipment.post, S): a packed shipment leaves the dock. */
export async function dispatchShipment(ctx: AuthContext, shipmentId: string, input: DispatchShipmentInput): Promise<DispatchResult & { replayed: boolean }> {
  ctx.require("sales.shipment.post");
  validateDriver(input);
  if (!input.idempotencyKey || input.idempotencyKey.length < 8) throw new DomainError("validation", "The form is missing its submission key. Reload the page and try again.");
  const key = `dispatch:${input.idempotencyKey}`;
  const body = { shipmentId, driver: input.driverName.trim(), plate: input.vehiclePlate.trim().toUpperCase(), carrier: input.carrierName?.trim() || null };
  return db.transaction(async (tx) => {
    const claimed = await claimIdempotencyKey<DispatchResult>(tx, ctx.organizationId, key, "sales.shipment.dispatch", body);
    if (claimed) return { ...claimed.replay, replayed: true };
    const peek = await peekShipment(tx, ctx, shipmentId);
    const o = await lockOrder(tx, ctx, peek.salesOrderId);
    const s = await lockShipment(tx, ctx, shipmentId);
    ctx.requireAt("sales.shipment.post", s.siteId);
    if (s.status !== "packed") throw new DomainError("state", `Shipment ${s.shipmentNumber} is ${s.status}; only a packed (verified) shipment is dispatched.`);
    const r = await postDispatch(tx, ctx, o, s, input);
    await storeIdempotentResult(tx, ctx.organizationId, key, body, r);
    return { ...r, replayed: false };
  });
}

export type DispatchInput = { carrier: string; driverName: string; vehiclePlate: string; packageCount: number };

/**
 * MVP direct dispatch (allocated → shipped without pick and pack verification). Switched off by
 * default (`sales.fulfilment.direct_dispatch_allowed`, A-W3E-02) because AC-17 requires the pack
 * verification; kept so existing callers fail with a clear message and so a site can be allowed to
 * use it during a transition. Ships exactly the open allocations through the same posting core.
 */
export async function dispatchOrder(ctx: AuthContext, orderId: string, input: DispatchInput) {
  ctx.require("sales.shipment.post");
  return db.transaction(async (tx) => {
    const o = await lockOrder(tx, ctx, orderId);
    ctx.requireAt("sales.shipment.post", o.siteId);
    if (!(await getSetting(tx, ctx.organizationId, "sales.fulfilment.direct_dispatch_allowed", o.siteId))) {
      throw new DomainError("state", "Dispatch goes through the pick list and pack verification: start the pick from Fulfilment → Picking. (Direct dispatch is switched off, A-W3E-02.)", { rule: "AC-17" });
    }
    if (o.status !== "allocated") throw new DomainError("state", `Order ${o.orderNumber} is ${o.status.replace(/_/g, " ")} and cannot be moved to shipped.`);
    validateDriver(input);
    const allocs = await openAllocationsForOrder(tx, o.id);
    if (allocs.length === 0) throw new DomainError("state", "Nothing is allocated to this order.");
    const [cust] = await tx.select().from(customers).where(eq(customers.id, o.customerId)).limit(1);
    const shipmentNumber = await nextNumber(tx, ctx.organizationId, "SH");
    const [s] = await tx
      .insert(shipments)
      .values({ organizationId: ctx.organizationId, siteId: o.siteId, salesOrderId: o.id, shipmentNumber, status: "packed", shipToAddress: cust?.shipToAddress ?? null, carrier: input.carrier.trim(), packageCount: input.packageCount, packedBy: ctx.userId, packedAt: new Date(), createdBy: ctx.userId, createdAt: new Date() })
      .returning();
    await tx.insert(shipmentStateTransitions).values({ organizationId: ctx.organizationId, shipmentId: s.id, fromState: null, toState: "packed", actorId: ctx.userId, reason: "Direct dispatch (A-W3E-02)" });
    await tx.insert(shipmentLines).values(
      allocs.map((a) => ({ organizationId: ctx.organizationId, siteId: o.siteId, shipmentId: s.id, salesOrderLineId: a.salesOrderLineId, allocationId: a.id, containerId: a.containerId, lotId: a.lotId, fromLocationId: a.locationId, qtyBase: a.qty, baseUom: a.baseUom, verifiedBy: ctx.userId })),
    );
    const r = await postDispatch(tx, ctx, o, s, { driverName: input.driverName, vehiclePlate: input.vehiclePlate, carrierName: input.carrier, packageCount: input.packageCount });
    const [row] = await tx.select().from(shipments).where(eq(shipments.id, s.id));
    return { ...row, drNumber: r.drNumber };
  });
}

/**
 * Guard consulted before a dispatch is reversed (Wave 4 integration): finance registers one in
 * src/modules/wiring.ts that refuses when the shipment has a live invoice (sales must not import finance).
 * It returns the refusal message, or null when the reversal may go ahead. Runs after the shipment row is
 * locked, and invoice creation locks the same row, so the two serialize.
 */
export type ShipmentReversalGuard = (tx: Tx, organizationId: string, shipmentId: string) => Promise<string | null>;
const REVERSAL_GUARD_KEY = "__bc_sales_shipment_reversal_guard__";
export function registerShipmentReversalGuard(fn: ShipmentReversalGuard) {
  (globalThis as unknown as Record<string, ShipmentReversalGuard>)[REVERSAL_GUARD_KEY] = fn;
}
function shipmentReversalGuard(): ShipmentReversalGuard | null {
  return (globalThis as unknown as Record<string, ShipmentReversalGuard | undefined>)[REVERSAL_GUARD_KEY] ?? null;
}

/** Reverses a dispatched shipment (sales.shipment.void, S) with a reason: stock returns to where it left. */
export async function reverseShipment(ctx: AuthContext, shipmentId: string, input: { reason: string; idempotencyKey: string }) {
  ctx.require("sales.shipment.void");
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 5) throw new DomainError("validation", "Give the reason for the reversal (at least 5 characters).", { field: "reason" });
  if (!input.idempotencyKey || input.idempotencyKey.length < 8) throw new DomainError("validation", "The form is missing its submission key. Reload the page and try again.");
  const key = `dispatch_reverse:${input.idempotencyKey}`;
  const body = { shipmentId, reason };
  return db.transaction(async (tx) => {
    const claimed = await claimIdempotencyKey<{ shipmentNumber: string | null; orderStatus: string; movements: number }>(tx, ctx.organizationId, key, "sales.shipment.reverse", body);
    if (claimed) return { ...claimed.replay, replayed: true };
    const peek = await peekShipment(tx, ctx, shipmentId);
    const o = await lockOrder(tx, ctx, peek.salesOrderId);
    const s = await lockShipment(tx, ctx, shipmentId);
    ctx.requireAt("sales.shipment.void", s.siteId);
    if (s.status !== "dispatched") throw new DomainError("state", s.status === "delivered" ? `Shipment ${s.shipmentNumber} was delivered; goods coming back are a customer return, not a reversal.` : `Shipment ${s.shipmentNumber ?? s.deliveryReceiptNumber} is ${s.status}; only a dispatched shipment can be reversed.`);
    const blocked = await shipmentReversalGuard()?.(tx, ctx.organizationId, s.id);
    if (blocked) throw new DomainError("conflict", blocked, { code: "SHIPMENT_INVOICED" });
    const lines = await tx.select().from(shipmentLines).where(and(eq(shipmentLines.shipmentId, s.id), isNotNull(shipmentLines.stockMovementId))).orderBy(asc(shipmentLines.lotId), asc(shipmentLines.id));
    const legacy = lines.length === 0;
    const movements = await tx.select().from(stockMovements).where(and(eq(stockMovements.sourceDocumentType, "shipment"), eq(stockMovements.sourceDocumentId, s.id), eq(stockMovements.movementType, "shipment")));
    if (movements.length === 0) throw new DomainError("state", "This shipment has no stock postings to reverse.");
    await lockLots(tx, movements.map((m) => m.lotId));
    const boxIds = lines.map((l) => l.containerId).filter((x): x is string => !!x);
    const boxes = boxIds.length ? await lockContainers(tx, ctx, boxIds) : [];
    const correlationId = randomUUID();
    for (const m of movements) {
      await postMovement(tx, ctx, {
        movementType: "reversal",
        lotId: m.lotId,
        toLocationId: m.fromLocationId,
        qtyBase: m.qtyBase,
        reversalOfId: m.id,
        sourceDocumentType: "shipment",
        sourceDocumentId: s.id,
        sourceDocumentNumber: s.shipmentNumber ?? s.deliveryReceiptNumber ?? undefined,
        reason: `Reversal of dispatch ${s.deliveryReceiptNumber}: ${reason}`,
        idempotencyKey: `shipment_reversal:${m.id}`,
        correlationId,
        meta: { salesOrderId: o.id, containerId: (m.meta as { containerId?: string } | null)?.containerId ?? null },
      });
    }
    for (const b of boxes) {
      if (b.status === "shipped") {
        containerMachine.assert(b.status, "sealed", `Box ${b.containerNumber}`);
        await tx.update(containers).set({ status: "sealed", updatedAt: new Date() }).where(eq(containers.id, b.id));
      } else {
        for (const l of lines.filter((x) => x.containerId === b.id)) await addContent(tx, b, l.lotId, l.baseUom, D(l.qtyBase));
      }
    }
    if (!legacy) {
      // Allocations fulfilled by this shipment hold the stock again (merged back with any open remainder later by re-allocation).
      await tx.update(stockAllocations).set({ status: "open", fulfilledShipmentId: null }).where(and(eq(stockAllocations.fulfilledShipmentId, s.id), eq(stockAllocations.status, "fulfilled")));
    }
    await transitionShipment(tx, ctx, s, "reversed", { reversedAt: new Date(), reversedBy: ctx.userId, reverseReason: reason }, reason);
    const dr = await voidDeliveryReceiptInTx(tx, ctx, s.id, `Shipment reversed: ${reason}`);
    const docs = await tx.select().from(generatedDocuments).where(and(eq(generatedDocuments.sourceEntityType, "shipment"), eq(generatedDocuments.sourceEntityId, s.id), eq(generatedDocuments.status, "ready"))).for("update");
    for (const d of docs) await markDocumentVoid(tx, ctx, d, `Shipment reversed: ${reason}`);
    const status = await fulfilmentStatus(tx, o.id);
    await advanceOrder(tx, ctx, o, status === "none" ? "allocated" : status, reason);
    await audit(tx, ctx, {
      action: "sales.shipment.reversed",
      entityType: "shipment",
      entityId: s.id,
      entityNumber: s.deliveryReceiptNumber,
      siteId: s.siteId,
      reason,
      correlationId,
      before: { status: "dispatched" },
      after: { status: "reversed", orderStatus: o.status, movements: movements.length, drVoided: dr?.drNumber ?? null },
    });
    const result = { shipmentNumber: s.shipmentNumber, orderStatus: o.status, movements: movements.length };
    await storeIdempotentResult(tx, ctx.organizationId, key, body, result);
    return { ...result, replayed: false };
  });
}

/** Cancels a shipment before dispatch (sales.shipment.edit): open pick cancelled, verification pack cancelled, order back to allocated. */
export async function cancelShipment(ctx: AuthContext, shipmentId: string, reason: string) {
  ctx.require("sales.shipment.edit");
  const r = reason?.trim() ?? "";
  if (r.length < 3) throw new DomainError("validation", "Say why the shipment is cancelled (at least 3 characters).", { field: "reason" });
  return db.transaction(async (tx) => {
    const peek = await peekShipment(tx, ctx, shipmentId);
    const o = await lockOrder(tx, ctx, peek.salesOrderId);
    const s = await lockShipment(tx, ctx, shipmentId);
    ctx.requireAt("sales.shipment.edit", s.siteId);
    if (!["draft", "picked", "packed"].includes(s.status)) throw new DomainError("state", `Shipment ${s.shipmentNumber} is ${s.status}; only a shipment that has not left can be cancelled.`);
    await tx.update(picks).set({ status: "cancelled", cancelledAt: new Date(), cancelledBy: ctx.userId, cancelReason: r }).where(and(eq(picks.shipmentId, s.id), inArray(picks.status, ["draft", "in_progress"])));
    await tx.update(packs).set({ status: "cancelled", cancelledAt: new Date(), cancelledBy: ctx.userId, cancelReason: r, updatedAt: new Date() }).where(and(eq(packs.shipmentId, s.id), inArray(packs.status, ["open", "verified"])));
    await tx.update(deliveryReceipts).set({ status: "voided", voidedAt: new Date(), voidedBy: ctx.userId, voidReason: `Shipment cancelled: ${r}` }).where(and(eq(deliveryReceipts.shipmentId, s.id), eq(deliveryReceipts.status, "draft")));
    await transitionShipment(tx, ctx, s, "cancelled", { cancelledAt: new Date(), cancelReason: r }, r);
    const status = await fulfilmentStatus(tx, o.id);
    if (["picking", "packed"].includes(o.status)) await advanceOrder(tx, ctx, o, status === "none" ? "allocated" : "partially_shipped", r);
    await audit(tx, ctx, { action: "sales.shipment.cancelled", entityType: "shipment", entityId: s.id, entityNumber: s.shipmentNumber, siteId: s.siteId, reason: r, before: { status: s.status } });
    return { ok: true };
  });
}

/* ------------------------------------------------------------------------------------------ queries */

/**
 * AC-17 reconcile: per shipment, Σ shipment_lines.qty_base vs Σ `shipment` movements (net of
 * reversals). Zero differences after every dispatch; used by tests and the shipment page.
 */
export async function shipmentReconciliation(ctx: AuthContext, shipmentId: string) {
  ctx.require("sales.shipment.view");
  const [s] = await db.select().from(shipments).where(and(eq(shipments.id, isUuid(shipmentId) ? shipmentId : "00000000-0000-0000-0000-000000000000"), eq(shipments.organizationId, ctx.organizationId), inArray(shipments.siteId, ctx.allowedSiteIds))).limit(1);
  if (!s) throw new DomainError("not_found", "Shipment not found in your sites.");
  const [l] = await db.select({ q: sql<string>`coalesce(sum(${shipmentLines.qtyBase}), 0)::text` }).from(shipmentLines).where(and(eq(shipmentLines.shipmentId, s.id), isNotNull(shipmentLines.stockMovementId)));
  const [m] = await db.select({ q: sql<string>`coalesce(sum(${stockMovements.qtyBase}), 0)::text` }).from(stockMovements).where(and(eq(stockMovements.sourceDocumentType, "shipment"), eq(stockMovements.sourceDocumentId, s.id), eq(stockMovements.movementType, "shipment")));
  const [r] = await db.select({ q: sql<string>`coalesce(sum(${stockMovements.qtyBase}), 0)::text` }).from(stockMovements).where(and(eq(stockMovements.sourceDocumentType, "shipment"), eq(stockMovements.sourceDocumentId, s.id), eq(stockMovements.movementType, "reversal")));
  const lineQty = s.status === "reversed" ? new Decimal(0) : D(l.q);
  const net = D(m.q).minus(r.q);
  return { linesQty: lineQty.toString(), movementsQty: net.toString(), difference: lineQty.minus(net).toString(), balanced: lineQty.eq(net) };
}

export async function listShipments(ctx: AuthContext, f: { status?: string } = {}) {
  ctx.require("sales.shipment.view");
  ctx.requireSite(ctx.currentSiteId);
  const conds = [eq(shipments.siteId, ctx.currentSiteId)];
  if (f.status && f.status !== "all") conds.push(f.status === "open" ? inArray(shipments.status, ["draft", "picked", "packed"]) : eq(shipments.status, f.status));
  const rows = await db
    .select({ s: shipments, orderNumber: salesOrders.orderNumber, customerName: customers.name, orderId: salesOrders.id, units: sql<string>`(select coalesce(sum(qty_base), 0)::text from ${shipmentLines} where shipment_id = ${shipments.id})`, boxes: sql<number>`(select count(distinct container_id)::int from ${shipmentLines} where shipment_id = ${shipments.id})` })
    .from(shipments)
    .innerJoin(salesOrders, eq(salesOrders.id, shipments.salesOrderId))
    .innerJoin(customers, eq(customers.id, salesOrders.customerId))
    .where(and(...conds))
    .orderBy(desc(shipments.createdAt), desc(shipments.dispatchedAt))
    .limit(200);
  return rows.map((r) => ({ ...r.s, orderNumber: r.orderNumber, customerName: r.customerName, orderId: r.orderId, units: r.units, boxes: r.boxes }));
}

export async function shipmentCounts(ctx: AuthContext) {
  ctx.require("sales.shipment.view");
  const rows = await db.select({ status: shipments.status, n: sql<number>`count(*)::int` }).from(shipments).where(eq(shipments.siteId, ctx.currentSiteId)).groupBy(shipments.status);
  const out: Record<string, number> = { all: 0, open: 0 };
  for (const r of rows) {
    out[r.status] = r.n;
    out.all += r.n;
    if (["draft", "picked", "packed"].includes(r.status)) out.open += r.n;
  }
  return out;
}

/** Shipment page data: header, lines with boxes and lots, DR, documents, exceptions and history. */
export async function getShipment(ctx: AuthContext, shipmentId: string) {
  ctx.require("sales.shipment.view");
  if (!isUuid(shipmentId)) throw new DomainError("not_found", "Shipment not found in your sites.");
  const [row] = await db
    .select({ s: shipments, o: ORDER_HEADER_COLUMNS, c: CUSTOMER_HEADER_COLUMNS })
    .from(shipments)
    .innerJoin(salesOrders, eq(salesOrders.id, shipments.salesOrderId))
    .innerJoin(customers, eq(customers.id, salesOrders.customerId))
    .where(and(eq(shipments.id, shipmentId), eq(shipments.organizationId, ctx.organizationId), inArray(shipments.siteId, ctx.allowedSiteIds)))
    .limit(1);
  if (!row) throw new DomainError("not_found", "Shipment not found in your sites.");
  ctx.requireSite(row.s.siteId);
  const lines = await db
    .select({ l: shipmentLines, lotNumber: inventoryLots.lotNumber, expiresOn: inventoryLots.expiresOn, qualityStatus: inventoryLots.qualityStatus, boxNumber: containers.containerNumber, boxStatus: containers.status, sku: products.skuCode, productName: products.name, locationCode: locations.code })
    .from(shipmentLines)
    .innerJoin(inventoryLots, eq(inventoryLots.id, shipmentLines.lotId))
    .innerJoin(salesOrderLines, eq(salesOrderLines.id, shipmentLines.salesOrderLineId))
    .innerJoin(products, eq(products.id, salesOrderLines.productId))
    .innerJoin(locations, eq(locations.id, shipmentLines.fromLocationId))
    .leftJoin(containers, eq(containers.id, shipmentLines.containerId))
    .where(eq(shipmentLines.shipmentId, row.s.id))
    .orderBy(asc(products.skuCode), asc(inventoryLots.lotNumber), asc(containers.containerNumber));
  const [pick] = await db.select().from(picks).where(eq(picks.shipmentId, row.s.id)).orderBy(desc(picks.createdAt)).limit(1);
  const [pack] = await db.select().from(packs).where(and(eq(packs.shipmentId, row.s.id), ne(packs.status, "cancelled"))).limit(1);
  const dr = await liveDeliveryReceipt(db, row.s.id);
  const docs = ctx.can("documents.generated_document.view")
    ? await db.select({ d: generatedDocuments, by: users.displayName }).from(generatedDocuments).innerJoin(users, eq(users.id, generatedDocuments.generatedBy)).where(and(eq(generatedDocuments.organizationId, ctx.organizationId), inArray(generatedDocuments.sourceEntityType, ["shipment", "pick", "pack"]), inArray(generatedDocuments.sourceEntityId, [row.s.id, pick?.id ?? row.s.id, pack?.id ?? row.s.id]))).orderBy(desc(generatedDocuments.generatedAt))
    : [];
  const exceptions = await db.select({ e: shipmentExceptions, by: users.displayName }).from(shipmentExceptions).innerJoin(users, eq(users.id, shipmentExceptions.approvedBy)).where(eq(shipmentExceptions.shipmentId, row.s.id));
  const history = await db.select({ t: shipmentStateTransitions, by: users.displayName }).from(shipmentStateTransitions).innerJoin(users, eq(users.id, shipmentStateTransitions.actorId)).where(eq(shipmentStateTransitions.shipmentId, row.s.id)).orderBy(asc(shipmentStateTransitions.at));
  const blocked = lines.filter((l) => l.qualityStatus !== "released").map((l) => l.lotNumber);
  return {
    shipment: row.s,
    order: row.o,
    customer: row.c,
    lines: lines.map((l) => ({ ...l.l, lotNumber: l.lotNumber, expiresOn: l.expiresOn, qualityStatus: l.qualityStatus, boxNumber: l.boxNumber, boxStatus: l.boxStatus, sku: l.sku, productName: l.productName, locationCode: l.locationCode })),
    pick: pick ?? null,
    pack: pack ?? null,
    deliveryReceipt: dr,
    documents: docs.map((d) => ({ ...d.d, generatedByName: d.by })),
    exceptions: exceptions.map((e) => ({ ...e.e, approvedByName: e.by })),
    history: history.map((h) => ({ ...h.t, byName: h.by })),
    blockedLots: [...new Set(blocked)],
    totals: { units: lines.reduce((a, l) => a.plus(l.l.qtyBase), new Decimal(0)).toString(), boxes: new Set(lines.filter((l) => l.l.containerId).map((l) => l.l.containerId)).size },
  };
}

/** Fulfilment summary for the order page (open pick, shipments, next step). */
export async function fulfilmentForOrder(ctx: AuthContext, orderId: string) {
  ctx.require("sales.sales_order.view");
  if (!isUuid(orderId)) return null;
  const [o] = await db.select().from(salesOrders).where(and(eq(salesOrders.id, orderId), eq(salesOrders.organizationId, ctx.organizationId), inArray(salesOrders.siteId, ctx.allowedSiteIds))).limit(1);
  if (!o) return null;
  const [openPick] = await db.select().from(picks).where(and(eq(picks.salesOrderId, o.id), inArray(picks.status, ["draft", "in_progress"]))).limit(1);
  const ships = ctx.can("sales.shipment.view") ? await db.select().from(shipments).where(eq(shipments.salesOrderId, o.id)).orderBy(desc(shipments.createdAt)) : [];
  const openAllocs = await openAllocationsForOrder(db, o.id);
  return { order: o, openPick: openPick ?? null, shipments: ships, openAllocations: openAllocs.length };
}

/**
 * Forward trace of a lot to customers by box (genealogy lot → box → shipment → customer): every
 * dispatched shipment line of the lot with its box, shipment, DR and customer.
 */
export async function shippedBoxesForLot(ctx: AuthContext, lotId: string) {
  ctx.require("sales.shipment.view");
  if (!isUuid(lotId)) return [];
  return db
    .select({ boxNumber: containers.containerNumber, boxId: containers.id, qty: shipmentLines.qtyBase, shipmentId: shipments.id, shipmentNumber: shipments.shipmentNumber, drNumber: shipments.deliveryReceiptNumber, dispatchedAt: shipments.dispatchedAt, status: shipments.status, orderNumber: salesOrders.orderNumber, customerId: customers.id, customerName: customers.name })
    .from(shipmentLines)
    .innerJoin(shipments, eq(shipments.id, shipmentLines.shipmentId))
    .innerJoin(salesOrders, eq(salesOrders.id, shipments.salesOrderId))
    .innerJoin(customers, eq(customers.id, salesOrders.customerId))
    .leftJoin(containers, eq(containers.id, shipmentLines.containerId))
    .where(and(eq(shipmentLines.lotId, lotId), eq(shipments.organizationId, ctx.organizationId), inArray(shipments.siteId, ctx.allowedSiteIds), inArray(shipments.status, ["dispatched", "delivered", "returned"]), isNotNull(shipmentLines.stockMovementId)))
    .orderBy(asc(shipments.dispatchedAt), asc(containers.containerNumber));
}
