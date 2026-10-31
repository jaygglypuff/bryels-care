import "server-only";
import { and, asc, desc, eq, inArray, isNull, isNotNull, ne, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { db, type Tx } from "@/db/client";
import {
  containerContents,
  containers,
  customers,
  inventoryLots,
  locations,
  packVerificationScans,
  packs,
  pickLines,
  picks,
  products,
  salesOrderLines,
  salesOrders,
  shipmentExceptions,
  shipmentLines,
  shipments,
  stockAllocations,
  users,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { nextNumber } from "@/lib/numbering";
import { D, fmtQty } from "@/lib/qty";
import { parseScan } from "@/lib/scan/payload";
import { assertLotUsable, claimIdempotencyKey, storeIdempotentResult } from "@/modules/inventory";
import { auditDenied, requireReauthentication } from "@/modules/governance";
import { lockOrder } from "./orders";
import { customerFulfilmentRequirements, requirementsFromSnapshot } from "./fulfilment-requirements";
import { ORDER_HEADER_COLUMNS, isUuid, lockShipment, peekShipment, advanceOrder, transitionShipment, type ShipmentRow } from "./fulfilment-state";
import { generateBoxingNoteForShipment } from "./boxing";

/**
 * Pack verification against the order (US-4-11, W09-07). A checker who is not the picker scans the
 * picked boxes (and lots + quantity for loose units); each scan becomes a `shipment_lines` row and a
 * `pack_verification_scans` evidence row. A box beyond what was allocated or ordered is refused with
 * 409 OVER_SHIPMENT and not added unless a site manager (not the order's creator) approved an
 * over-shipment for that line with a reason and the customer's reference (CX-SHIP). A partial
 * shipment for a customer that requires full shipment is 409 until approved the same way. Completing
 * the verification moves the shipment picked → packed and the order picking → packed.
 */

const qtyWord = (v: Decimal.Value, uom: string) => fmtQty(v, uom, uom === "pcs" ? 0 : 3);

/** Quantity already shipped per order line by dispatched shipments (the ledger postings). */
export async function shippedByOrderLine(q: Tx | typeof db, orderId: string, excludeShipmentId?: string) {
  const conds = [eq(shipments.salesOrderId, orderId), inArray(shipments.status, ["dispatched", "delivered", "returned"]), isNotNull(shipmentLines.stockMovementId)];
  if (excludeShipmentId) conds.push(ne(shipments.id, excludeShipmentId));
  const rows = await q
    .select({ lineId: shipmentLines.salesOrderLineId, qty: sql<string>`sum(${shipmentLines.qtyBase})::text` })
    .from(shipmentLines)
    .innerJoin(shipments, eq(shipments.id, shipmentLines.shipmentId))
    .where(and(...conds))
    .groupBy(shipmentLines.salesOrderLineId);
  return new Map(rows.map((r) => [r.lineId, D(r.qty)]));
}

async function pickOf(q: Tx | typeof db, shipmentId: string) {
  const [p] = await q.select().from(picks).where(and(eq(picks.shipmentId, shipmentId), eq(picks.status, "completed"))).orderBy(desc(picks.completedAt)).limit(1);
  return p ?? null;
}

async function linesOf(q: Tx | typeof db, shipmentId: string) {
  return q.select().from(shipmentLines).where(eq(shipmentLines.shipmentId, shipmentId));
}

/** The live verification pack of a shipment, created on the first scan (packed_by = the picker). */
async function ensurePack(tx: Tx, ctx: AuthContext, s: ShipmentRow, pick: typeof picks.$inferSelect) {
  const [existing] = await tx.select().from(packs).where(and(eq(packs.shipmentId, s.id), ne(packs.status, "cancelled"))).for("update").limit(1);
  if (existing) return existing;
  const [first] = await tx
    .select({ productId: salesOrderLines.productId, unitsPerBox: products.unitsPerBox })
    .from(salesOrderLines)
    .innerJoin(products, eq(products.id, salesOrderLines.productId))
    .where(eq(salesOrderLines.salesOrderId, s.salesOrderId))
    .orderBy(asc(salesOrderLines.lineNo))
    .limit(1);
  const packNumber = await nextNumber(tx, ctx.organizationId, "PA");
  const [p] = await tx
    .insert(packs)
    .values({
      organizationId: ctx.organizationId,
      siteId: s.siteId,
      packNumber,
      status: "open",
      sourceKind: "sales_order",
      salesOrderId: s.salesOrderId,
      pickId: pick.id,
      shipmentId: s.id,
      productId: first.productId,
      unitsPerBox: first.unitsPerBox,
      configSnapshot: { schema_version: "pack_config/v1", source: "shipment_verification", pickNumber: pick.pickNumber, shipmentNumber: s.shipmentNumber },
      verificationMode: "all",
      packedBy: pick.completedBy ?? pick.createdBy,
      submittedAt: pick.completedAt ?? new Date(),
    })
    .returning();
  await audit(tx, ctx, { action: "inventory.pack.started", entityType: "pack", entityId: p.id, entityNumber: packNumber, siteId: s.siteId, after: { sourceKind: "sales_order", shipmentNumber: s.shipmentNumber, pickNumber: pick.pickNumber } });
  return p;
}

/** SoD (sod.pack.checker_not_packer): the verifier is neither the person who completed the pick nor anyone who scanned it. */
async function assertNotPicker(tx: Tx, ctx: AuthContext, s: ShipmentRow, pick: typeof picks.$inferSelect) {
  const scanners = await tx.selectDistinct({ by: pickLines.pickedBy }).from(pickLines).where(and(eq(pickLines.pickId, pick.id), isNull(pickLines.voidedAt)));
  if (ctx.sodBlocks(pick.completedBy === ctx.userId || scanners.some((x) => x.by === ctx.userId), "Pack verification must be done by someone other than the picker (checker ≠ packer). Ask a colleague to verify.")) {
    await auditDenied(ctx, { permission: "inventory.pack.approve", entityType: "shipment", entityId: s.id, siteId: s.siteId, rule: "sod.pack.checker_not_packer" });
    throw new DomainError("separation_of_duties", "Pack verification must be done by someone other than the picker (checker ≠ packer). Ask a colleague to verify.", { ...ctx.refusalDetails(), rule: "sod.pack.checker_not_packer" });
  }
}

export type VerifyScanResult = { outcome: "verified" | "duplicate"; message: string; overShipment: boolean; replayed?: boolean };

type ScanFailure = { packId: string; siteId: string; containerId: string | null; payload: string; result: "not_in_pack" | "unknown_box"; note: string };

/**
 * One verification scan. Refusals (OVER_SHIPMENT, unknown box) are thrown as 409 after their
 * evidence row is written in its own transaction (the refused scan never adds the box).
 */
export async function scanPackVerification(ctx: AuthContext, shipmentId: string, input: { payload: string; qty?: string | null; idempotencyKey: string }): Promise<VerifyScanResult> {
  ctx.require("inventory.pack.approve");
  ctx.require("sales.shipment.edit");
  if (!input.idempotencyKey || input.idempotencyKey.length < 8) throw new DomainError("validation", "The scan is missing its key. Reload the page and try again.");
  const parsed = parseScan(input.payload);
  if (parsed.kind === "invalid") throw new DomainError("validation", "That is not a box or lot label. Scan the box label (BC:BOX) or the lot label (BC:LOT).", { field: "payload" });
  const key = `pack_verify:${input.idempotencyKey}`;
  const body = { shipmentId, payload: input.payload, qty: input.qty ?? null };
  let failure: ScanFailure | null = null;
  try {
    return await db.transaction(async (tx) => {
      const claimed = await claimIdempotencyKey<VerifyScanResult>(tx, ctx.organizationId, key, "sales.shipment.verify_scan", body);
      if (claimed) return { ...claimed.replay, replayed: true };
      const peek = await peekShipment(tx, ctx, shipmentId);
      await lockOrder(tx, ctx, peek.salesOrderId);
      const s = await lockShipment(tx, ctx, shipmentId);
      ctx.requireAt("inventory.pack.approve", s.siteId);
      if (s.status !== "picked") throw new DomainError("state", `Shipment ${s.shipmentNumber} is ${s.status}; boxes are verified after picking and before dispatch.`);
      const pick = await pickOf(tx, s.id);
      if (!pick) throw new DomainError("state", "The pick of this shipment is not completed yet.");
      await assertNotPicker(tx, ctx, s, pick);
      const pack = await ensurePack(tx, ctx, s, pick);
      const value = parsed.kind === "typed" ? parsed.value : parsed.value;
      const lines = await linesOf(tx, s.id);
      const active = await tx.select().from(pickLines).where(and(eq(pickLines.pickId, pick.id), isNull(pickLines.voidedAt)));
      const scan = async (result: string, containerId: string | null, lotId: string | null, qty: string | null, note: string | null) => {
        await tx.insert(packVerificationScans).values({ organizationId: ctx.organizationId, siteId: s.siteId, packId: pack.id, containerId, lotId, qtyBase: qty, scanPayload: input.payload.slice(0, 200), scannedBy: ctx.userId, result, note, idempotencyKey: key });
      };
      const tryBox = parsed.kind === "untyped" || parsed.type === "BOX";
      const [box] = tryBox ? await tx.select().from(containers).where(and(eq(containers.organizationId, ctx.organizationId), eq(containers.containerNumber, value), eq(containers.siteId, s.siteId))).limit(1) : [];
      let out: VerifyScanResult;
      if (box) {
        if (lines.some((l) => l.containerId === box.id)) {
          await scan("duplicate", box.id, null, null, "Scanned again; counted once.");
          out = { outcome: "duplicate", message: `Box ${box.containerNumber} is already verified (counted once).`, overShipment: false };
        } else {
          const pl = active.find((l) => l.containerId === box.id);
          if (pl) {
            await tx.insert(shipmentLines).values({
              organizationId: ctx.organizationId,
              siteId: s.siteId,
              shipmentId: s.id,
              salesOrderLineId: pl.salesOrderLineId,
              allocationId: pl.allocationId,
              pickLineId: pl.id,
              containerId: box.id,
              lotId: pl.lotId,
              fromLocationId: pl.fromLocationId,
              qtyBase: pl.qtyBase,
              baseUom: pl.baseUom,
              verifiedBy: ctx.userId,
            });
            await scan("ok", box.id, pl.lotId, pl.qtyBase, null);
            out = { outcome: "verified", message: `Box ${box.containerNumber} verified: ${qtyWord(pl.qtyBase, pl.baseUom)}.`, overShipment: false };
          } else {
            out = await overShipmentBox(tx, ctx, s, pack.id, box, lines, active, (r) => (failure = { packId: pack.id, siteId: s.siteId, containerId: box.id, payload: input.payload, result: "not_in_pack", note: r }));
            await scan("ok", box.id, null, null, "Added under an approved over-shipment.");
          }
        }
      } else {
        const tryLot = parsed.kind === "untyped" || parsed.type === "LOT";
        const [lot] = tryLot ? await tx.select().from(inventoryLots).where(and(eq(inventoryLots.organizationId, ctx.organizationId), eq(inventoryLots.lotNumber, value), eq(inventoryLots.siteId, s.siteId))).limit(1) : [];
        if (!lot) {
          failure = { packId: pack.id, siteId: s.siteId, containerId: null, payload: input.payload, result: "unknown_box", note: "Not a box or lot of this site." };
          throw new DomainError("conflict", `${value} is not a box or lot of this site. Put it aside and check the label.`, { code: "UNKNOWN_BOX" });
        }
        const loosePicked = active.filter((l) => l.lotId === lot.id && !l.containerId);
        const verified = lines.filter((l) => l.lotId === lot.id && !l.containerId);
        const remaining = loosePicked.reduce((a, l) => a.plus(l.qtyBase), new Decimal(0)).minus(verified.reduce((a, l) => a.plus(l.qtyBase), new Decimal(0)));
        const raw = (input.qty ?? "").trim();
        if (!/^\d{1,12}(\.\d{1,6})?$/.test(raw) || D(raw).lte(0)) throw new DomainError("validation", `Enter how many loose units of lot ${lot.lotNumber} you counted.`, { field: "qty" });
        let qty = D(raw);
        if (remaining.lte(0) || qty.gt(remaining)) {
          failure = { packId: pack.id, siteId: s.siteId, containerId: null, payload: input.payload, result: "not_in_pack", note: `Loose ${qty.toString()} of ${lot.lotNumber}; picked and not yet verified: ${Decimal.max(remaining, 0).toString()}.` };
          throw new DomainError("conflict", `OVER_SHIPMENT: only ${Decimal.max(remaining, 0).toString()} ${lot.baseUom} of lot ${lot.lotNumber} were picked loose and are not yet verified. Count again; loose units beyond the pick are never added.`, { code: "OVER_SHIPMENT" });
        }
        // Split across the picked loose lines in pick order.
        const used = new Map<string, Decimal>();
        for (const v of verified) if (v.pickLineId) used.set(v.pickLineId, (used.get(v.pickLineId) ?? new Decimal(0)).plus(v.qtyBase));
        for (const pl of loosePicked) {
          if (qty.lte(0)) break;
          const free = D(pl.qtyBase).minus(used.get(pl.id) ?? 0);
          if (free.lte(0)) continue;
          const take = Decimal.min(free, qty);
          await tx.insert(shipmentLines).values({
            organizationId: ctx.organizationId,
            siteId: s.siteId,
            shipmentId: s.id,
            salesOrderLineId: pl.salesOrderLineId,
            allocationId: pl.allocationId,
            pickLineId: pl.id,
            containerId: null,
            lotId: pl.lotId,
            fromLocationId: pl.fromLocationId,
            qtyBase: take.toString(),
            baseUom: pl.baseUom,
            verifiedBy: ctx.userId,
          });
          qty = qty.minus(take);
        }
        await scan("ok", null, lot.id, raw, "Loose units counted.");
        out = { outcome: "verified", message: `Verified ${raw} ${lot.baseUom} of lot ${lot.lotNumber} (loose units).`, overShipment: false };
      }
      await storeIdempotentResult(tx, ctx.organizationId, key, body, out);
      return out;
    });
  } catch (e) {
    const f = failure as ScanFailure | null;
    if (f && e instanceof DomainError) {
      await db.transaction(async (tx) => {
        await tx.insert(packVerificationScans).values({ organizationId: ctx.organizationId, siteId: f.siteId, packId: f.packId, containerId: f.containerId, scanPayload: f.payload.slice(0, 200), scannedBy: ctx.userId, result: f.result, note: f.note.slice(0, 500) });
        await tx.update(packs).set({ verificationFailureCount: sql`${packs.verificationFailureCount} + 1` }).where(eq(packs.id, f.packId));
      }).catch(() => undefined); // the pack row may not exist when its creating transaction rolled back
    }
    throw e;
  }
}

/** A scanned box that was not picked: allowed only within an approved over-shipment for its order line. */
async function overShipmentBox(
  tx: Tx,
  ctx: AuthContext,
  s: ShipmentRow,
  _packId: string,
  box: typeof containers.$inferSelect,
  lines: (typeof shipmentLines.$inferSelect)[],
  active: (typeof pickLines.$inferSelect)[],
  fail: (reason: string) => void,
): Promise<VerifyScanResult> {
  const contents = await tx.select().from(containerContents).where(and(eq(containerContents.containerId, box.id), sql`${containerContents.qtyBase} > 0`));
  const orderLines = await tx.select({ id: salesOrderLines.id, productId: salesOrderLines.productId, qty: salesOrderLines.qtyUnits }).from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, s.salesOrderId));
  if (contents.length !== 1) {
    fail(contents.length ? "Mixed-lot box." : "Empty box.");
    throw new DomainError("conflict", `Box ${box.containerNumber} is not for this order.`, { code: "NOT_FOR_THIS_ORDER" });
  }
  const [lot] = await tx.select().from(inventoryLots).where(eq(inventoryLots.id, contents[0].lotId)).limit(1);
  const line = orderLines.find((l) => l.productId === lot.productId);
  if (!line) {
    fail("Different SKU.");
    throw new DomainError("conflict", `Box ${box.containerNumber} holds a product that is not on this order (V-MAT).`, { code: "NOT_FOR_THIS_ORDER", rule: "V-MAT" });
  }
  const qty = D(contents[0].qtyBase);
  const allocatedHere = active.filter((l) => l.salesOrderLineId === line.id).reduce((a, l) => a.plus(l.qtyBase), new Decimal(0));
  const verifiedHere = lines.filter((l) => l.salesOrderLineId === line.id).reduce((a, l) => a.plus(l.qtyBase), new Decimal(0));
  const shippedBefore = (await shippedByOrderLine(tx, s.salesOrderId, s.id)).get(line.id) ?? new Decimal(0);
  const overAllocated = verifiedHere.plus(qty).gt(allocatedHere);
  const overOrdered = shippedBefore.plus(verifiedHere).plus(qty).gt(line.qty);
  const approved = await tx
    .select({ qty: sql<string>`coalesce(sum(${shipmentExceptions.extraQtyBase}), 0)::text` })
    .from(shipmentExceptions)
    .where(and(eq(shipmentExceptions.shipmentId, s.id), eq(shipmentExceptions.kind, "over_shipment"), eq(shipmentExceptions.salesOrderLineId, line.id)));
  const usedOver = lines.filter((l) => l.salesOrderLineId === line.id && l.isOverShipment).reduce((a, l) => a.plus(l.qtyBase), new Decimal(0));
  const headroom = D(approved[0]?.qty ?? 0).minus(usedOver);
  if ((overAllocated || overOrdered) && headroom.lt(qty)) {
    fail(`Over-shipment: ${qty.toString()} more than ${overOrdered ? "ordered" : "allocated"}.`);
    throw new DomainError(
      "conflict",
      `OVER_SHIPMENT: box ${box.containerNumber} (${qtyWord(qty, lot.baseUom)}) would ship more than ${overOrdered ? "ordered" : "allocated"} for this line. It was not added. A site manager can approve an over-shipment with the customer's reference.`,
      { code: "OVER_SHIPMENT", salesOrderLineId: line.id, overOrdered, overAllocated },
    );
  }
  try {
    assertLotUsable(lot);
  } catch (e) {
    fail("Lot not released.");
    throw e;
  }
  if (!["open", "sealed"].includes(box.status) || !box.currentLocationId) throw new DomainError("state", `Box ${box.containerNumber} is ${box.status}; it cannot be shipped.`);
  const [taken] = await tx.select({ id: stockAllocations.id }).from(stockAllocations).where(and(eq(stockAllocations.containerId, box.id), eq(stockAllocations.status, "open"))).limit(1);
  if (taken) {
    fail("Allocated to another order.");
    throw new DomainError("conflict", `Box ${box.containerNumber} is allocated to another order.`, { code: "NOT_FOR_THIS_ORDER" });
  }
  await tx.insert(shipmentLines).values({
    organizationId: ctx.organizationId,
    siteId: s.siteId,
    shipmentId: s.id,
    salesOrderLineId: line.id,
    allocationId: null,
    pickLineId: null,
    containerId: box.id,
    lotId: lot.id,
    fromLocationId: box.currentLocationId,
    qtyBase: qty.toString(),
    baseUom: lot.baseUom,
    isOverShipment: true,
    verifiedBy: ctx.userId,
  });
  await audit(tx, ctx, {
    action: "sales.shipment.over_shipment_line_added",
    entityType: "shipment",
    entityId: s.id,
    entityNumber: s.shipmentNumber,
    siteId: s.siteId,
    after: { box: box.containerNumber, lotNumber: lot.lotNumber, qty: qty.toString() },
  });
  return { outcome: "verified", message: `Box ${box.containerNumber} added under the approved over-shipment (${qtyWord(qty, lot.baseUom)}).`, overShipment: true };
}

/** Removes a verified line (mis-scan) before the shipment is packed; the scan evidence stays. */
export async function removeShipmentLine(ctx: AuthContext, shipmentLineId: string, reason: string) {
  ctx.require("sales.shipment.edit");
  const r = reason?.trim() ?? "";
  if (r.length < 3) throw new DomainError("validation", "Say why the line is removed (at least 3 characters).", { field: "reason" });
  if (!isUuid(shipmentLineId)) throw new DomainError("not_found", "Shipment line not found.");
  return db.transaction(async (tx) => {
    const [line] = await tx.select().from(shipmentLines).where(and(eq(shipmentLines.id, shipmentLineId), eq(shipmentLines.organizationId, ctx.organizationId))).limit(1);
    if (!line || !ctx.allowedSiteIds.includes(line.siteId)) throw new DomainError("not_found", "Shipment line not found.");
    const s = await lockShipment(tx, ctx, line.shipmentId);
    if (s.status !== "picked") throw new DomainError("state", `Shipment ${s.shipmentNumber} is ${s.status}; its lines can no longer be changed.`);
    await tx.delete(shipmentLines).where(eq(shipmentLines.id, line.id));
    await audit(tx, ctx, { action: "sales.shipment.line_removed", entityType: "shipment", entityId: s.id, entityNumber: s.shipmentNumber, siteId: s.siteId, reason: r, before: line });
    return { ok: true };
  });
}

export type ExceptionInput = { kind: "over_shipment" | "partial_shipment"; salesOrderLineId?: string | null; extraQty?: string | null; reason: string; customerReference: string; password?: string | null };

/**
 * CX-SHIP approval (sales.over_shipment.approve, restricted): over-shipment of a line by an extra
 * quantity, or a partial shipment for a customer that requires full shipment. The approver
 * re-authenticates and must not be the order's creator. Audited as restricted.
 */
export async function approveShipmentException(ctx: AuthContext, shipmentId: string, input: ExceptionInput) {
  ctx.require("sales.over_shipment.approve");
  const reason = input.reason?.trim() ?? "";
  const ref = input.customerReference?.trim() ?? "";
  const fe: Record<string, string> = {};
  if (reason.length < 5) fe.reason = "Give the reason (at least 5 characters).";
  if (ref.length < 2) fe.customerReference = "Enter the customer's agreement reference (PO amendment, email, call log).";
  if (!["over_shipment", "partial_shipment"].includes(input.kind)) fe.kind = "Choose the exception.";
  let extra: Decimal | null = null;
  if (input.kind === "over_shipment") {
    if (!isUuid(input.salesOrderLineId)) fe.salesOrderLineId = "Choose the order line.";
    if (!/^\d{1,12}(\.\d{1,6})?$/.test((input.extraQty ?? "").trim()) || D(input.extraQty!.trim()).lte(0)) fe.extraQty = "Enter the extra quantity approved.";
    else extra = D(input.extraQty!.trim());
  }
  if (Object.keys(fe).length) throw new DomainError("validation", Object.values(fe)[0], { fieldErrors: fe });
  const peek = await db.select({ siteId: shipments.siteId, orderId: shipments.salesOrderId }).from(shipments).where(and(eq(shipments.id, shipmentId), eq(shipments.organizationId, ctx.organizationId))).limit(1);
  if (!peek[0] || !ctx.allowedSiteIds.includes(peek[0].siteId)) throw new DomainError("not_found", "Shipment not found in your sites.");
  ctx.requireAt("sales.over_shipment.approve", peek[0].siteId);
  const [order] = await db.select().from(salesOrders).where(eq(salesOrders.id, peek[0].orderId)).limit(1);
  if (ctx.sodBlocksAt(order.createdBy === ctx.userId, "You created this order, so someone else must approve the exception.", order.siteId)) {
    await auditDenied(ctx, { permission: "sales.over_shipment.approve", entityType: "shipment", entityId: shipmentId, siteId: order.siteId, rule: "sod.over_shipment.not_order_creator" });
    throw new DomainError("separation_of_duties", "You created this order, so someone else must approve the exception.", { ...ctx.refusalDetails(), rule: "sod.over_shipment.not_order_creator" });
  }
  await requireReauthentication(ctx, input.password, "sales.over_shipment.approve");
  return db.transaction(async (tx) => {
    await lockOrder(tx, ctx, order.id);
    const s = await lockShipment(tx, ctx, shipmentId);
    if (!["draft", "picked"].includes(s.status)) throw new DomainError("state", `Shipment ${s.shipmentNumber} is ${s.status}; exceptions are approved before packing is completed.`);
    if (input.kind === "over_shipment") {
      const [l] = await tx.select().from(salesOrderLines).where(and(eq(salesOrderLines.id, input.salesOrderLineId!), eq(salesOrderLines.salesOrderId, s.salesOrderId))).limit(1);
      if (!l) throw new DomainError("validation", "That line is not on this order.", { field: "salesOrderLineId" });
    }
    const [ex] = await tx
      .insert(shipmentExceptions)
      .values({ organizationId: ctx.organizationId, siteId: s.siteId, shipmentId: s.id, kind: input.kind, salesOrderLineId: input.kind === "over_shipment" ? input.salesOrderLineId! : null, extraQtyBase: extra?.toString() ?? null, reason, customerReference: ref, approvedBy: ctx.userId })
      .returning();
    if (input.kind === "over_shipment") await tx.update(shipments).set({ overShipmentApprovedBy: ctx.userId }).where(eq(shipments.id, s.id));
    await audit(tx, ctx, {
      action: input.kind === "over_shipment" ? "sales.shipment.over_shipment_approved" : "sales.shipment.partial_shipment_approved",
      entityType: "shipment",
      entityId: s.id,
      entityNumber: s.shipmentNumber,
      siteId: s.siteId,
      reason,
      after: { exceptionId: ex.id, kind: input.kind, salesOrderLineId: ex.salesOrderLineId, extraQty: ex.extraQtyBase, customerReference: ref, orderNumber: order.orderNumber },
    });
    return { exceptionId: ex.id };
  });
}

export type CompletePackingInput = { carrierName: string; trackingNumber?: string | null; grossWeightKg?: string | null; packageCount?: number | null; idempotencyKey: string };

/**
 * Completes the verification: every picked box / loose quantity must be verified, a partial shipment
 * for a "full shipment" customer needs an approved partial exception (CX-SHIP), carrier and package
 * count are captured. Shipment picked → packed, order picking → packed, the verification pack is
 * verified (checker ≠ packer) and the packing list is generated when its template is set up.
 */
export async function completePacking(ctx: AuthContext, shipmentId: string, input: CompletePackingInput) {
  ctx.require("inventory.pack.approve");
  ctx.require("sales.shipment.edit");
  const carrier = input.carrierName?.trim() ?? "";
  if (carrier.length < 2) throw new DomainError("validation", "Enter the carrier (e.g. Own truck).", { field: "carrierName" });
  const weight = input.grossWeightKg?.trim() ? input.grossWeightKg.trim() : null;
  if (weight && (!/^\d{1,9}(\.\d{1,3})?$/.test(weight) || D(weight).lte(0))) throw new DomainError("validation", "Gross weight in kg, e.g. 18.5.", { field: "grossWeightKg" });
  if (input.packageCount != null && (!Number.isInteger(input.packageCount) || input.packageCount < 1 || input.packageCount > 10000)) throw new DomainError("validation", "Packages: a whole number of at least 1.", { field: "packageCount" });
  const key = `pack_complete:${input.idempotencyKey}`;
  const body = { shipmentId, carrier, weight, packageCount: input.packageCount ?? null, tracking: input.trackingNumber?.trim() || null };
  return db.transaction(async (tx) => {
    const claimed = await claimIdempotencyKey<{ shipmentNumber: string; packNumber: string; packingListNumber: string | null }>(tx, ctx.organizationId, key, "sales.shipment.pack", body);
    if (claimed) return { ...claimed.replay, replayed: true };
    const peek = await peekShipment(tx, ctx, shipmentId);
    const o = await lockOrder(tx, ctx, peek.salesOrderId);
    const s = await lockShipment(tx, ctx, shipmentId);
    ctx.requireAt("inventory.pack.approve", s.siteId);
    if (s.status !== "picked") throw new DomainError("state", `Shipment ${s.shipmentNumber} is ${s.status}; only a picked shipment can be packed.`);
    const pick = await pickOf(tx, s.id);
    if (!pick) throw new DomainError("state", "The pick of this shipment is not completed yet.");
    await assertNotPicker(tx, ctx, s, pick);
    const [pack] = await tx.select().from(packs).where(and(eq(packs.shipmentId, s.id), ne(packs.status, "cancelled"))).for("update").limit(1);
    const lines = await linesOf(tx, s.id);
    if (!pack || lines.length === 0) throw new DomainError("state", "Scan the picked boxes to verify them before completing packing.");
    const active = await tx.select().from(pickLines).where(and(eq(pickLines.pickId, pick.id), isNull(pickLines.voidedAt)));
    const verifiedByPickLine = new Map<string, Decimal>();
    for (const l of lines) if (l.pickLineId) verifiedByPickLine.set(l.pickLineId, (verifiedByPickLine.get(l.pickLineId) ?? new Decimal(0)).plus(l.qtyBase));
    const missing = active.filter((pl) => D(pl.qtyBase).gt(verifiedByPickLine.get(pl.id) ?? 0));
    if (missing.length) {
      const boxes = await tx.select({ id: containers.id, n: containers.containerNumber }).from(containers).where(inArray(containers.id, missing.map((m) => m.containerId).filter((x): x is string => !!x).concat(["00000000-0000-0000-0000-000000000000"])));
      const lots = await tx.select({ id: inventoryLots.id, n: inventoryLots.lotNumber }).from(inventoryLots).where(inArray(inventoryLots.id, missing.map((m) => m.lotId)));
      const names = missing.map((m) => (m.containerId ? `box ${boxes.find((b) => b.id === m.containerId)?.n}` : `loose lot ${lots.find((l) => l.id === m.lotId)?.n}`));
      throw new DomainError("conflict", `${missing.length} picked item(s) not verified yet: ${names.slice(0, 8).join(", ")}${names.length > 8 ? "…" : ""}. Scan them, or take them out of the pick.`, { code: "VERIFICATION_INCOMPLETE" });
    }
    // Partial shipment check (A-PROC-15): shipped before + this shipment vs ordered, per line.
    const orderLines = await tx.select({ id: salesOrderLines.id, productId: salesOrderLines.productId, qty: salesOrderLines.qtyUnits, sku: products.skuCode, minRemainingShelfLifeDays: salesOrderLines.minRemainingShelfLifeDays, requirementSnapshot: salesOrderLines.requirementSnapshot }).from(salesOrderLines).innerJoin(products, eq(products.id, salesOrderLines.productId)).where(eq(salesOrderLines.salesOrderId, o.id));
    const before = await shippedByOrderLine(tx, o.id, s.id);
    const thisShip = new Map<string, Decimal>();
    for (const l of lines) thisShip.set(l.salesOrderLineId, (thisShip.get(l.salesOrderLineId) ?? new Decimal(0)).plus(l.qtyBase));
    const short = orderLines.filter((l) => (before.get(l.id) ?? new Decimal(0)).plus(thisShip.get(l.id) ?? 0).lt(l.qty));
    if (short.length) {
      const full = (await Promise.all(orderLines.map(async (l) => requirementsFromSnapshot(l) ?? (await customerFulfilmentRequirements(tx, o.organizationId, o.customerId, l.productId))))).some((r) => r.fullShipmentRequired);
      if (full) {
        const [ok] = await tx.select({ id: shipmentExceptions.id }).from(shipmentExceptions).where(and(eq(shipmentExceptions.shipmentId, s.id), eq(shipmentExceptions.kind, "partial_shipment"))).limit(1);
        if (!ok) {
          throw new DomainError(
            "conflict",
            `CX-SHIP: this customer requires full shipment and ${short.map((l) => `${l.sku} is ${D(l.qty).minus(before.get(l.id) ?? 0).minus(thisShip.get(l.id) ?? 0).toString()} short`).join("; ")}. Complete the pick or ask a site manager to approve a partial shipment.`,
            { code: "CX_SHIP_PARTIAL" },
          );
        }
      }
    }
    const boxCount = new Set(lines.filter((l) => l.containerId).map((l) => l.containerId)).size;
    const units = lines.reduce((a, l) => a.plus(l.qtyBase), new Decimal(0));
    await tx
      .update(packs)
      .set({ status: "verified", checkedBy: ctx.userId, verifiedAt: new Date(), boxCount, packedUnitsBase: units.toString(), updatedAt: new Date() })
      .where(eq(packs.id, pack.id));
    await transitionShipment(tx, ctx, s, "packed", {
      carrier,
      trackingNumber: input.trackingNumber?.trim() || null,
      grossWeight: weight,
      weightUom: weight ? "kg" : null,
      packageCount: input.packageCount ?? Math.max(boxCount, 1),
      packedBy: ctx.userId,
      packedAt: new Date(),
    });
    await advanceOrder(tx, ctx, o, "packed");
    await audit(tx, ctx, {
      action: "inventory.pack.verified",
      entityType: "pack",
      entityId: pack.id,
      entityNumber: pack.packNumber,
      siteId: s.siteId,
      after: { shipmentNumber: s.shipmentNumber, boxes: boxCount, units: units.toString(), checkedBy: ctx.userId, packedBy: pack.packedBy },
    });
    await audit(tx, ctx, {
      action: "sales.shipment.packed",
      entityType: "shipment",
      entityId: s.id,
      entityNumber: s.shipmentNumber,
      siteId: s.siteId,
      before: { status: "picked" },
      after: { status: "packed", carrier, boxes: boxCount, units: units.toString(), packageCount: input.packageCount ?? Math.max(boxCount, 1), grossWeightKg: weight, partial: short.length > 0 },
    });
    const doc = await generateBoxingNoteForShipment(tx, ctx, pack.id).catch((e) => {
      if (e instanceof DomainError && e.code === "setup_required") return null;
      throw e;
    });
    const result = { shipmentNumber: s.shipmentNumber ?? "", packNumber: pack.packNumber, packingListNumber: doc?.documentNumber ?? null };
    await storeIdempotentResult(tx, ctx.organizationId, key, body, result);
    return { ...result, replayed: false };
  });
}

/** Everything the verification screen shows. */
export async function getPackingView(ctx: AuthContext, shipmentId: string) {
  ctx.require("sales.shipment.view");
  if (!isUuid(shipmentId)) throw new DomainError("not_found", "Shipment not found in your sites.");
  const [s] = await db.select().from(shipments).where(and(eq(shipments.id, shipmentId), eq(shipments.organizationId, ctx.organizationId), inArray(shipments.siteId, ctx.allowedSiteIds))).limit(1);
  if (!s) throw new DomainError("not_found", "Shipment not found in your sites.");
  ctx.requireSite(s.siteId);
  const [order] = await db.select({ o: ORDER_HEADER_COLUMNS, customerName: customers.name, customerCode: customers.code }).from(salesOrders).innerJoin(customers, eq(customers.id, salesOrders.customerId)).where(eq(salesOrders.id, s.salesOrderId));
  const pick = await pickOf(db, s.id);
  const active = pick
    ? await db
        .select({ pl: pickLines, lotNumber: inventoryLots.lotNumber, boxNumber: containers.containerNumber, locationCode: locations.code, by: users.displayName })
        .from(pickLines)
        .innerJoin(inventoryLots, eq(inventoryLots.id, pickLines.lotId))
        .innerJoin(locations, eq(locations.id, pickLines.fromLocationId))
        .innerJoin(users, eq(users.id, pickLines.pickedBy))
        .leftJoin(containers, eq(containers.id, pickLines.containerId))
        .where(and(eq(pickLines.pickId, pick.id), isNull(pickLines.voidedAt)))
        .orderBy(asc(locations.code), asc(containers.containerNumber))
    : [];
  const lines = await db
    .select({ l: shipmentLines, lotNumber: inventoryLots.lotNumber, expiresOn: inventoryLots.expiresOn, boxNumber: containers.containerNumber, sku: products.skuCode })
    .from(shipmentLines)
    .innerJoin(inventoryLots, eq(inventoryLots.id, shipmentLines.lotId))
    .innerJoin(salesOrderLines, eq(salesOrderLines.id, shipmentLines.salesOrderLineId))
    .innerJoin(products, eq(products.id, salesOrderLines.productId))
    .leftJoin(containers, eq(containers.id, shipmentLines.containerId))
    .where(eq(shipmentLines.shipmentId, s.id))
    .orderBy(asc(shipmentLines.verifiedAt));
  const orderLines = await db
    .select({ id: salesOrderLines.id, lineNo: salesOrderLines.lineNo, qty: salesOrderLines.qtyUnits, sku: products.skuCode, productName: products.name, productId: products.id, minRemainingShelfLifeDays: salesOrderLines.minRemainingShelfLifeDays, requirementSnapshot: salesOrderLines.requirementSnapshot })
    .from(salesOrderLines)
    .innerJoin(products, eq(products.id, salesOrderLines.productId))
    .where(eq(salesOrderLines.salesOrderId, s.salesOrderId))
    .orderBy(asc(salesOrderLines.lineNo));
  const before = await shippedByOrderLine(db, s.salesOrderId, s.id);
  const exceptions = await db.select({ e: shipmentExceptions, by: users.displayName }).from(shipmentExceptions).innerJoin(users, eq(users.id, shipmentExceptions.approvedBy)).where(eq(shipmentExceptions.shipmentId, s.id)).orderBy(desc(shipmentExceptions.approvedAt));
  const [pack] = await db.select().from(packs).where(and(eq(packs.shipmentId, s.id), ne(packs.status, "cancelled"))).limit(1);
  const scans = pack
    ? await db.select({ sc: packVerificationScans, by: users.displayName }).from(packVerificationScans).innerJoin(users, eq(users.id, packVerificationScans.scannedBy)).where(eq(packVerificationScans.packId, pack.id)).orderBy(desc(packVerificationScans.scannedAt)).limit(40)
    : [];
  const req = await Promise.all(orderLines.map(async (l) => requirementsFromSnapshot(l) ?? (await customerFulfilmentRequirements(db, ctx.organizationId, order.o.customerId, l.productId))));
  const verifiedPickLines = new Set(lines.map((l) => l.l.pickLineId).filter(Boolean));
  const pickers = new Set(active.map((a) => a.pl.pickedBy));
  if (pick?.completedBy) pickers.add(pick.completedBy);
  return {
    shipment: s,
    order: order.o,
    customerName: order.customerName,
    customerCode: order.customerCode,
    pick,
    picked: active.map((a) => ({ ...a.pl, lotNumber: a.lotNumber, boxNumber: a.boxNumber, locationCode: a.locationCode, pickedByName: a.by, verified: verifiedPickLines.has(a.pl.id) })),
    lines: lines.map((l) => ({ ...l.l, lotNumber: l.lotNumber, expiresOn: l.expiresOn, boxNumber: l.boxNumber, sku: l.sku })),
    orderLines: orderLines.map((l) => {
      const here = lines.filter((x) => x.l.salesOrderLineId === l.id).reduce((a, x) => a.plus(x.l.qtyBase), new Decimal(0));
      const picked = active.filter((x) => x.pl.salesOrderLineId === l.id).reduce((a, x) => a.plus(x.pl.qtyBase), new Decimal(0));
      return { ...l, shippedBefore: (before.get(l.id) ?? new Decimal(0)).toString(), picked: picked.toString(), verified: here.toString(), remaining: Decimal.max(D(l.qty).minus(before.get(l.id) ?? 0).minus(here), 0).toString() };
    }),
    exceptions: exceptions.map((x) => ({ ...x.e, approvedByName: x.by })),
    pack: pack ?? null,
    scans: scans.map((x) => ({ ...x.sc, scannedByName: x.by })),
    fullShipmentRequired: req.some((r) => r.fullShipmentRequired),
    isPicker: pickers.has(ctx.userId) && !ctx.ownerOverride,
    canOverApprove: ctx.can("sales.over_shipment.approve") && !ctx.sodConflictAt(order.o.createdBy, order.o.siteId),
  };
}
