import "server-only";
import { and, asc, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { randomUUID } from "node:crypto";
import { db, type DbOrTx, type Tx } from "@/db/client";
import {
  batchOutputs,
  batches,
  containerContents,
  containerLineage,
  containers,
  customers,
  generatedDocuments,
  inventoryLots,
  labelJobs,
  locations,
  packBoxes,
  packVerificationScans,
  packs,
  products,
  salesOrderLines,
  salesOrders,
  shipmentLines,
  shipments,
  stockAllocations,
  users,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { nextNumber } from "@/lib/numbering";
import { D, fmtDate, fmtDateTime, fmtQty } from "@/lib/qty";
import { parseScan } from "@/lib/scan/payload";
import { getSetting } from "@/lib/settings";
import {
  addContent,
  assertLocationsNotFrozen,
  claimIdempotencyKey,
  containerMachine,
  contentsOf,
  emptyIfDrained,
  getInventorySetting,
  isPastExpiry,
  lockContainers,
  lockLots,
  looseQty,
  newBox,
  storeIdempotentResult,
  takeContent,
} from "@/modules/inventory";
import { approvedLabelTemplatesFor, createLabelJob, generateForSource, resolveTemplateVersion, voidLabelsForEntityInTx, type BoxingNoteData } from "@/modules/documents";
import { customerFulfilmentRequirements } from "./fulfilment-requirements";
import { isUuid, packMachine } from "./fulfilment-state";

/**
 * Boxing (US-4-07, W08) and customer repack (US-4-08, W08-07). A pack is one boxing session:
 * the packer scans the finished lot and confirms the units per box (from the customer's approved
 * carton count, else the SKU default, flagged "default config used"), each box is a container
 * (rule BOX) holding the lot, sealed, with a box label job; the last short box is PARTIAL. Boxes
 * inherit the lot's quality status (quarantined boxes are allowed at batch boxing). A checker who
 * is not the packer scans the configured sample (every box for the first pack of a SKU) and
 * verifies; boxes × units must equal the batch output first. The boxing note is a generated
 * document; a repack regenerates the original pack's note as a new version with the lineage.
 */

type PackRow = typeof packs.$inferSelect;
const PACKABLE_STATUSES = ["quarantine", "released"];

const unitWord = (uom: string) => (uom === "pcs" ? "pcs" : uom);
const qtyText = (v: Decimal.Value, uom: string) => fmtQty(v, unitWord(uom), uom === "pcs" ? 0 : 3);

async function lockPack(tx: Tx, ctx: AuthContext, packId: string): Promise<PackRow> {
  if (!isUuid(packId)) throw new DomainError("not_found", "Pack not found in your sites.");
  const [p] = await tx.select().from(packs).where(and(eq(packs.id, packId), eq(packs.organizationId, ctx.organizationId), inArray(packs.siteId, ctx.allowedSiteIds))).for("update").limit(1);
  if (!p) throw new DomainError("not_found", "Pack not found in your sites.");
  ctx.requireSite(p.siteId);
  return p;
}

async function labelTemplateFor(q: DbOrTx, organizationId: string, siteId: string) {
  const list = await approvedLabelTemplatesFor(q, organizationId, siteId, "carton");
  return list[0] ?? null;
}

export type StartPackInput =
  | { sourceKind: "batch_output"; batchOutputId: string; idempotencyKey: string }
  | { sourceKind: "sales_order"; salesOrderId: string; lotId: string; locationId: string; idempotencyKey: string };

/** W08-01: starts boxing from a batch output or as a packaging order for a sales order. */
export async function startPack(ctx: AuthContext, input: StartPackInput) {
  ctx.require("inventory.pack.create");
  ctx.require("inventory.container.create");
  if (!input.idempotencyKey || input.idempotencyKey.length < 8) throw new DomainError("validation", "The form is missing its submission key. Reload the page and try again.");
  const key = `pack_start:${input.idempotencyKey}`;
  return db.transaction(async (tx) => {
    const [replay] = await tx.select().from(packs).where(and(eq(packs.organizationId, ctx.organizationId), eq(packs.idempotencyKey, key))).limit(1);
    if (replay) {
      ctx.requireSite(replay.siteId);
      return { packId: replay.id, packNumber: replay.packNumber, replayed: true };
    }
    let lotId: string;
    let locationId: string;
    let expected: string | null = null;
    let batchId: string | null = null;
    let batchOutputId: string | null = null;
    let salesOrderId: string | null = null;
    let customerId: string | null = null;
    let sourceText: string;
    if (input.sourceKind === "batch_output") {
      if (!isUuid(input.batchOutputId)) throw new DomainError("not_found", "Batch output not found in your sites.");
      const [out] = await tx.select({ o: batchOutputs, batchNumber: batches.batchNumber }).from(batchOutputs).innerJoin(batches, eq(batches.id, batchOutputs.batchId)).where(and(eq(batchOutputs.id, input.batchOutputId), eq(batchOutputs.organizationId, ctx.organizationId))).limit(1);
      if (!out || !ctx.allowedSiteIds.includes(out.o.siteId)) throw new DomainError("not_found", "Batch output not found in your sites.");
      if (out.o.outputKind !== "finished" || !out.o.productId) throw new DomainError("validation", "Only finished-goods output is boxed.");
      if (!out.o.lotId) throw new DomainError("state", "This output has no lot yet; post the output first.");
      const live = await tx.select({ n: packs.packNumber }).from(packs).where(and(eq(packs.batchOutputId, out.o.id), inArray(packs.status, ["open", "verified"]))).limit(1);
      if (live.length) throw new DomainError("conflict", `Boxing of this output is already in pack ${live[0].n}.`);
      lotId = out.o.lotId;
      locationId = out.o.toLocationId;
      expected = D(out.o.qtyBase).toString();
      batchId = out.o.batchId;
      batchOutputId = out.o.id;
      sourceText = `Batch ${out.batchNumber}`;
    } else {
      if (!isUuid(input.salesOrderId) || !isUuid(input.lotId) || !isUuid(input.locationId)) throw new DomainError("validation", "Choose the order, the lot and where its stock is.");
      const [o] = await tx.select().from(salesOrders).where(and(eq(salesOrders.id, input.salesOrderId), eq(salesOrders.organizationId, ctx.organizationId))).limit(1);
      if (!o || !ctx.allowedSiteIds.includes(o.siteId)) throw new DomainError("not_found", "Sales order not found in your sites.");
      if (["draft", "cancelled", "shipped"].includes(o.status)) throw new DomainError("state", `Order ${o.orderNumber} is ${o.status}; packaging orders are for confirmed orders.`);
      lotId = input.lotId;
      locationId = input.locationId;
      salesOrderId = o.id;
      customerId = o.customerId;
      sourceText = `Order ${o.orderNumber}`;
    }
    const [lot] = await lockLots(tx, [lotId]);
    if (!lot || !ctx.allowedSiteIds.includes(lot.siteId) || lot.itemKind !== "product" || !lot.productId) throw new DomainError("not_found", "Finished-goods lot not found in your sites.");
    ctx.requireAt("inventory.pack.create", lot.siteId);
    if (!PACKABLE_STATUSES.includes(lot.qualityStatus)) throw new DomainError("blocked_lot", `Lot ${lot.lotNumber} is ${lot.qualityStatus.replace(/_/g, " ")}; it cannot be boxed (V-HOLD / V-REC).`);
    if (isPastExpiry(lot.expiresOn)) throw new DomainError("blocked_lot", `Lot ${lot.lotNumber} expired on ${lot.expiresOn}; it cannot be boxed (V-EXP).`);
    if (input.sourceKind === "sales_order" && lot.qualityStatus !== "released") throw new DomainError("blocked_lot", `Lot ${lot.lotNumber} is not released; a packaging order for a customer boxes released stock only.`);
    if (salesOrderId) {
      const onOrder = await tx.select({ id: salesOrderLines.id }).from(salesOrderLines).where(and(eq(salesOrderLines.salesOrderId, salesOrderId), eq(salesOrderLines.productId, lot.productId))).limit(1);
      if (!onOrder.length) throw new DomainError("validation", `Lot ${lot.lotNumber} is a product that is not on this order (V-MAT).`, { rule: "V-MAT" });
    }
    const [loc] = await tx.select().from(locations).where(eq(locations.id, locationId)).limit(1);
    if (!loc || loc.siteId !== lot.siteId) throw new DomainError("validation", "Choose a location of the lot's site.");
    const [prod] = await tx.select().from(products).where(eq(products.id, lot.productId)).limit(1);
    const req = customerId ? await customerFulfilmentRequirements(tx, ctx.organizationId, customerId, prod.id) : null;
    const unitsPerBox = req?.unitsPerBox ?? prod.unitsPerBox;
    const usedDefault = !!customerId && !req?.unitsPerBox;
    const tpl = await labelTemplateFor(tx, ctx.organizationId, lot.siteId);
    const packNumber = await nextNumber(tx, ctx.organizationId, "PA");
    const [p] = await tx
      .insert(packs)
      .values({
        organizationId: ctx.organizationId,
        siteId: lot.siteId,
        packNumber,
        status: "open",
        sourceKind: input.sourceKind,
        batchId,
        batchOutputId,
        salesOrderId,
        productId: prod.id,
        lotId: lot.id,
        locationId: loc.id,
        customerRequirementId: req?.requirementIds[0] ?? null,
        labelTemplateId: tpl?.id ?? null,
        unitsPerBox,
        expectedUnitsBase: expected,
        configSnapshot: {
          schema_version: "pack_config/v1",
          source: req?.unitsPerBox ? "customer_requirement" : "sku_default",
          customerRequirementIds: req?.requirementIds ?? [],
          unitsPerBox,
          skuDefaultUnitsPerBox: prod.unitsPerBox,
          shippingMarks: req?.shippingMarks ?? null,
          labelTemplateCode: tpl?.code ?? null,
          sourceText,
        },
        usedDefaultConfig: usedDefault,
        packedBy: ctx.userId,
        idempotencyKey: key,
      })
      .returning();
    await audit(tx, ctx, {
      action: "inventory.pack.started",
      entityType: "pack",
      entityId: p.id,
      entityNumber: packNumber,
      siteId: p.siteId,
      after: { sourceKind: input.sourceKind, sourceText, lotNumber: lot.lotNumber, unitsPerBox, expectedUnits: expected, usedDefaultConfig: usedDefault, location: loc.code },
    });
    return { packId: p.id, packNumber, replayed: false };
  });
}

/** W08-02/03: one box of the pack's lot. Default and maximum quantity = units per box; less = PARTIAL. */
export async function addBox(ctx: AuthContext, packId: string, input: { lotPayload?: string | null; qty?: string | null; idempotencyKey: string }) {
  ctx.require("inventory.pack.create");
  ctx.require("inventory.container.create");
  if (!input.idempotencyKey || input.idempotencyKey.length < 8) throw new DomainError("validation", "The form is missing its submission key. Reload the page and try again.");
  const key = `pack_box:${input.idempotencyKey}`;
  const body = { packId, lot: input.lotPayload ?? null, qty: input.qty ?? null };
  return db.transaction(async (tx) => {
    const claimed = await claimIdempotencyKey<{ containerId: string; containerNumber: string; boxNo: number; partial: boolean }>(tx, ctx.organizationId, key, "inventory.pack.add_box", body);
    if (claimed) return { ...claimed.replay, replayed: true };
    const p = await lockPack(tx, ctx, packId);
    ctx.requireAt("inventory.pack.create", p.siteId);
    if (p.sourceKind === "repack") throw new DomainError("state", "Repack boxes are created by the repack itself.");
    if (p.status !== "open" || p.submittedAt) throw new DomainError("state", `Pack ${p.packNumber} is ${p.submittedAt && p.status === "open" ? "submitted for verification" : p.status}; no more boxes can be added.`);
    const [lot] = await lockLots(tx, [p.lotId!]);
    if (input.lotPayload?.trim()) {
      const parsed = parseScan(input.lotPayload);
      const value = parsed.kind === "invalid" ? "" : parsed.value;
      if (parsed.kind === "typed" && parsed.type !== "LOT") throw new DomainError("validation", "Scan the finished lot label (BC:LOT).", { field: "lotPayload" });
      if (value !== lot.lotNumber) throw new DomainError("validation", `V-MAT: ${value || "that"} is not lot ${lot.lotNumber} of this pack.`, { field: "lotPayload", rule: "V-MAT" });
    }
    if (!PACKABLE_STATUSES.includes(lot.qualityStatus) || isPastExpiry(lot.expiresOn)) throw new DomainError("blocked_lot", `Lot ${lot.lotNumber} is ${isPastExpiry(lot.expiresOn) ? "expired" : lot.qualityStatus.replace(/_/g, " ")}; boxing stops here.`);
    const raw = (input.qty ?? "").trim() || String(p.unitsPerBox);
    if (!/^\d{1,12}(\.\d{1,6})?$/.test(raw) || D(raw).lte(0)) throw new DomainError("validation", "Enter the units in this box.", { field: "qty" });
    const qty = D(raw);
    if (lot.baseUom === "pcs" && !qty.isInteger()) throw new DomainError("validation", "Whole pieces only.", { field: "qty" });
    if (qty.gt(p.unitsPerBox)) throw new DomainError("validation", `A box holds ${p.unitsPerBox} units for this pack; enter at most ${p.unitsPerBox}.`, { field: "qty" });
    if (p.expectedUnitsBase && D(p.packedUnitsBase).plus(qty).gt(p.expectedUnitsBase)) {
      throw new DomainError("validation", `That would box ${D(p.packedUnitsBase).plus(qty).toString()} units, more than the batch output of ${D(p.expectedUnitsBase).toString()}.`, { field: "qty", rule: "V-NEG" });
    }
    await assertLocationsNotFrozen(tx, [p.locationId!]);
    const loose = await looseQty(tx, lot.id, p.locationId!);
    if (loose.lt(qty)) throw new DomainError("insufficient_stock", `Only ${loose.toString()} ${lot.baseUom} of lot ${lot.lotNumber} are loose (not boxed) at this location (V-NEG).`);
    const partial = qty.lt(p.unitsPerBox);
    const box = await newBox(tx, ctx, { siteId: p.siteId, locationId: p.locationId!, kind: "box", isPartial: partial, notes: `Pack ${p.packNumber}` });
    await addContent(tx, box, lot.id, lot.baseUom, qty);
    containerMachine.assert("open", "sealed", `Box ${box.containerNumber}`);
    await tx.update(containers).set({ status: "sealed", updatedAt: new Date() }).where(eq(containers.id, box.id));
    const boxNo = p.boxCount + 1;
    await tx.insert(packBoxes).values({ organizationId: ctx.organizationId, siteId: p.siteId, packId: p.id, containerId: box.id, boxNo, lotId: lot.id, qtyBase: qty.toString(), isPartial: partial, createdBy: ctx.userId });
    await tx.update(packs).set({ boxCount: boxNo, packedUnitsBase: D(p.packedUnitsBase).plus(qty).toString(), updatedAt: new Date() }).where(eq(packs.id, p.id));
    await audit(tx, ctx, {
      action: "inventory.container.created",
      entityType: "container",
      entityId: box.id,
      entityNumber: box.containerNumber,
      siteId: p.siteId,
      after: { packNumber: p.packNumber, boxNo, lotNumber: lot.lotNumber, qtyBase: qty.toString(), baseUom: lot.baseUom, partial, statusInherited: lot.qualityStatus },
    });
    const result = { containerId: box.id, containerNumber: box.containerNumber, boxNo, partial };
    await storeIdempotentResult(tx, ctx.organizationId, key, body, result);
    return { ...result, replayed: false };
  });
}

/** Takes a box out of an open pack (wrong count, damaged box): contents go back to loose stock, the box is voided. */
export async function removeBox(ctx: AuthContext, packId: string, containerId: string, reason: string) {
  ctx.require("inventory.pack.create");
  const r = reason?.trim() ?? "";
  if (r.length < 3) throw new DomainError("validation", "Say why the box is removed (at least 3 characters).", { field: "reason" });
  return db.transaction(async (tx) => {
    const p = await lockPack(tx, ctx, packId);
    if (p.status !== "open") throw new DomainError("state", `Pack ${p.packNumber} is ${p.status}; boxes can only be removed before verification.`);
    const [pb] = await tx.select().from(packBoxes).where(and(eq(packBoxes.packId, p.id), eq(packBoxes.containerId, containerId), eq(packBoxes.status, "packed"))).limit(1);
    if (!pb) throw new DomainError("not_found", "That box is not in this pack.");
    const [box] = await lockContainers(tx, ctx, [containerId]);
    const contents = await contentsOf(tx, box.id);
    for (const c of contents) await takeContent(tx, box.id, c.lotId, D(c.qtyBase));
    await emptyIfDrained(tx, { ...box, status: box.status === "sealed" ? "open" : box.status });
    await tx.update(containers).set({ status: "void", updatedAt: new Date() }).where(eq(containers.id, box.id));
    await tx.update(packBoxes).set({ status: "removed", removedReason: r }).where(eq(packBoxes.id, pb.id));
    const left = await tx.select({ n: sql<number>`count(*)::int`, q: sql<string>`coalesce(sum(${packBoxes.qtyBase}), 0)::text` }).from(packBoxes).where(and(eq(packBoxes.packId, p.id), eq(packBoxes.status, "packed")));
    await tx.update(packs).set({ packedUnitsBase: left[0].q, submittedAt: null, updatedAt: new Date() }).where(eq(packs.id, p.id));
    await voidLabelsForEntityInTx(tx, ctx, "container", box.id, `Box removed from pack ${p.packNumber}: ${r}`);
    await audit(tx, ctx, { action: "inventory.container.voided", entityType: "container", entityId: box.id, entityNumber: box.containerNumber, siteId: p.siteId, reason: r, before: { status: box.status, contents }, after: { status: "void", packNumber: p.packNumber } });
    return { ok: true };
  });
}

/** The packer finishes boxing (inventory.pack.submit); the verification sample is fixed here (A-PROC-38). */
export async function submitPack(ctx: AuthContext, packId: string) {
  ctx.require("inventory.pack.submit");
  return db.transaction(async (tx) => {
    const p = await lockPack(tx, ctx, packId);
    ctx.requireAt("inventory.pack.submit", p.siteId);
    if (p.status !== "open") throw new DomainError("state", `Pack ${p.packNumber} is ${p.status}.`);
    const boxes = await tx.select().from(packBoxes).where(and(eq(packBoxes.packId, p.id), eq(packBoxes.status, "packed")));
    if (boxes.length === 0) throw new DomainError("state", "Add at least one box first.");
    assertReconciled(p);
    const [prior] = await tx.select({ id: packs.id }).from(packs).where(and(eq(packs.productId, p.productId), inArray(packs.status, ["verified", "closed"]), ne(packs.sourceKind, "sales_order"))).limit(1);
    const sample = await getSetting(tx, ctx.organizationId, "inventory.pack.verification_sample_size", p.siteId);
    const mode = prior ? "sample" : "all";
    await tx.update(packs).set({ submittedAt: new Date(), verificationMode: mode, verificationSampleSize: mode === "all" ? boxes.length : Math.min(sample, boxes.length), updatedAt: new Date() }).where(eq(packs.id, p.id));
    await audit(tx, ctx, { action: "inventory.pack.submitted", entityType: "pack", entityId: p.id, entityNumber: p.packNumber, siteId: p.siteId, after: { boxes: boxes.length, units: p.packedUnitsBase, verificationMode: mode } });
    return { verificationMode: mode, sampleSize: mode === "all" ? boxes.length : Math.min(sample, boxes.length) };
  });
}

/** T-14: boxes × units must equal the batch output before verification. */
function assertReconciled(p: PackRow) {
  if (p.expectedUnitsBase && !D(p.packedUnitsBase).eq(p.expectedUnitsBase)) {
    throw new DomainError(
      "conflict",
      `Boxes × units (${D(p.packedUnitsBase).toString()}) do not match the lot output (${D(p.expectedUnitsBase).toString()}): difference ${D(p.expectedUnitsBase).minus(p.packedUnitsBase).toString()}. Box the rest or recount before verification (W05-15).`,
      { code: "PACK_NOT_RECONCILED", rule: "pack.verification_blocks_mismatch" },
    );
  }
}

async function assertChecker(ctx: AuthContext, p: PackRow) {
  if (p.packedBy === ctx.userId) {
    await auditDeniedLocal(ctx, p);
    throw new DomainError("separation_of_duties", "The checker cannot be the packer (checker ≠ packer). Ask a colleague to verify this pack.", { rule: "sod.pack.checker_not_packer" });
  }
}

async function auditDeniedLocal(ctx: AuthContext, p: PackRow) {
  await audit(db, ctx, { action: "identity.authorization.denied", entityType: "pack", entityId: p.id, entityNumber: p.packNumber, siteId: p.siteId, reason: "sod.pack.checker_not_packer", after: { permission: "inventory.pack.approve", rule: "sod.pack.checker_not_packer" } });
}

export type PackScanResult = { result: "ok" | "not_in_pack" | "unknown_box" | "label_mismatch" | "duplicate"; message: string; scanned: number; required: number };

/** W08-04: one checker scan. Results are evidence and never throw for a wrong box (the screen shows it). */
export async function verifyPackScan(ctx: AuthContext, packId: string, input: { payload: string; labelOk?: boolean; idempotencyKey: string }): Promise<PackScanResult> {
  ctx.require("inventory.pack.approve");
  if (!input.idempotencyKey || input.idempotencyKey.length < 8) throw new DomainError("validation", "The scan is missing its key. Reload the page and try again.");
  const key = `pack_check:${input.idempotencyKey}`;
  const [replay] = await db.select({ r: packVerificationScans }).from(packVerificationScans).where(and(eq(packVerificationScans.organizationId, ctx.organizationId), eq(packVerificationScans.idempotencyKey, key))).limit(1);
  const p0 = await db.select().from(packs).where(and(eq(packs.id, isUuid(packId) ? packId : "00000000-0000-0000-0000-000000000000"), eq(packs.organizationId, ctx.organizationId))).limit(1);
  if (!p0[0] || !ctx.allowedSiteIds.includes(p0[0].siteId)) throw new DomainError("not_found", "Pack not found in your sites.");
  await assertChecker(ctx, p0[0]);
  return db.transaction(async (tx) => {
    const p = await lockPack(tx, ctx, packId);
    ctx.requireAt("inventory.pack.approve", p.siteId);
    const progress = async () => {
      const ok = await tx.selectDistinct({ c: packVerificationScans.containerId }).from(packVerificationScans).where(and(eq(packVerificationScans.packId, p.id), eq(packVerificationScans.result, "ok")));
      return { scanned: ok.length, required: p.verificationSampleSize ?? p.boxCount };
    };
    if (replay) return { result: replay.r.result as PackScanResult["result"], message: "Already recorded.", ...(await progress()) };
    if (p.status !== "open" || !p.submittedAt) throw new DomainError("state", p.status === "open" ? `Pack ${p.packNumber} is still being boxed; the packer submits it for verification first.` : `Pack ${p.packNumber} is ${p.status}.`);
    const parsed = parseScan(input.payload);
    const value = parsed.kind === "invalid" ? "" : parsed.value;
    const [box] = value ? await tx.select().from(containers).where(and(eq(containers.organizationId, ctx.organizationId), eq(containers.containerNumber, value), eq(containers.siteId, p.siteId))).limit(1) : [];
    const boxes = await tx.select().from(packBoxes).where(and(eq(packBoxes.packId, p.id), eq(packBoxes.status, "packed")));
    let result: PackScanResult["result"];
    let message: string;
    if (!box) {
      result = "unknown_box";
      message = `${value || "That label"} is not a box of this site.`;
    } else if (!boxes.some((b) => b.containerId === box.id)) {
      result = "not_in_pack";
      message = `Box ${box.containerNumber} is not in pack ${p.packNumber}. Set it aside.`;
    } else if (input.labelOk === false) {
      result = "label_mismatch";
      message = `Label of box ${box.containerNumber} marked wrong. Reprint it and scan the box again.`;
    } else {
      const [last] = await tx.select().from(packVerificationScans).where(and(eq(packVerificationScans.packId, p.id), eq(packVerificationScans.containerId, box.id))).orderBy(desc(packVerificationScans.scannedAt)).limit(1);
      result = last?.result === "ok" ? "duplicate" : "ok";
      message = result === "duplicate" ? `Box ${box.containerNumber} already checked (counted once).` : `Box ${box.containerNumber} checked.`;
    }
    await tx.insert(packVerificationScans).values({ organizationId: ctx.organizationId, siteId: p.siteId, packId: p.id, containerId: box?.id ?? null, scanPayload: input.payload.slice(0, 200), scannedBy: ctx.userId, result, note: result === "label_mismatch" ? "Label content does not match" : null, idempotencyKey: key });
    if (["not_in_pack", "unknown_box", "label_mismatch"].includes(result)) await tx.update(packs).set({ verificationFailureCount: p.verificationFailureCount + 1 }).where(eq(packs.id, p.id));
    return { result, message, ...(await progress()) };
  });
}

/**
 * W08-04 / G-W08-A: the checker verifies the pack (inventory.pack.approve, checker ≠ packer). Needs
 * the reconciliation, the required ok scans and no box whose last scan was a label mismatch. The
 * boxing note is generated when its template is set up.
 */
export async function approvePack(ctx: AuthContext, packId: string) {
  ctx.require("inventory.pack.approve");
  const [p0] = await db.select().from(packs).where(and(eq(packs.id, isUuid(packId) ? packId : "00000000-0000-0000-0000-000000000000"), eq(packs.organizationId, ctx.organizationId))).limit(1);
  if (!p0 || !ctx.allowedSiteIds.includes(p0.siteId)) throw new DomainError("not_found", "Pack not found in your sites.");
  await assertChecker(ctx, p0);
  return db.transaction(async (tx) => {
    const p = await lockPack(tx, ctx, packId);
    ctx.requireAt("inventory.pack.approve", p.siteId);
    if (p.sourceKind === "sales_order" && p.shipmentId) throw new DomainError("state", "This pack is verified from its shipment's packing screen.");
    if (p.status !== "open" || !p.submittedAt) throw new DomainError("state", `Pack ${p.packNumber} is ${p.status === "open" ? "not submitted for verification yet" : p.status}.`);
    assertReconciled(p);
    const boxes = await tx.select().from(packBoxes).where(and(eq(packBoxes.packId, p.id), eq(packBoxes.status, "packed")));
    const scans = await tx.select().from(packVerificationScans).where(eq(packVerificationScans.packId, p.id)).orderBy(asc(packVerificationScans.scannedAt));
    const last = new Map<string, string>();
    for (const s of scans) if (s.containerId && s.result !== "duplicate") last.set(s.containerId, s.result);
    const okBoxes = boxes.filter((b) => last.get(b.containerId) === "ok");
    const mismatch = boxes.filter((b) => last.get(b.containerId) === "label_mismatch");
    if (mismatch.length) throw new DomainError("conflict", `${mismatch.length} box label(s) were marked wrong. Reprint them and scan those boxes again.`, { code: "LABEL_MISMATCH" });
    const required = p.verificationMode === "all" ? boxes.length : Math.min(p.verificationSampleSize ?? 1, boxes.length);
    if (okBoxes.length < required) {
      throw new DomainError("conflict", `Scan ${required - okBoxes.length} more box(es): ${p.verificationMode === "all" ? "every box is checked for the first pack of this SKU" : `the sample is ${required} box(es)`} (A-PROC-38).`, { code: "SAMPLE_INCOMPLETE" });
    }
    packMachine.assert(p.status, "verified", `Pack ${p.packNumber}`);
    await tx.update(packs).set({ status: "verified", checkedBy: ctx.userId, verifiedAt: new Date(), updatedAt: new Date() }).where(eq(packs.id, p.id));
    await audit(tx, ctx, {
      action: "inventory.pack.verified",
      entityType: "pack",
      entityId: p.id,
      entityNumber: p.packNumber,
      siteId: p.siteId,
      after: { boxes: boxes.length, units: p.packedUnitsBase, checked: okBoxes.length, mode: p.verificationMode, failures: p.verificationFailureCount },
    });
    const doc = await generateBoxingNoteInTx(tx, ctx, p.id, { supersede: true }).catch((e) => {
      if (e instanceof DomainError && e.code === "setup_required") return null;
      throw e;
    });
    return { packNumber: p.packNumber, boxingNoteNumber: doc?.documentNumber ?? null };
  });
}

/** Cancels an open pack that has no boxes left (remove its boxes first). */
export async function cancelPack(ctx: AuthContext, packId: string, reason: string) {
  ctx.require("inventory.pack.create");
  const r = reason?.trim() ?? "";
  if (r.length < 3) throw new DomainError("validation", "Say why the pack is cancelled (at least 3 characters).", { field: "reason" });
  return db.transaction(async (tx) => {
    const p = await lockPack(tx, ctx, packId);
    packMachine.assert(p.status, "cancelled", `Pack ${p.packNumber}`);
    const [left] = await tx.select({ n: sql<number>`count(*)::int` }).from(packBoxes).where(and(eq(packBoxes.packId, p.id), eq(packBoxes.status, "packed")));
    if (p.sourceKind !== "sales_order" && left.n > 0) throw new DomainError("state", `Pack ${p.packNumber} still has ${left.n} box(es). Remove them first.`);
    await tx.update(packs).set({ status: "cancelled", cancelledAt: new Date(), cancelledBy: ctx.userId, cancelReason: r, updatedAt: new Date() }).where(eq(packs.id, p.id));
    await audit(tx, ctx, { action: "inventory.pack.cancelled", entityType: "pack", entityId: p.id, entityNumber: p.packNumber, siteId: p.siteId, reason: r });
    return { ok: true };
  });
}

/**
 * Queues box labels (label jobs, W1E) for the pack's boxes that have no live label yet. Each box is
 * its own job and idempotency key; a box whose label was already printed needs a reprint with reason
 * from the label job. Returns per-box outcomes; setup problems (no station, no approved carton
 * template) are thrown so the screen shows the setup-required state.
 */
export async function printPackLabels(ctx: AuthContext, packId: string, input: { printStationId?: string | null; keyBase: string }) {
  ctx.require("inventory.label_job.create");
  const p = await getPackRow(ctx, packId);
  const tpl = p.labelTemplateId ? { id: p.labelTemplateId } : await labelTemplateFor(db, ctx.organizationId, p.siteId);
  if (!tpl) throw new DomainError("setup_required", "No approved box (carton) label template exists for this site. Ask an administrator to set one up under Admin → Templates → Labels.");
  const boxes = await db.select({ containerId: packBoxes.containerId, boxNo: packBoxes.boxNo, number: containers.containerNumber }).from(packBoxes).innerJoin(containers, eq(containers.id, packBoxes.containerId)).where(and(eq(packBoxes.packId, p.id), eq(packBoxes.status, "packed"))).orderBy(asc(packBoxes.boxNo));
  const live = boxes.length
    ? await db.select({ entityId: labelJobs.entityId }).from(labelJobs).where(and(eq(labelJobs.entityType, "container"), inArray(labelJobs.entityId, boxes.map((b) => b.containerId)), inArray(labelJobs.status, ["queued", "rendering", "ready", "printed"]), sql`${labelJobs.voidedAt} is null`))
    : [];
  const out: { boxNumber: string; jobId?: string; error?: string }[] = [];
  for (const b of boxes) {
    if (live.some((l) => l.entityId === b.containerId)) continue;
    try {
      const r = await createLabelJob(ctx, { labelTemplateId: tpl.id, entityType: "container", entityId: b.containerId, copies: 1, printStationId: input.printStationId ?? null, idempotencyKey: `${input.keyBase}:${b.containerId}` });
      out.push({ boxNumber: b.number, jobId: r.jobId });
    } catch (e) {
      if (e instanceof DomainError && (e.code === "forbidden" || (e.code === "state" && e.details?.setup) || e.code === "setup_required")) throw e;
      out.push({ boxNumber: b.number, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

async function getPackRow(ctx: AuthContext, packId: string) {
  if (!isUuid(packId)) throw new DomainError("not_found", "Pack not found in your sites.");
  const [p] = await db.select().from(packs).where(and(eq(packs.id, packId), eq(packs.organizationId, ctx.organizationId), inArray(packs.siteId, ctx.allowedSiteIds))).limit(1);
  if (!p) throw new DomainError("not_found", "Pack not found in your sites.");
  ctx.requireSite(p.siteId);
  return p;
}

export type RepackInput = { containerIds: string[]; customerId?: string | null; unitsPerBox?: number | null; reason: string; idempotencyKey: string };

/**
 * US-4-08 / W08-07: repacks released boxes (same location, same SKU) into boxes of the customer's
 * carton count. Lineage `repack` edges from every source box to every new box it fed, source boxes
 * emptied and their labels voided, the source packs' boxing notes regenerated (v2 supersedes v1,
 * lineage printed). The repack is a pack of kind `repack` verified by a checker like any pack.
 */
export async function repackForCustomer(ctx: AuthContext, input: RepackInput) {
  ctx.require("inventory.container.edit");
  ctx.require("inventory.pack.create");
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 3) throw new DomainError("validation", "Say why the boxes are repacked (at least 3 characters).", { field: "reason" });
  const ids = [...new Set(input.containerIds ?? [])];
  if (ids.length === 0) throw new DomainError("validation", "Scan the boxes to repack.", { field: "containerIds" });
  if (input.unitsPerBox != null && (!Number.isInteger(input.unitsPerBox) || input.unitsPerBox < 1 || input.unitsPerBox > 100000)) throw new DomainError("validation", "Units per box: a whole number of at least 1.", { field: "unitsPerBox" });
  if (!input.idempotencyKey || input.idempotencyKey.length < 8) throw new DomainError("validation", "The form is missing its submission key. Reload the page and try again.");
  const key = `repack:${input.idempotencyKey}`;
  const body = { ids: [...ids].sort(), customerId: input.customerId ?? null, unitsPerBox: input.unitsPerBox ?? null, reason };
  return db.transaction(async (tx) => {
    const claimed = await claimIdempotencyKey<{ packId: string; packNumber: string; boxes: { id: string; number: string; qty: string }[] }>(tx, ctx.organizationId, key, "inventory.pack.repack", body);
    if (claimed) return { ...claimed.replay, replayed: true };
    const sources = await lockContainers(tx, ctx, ids);
    const siteId = sources[0].siteId;
    ctx.requireAt("inventory.container.edit", siteId);
    if (new Set(sources.map((b) => b.siteId)).size > 1 || new Set(sources.map((b) => b.currentLocationId)).size > 1) throw new DomainError("validation", "Repack boxes at one location. Move them together first.");
    for (const b of sources) if (!["open", "sealed"].includes(b.status) || !b.currentLocationId) throw new DomainError("state", `Box ${b.containerNumber} is ${b.status}; only open or sealed boxes can be repacked.`);
    const allocated = await tx.select({ c: stockAllocations.containerId }).from(stockAllocations).where(and(inArray(stockAllocations.containerId, ids), eq(stockAllocations.status, "open"))).limit(1);
    if (allocated.length) throw new DomainError("conflict", "A box is allocated to an order. Release the allocation (or pick it) before repacking.");
    const contents = (await Promise.all(sources.map(async (b) => (await contentsOf(tx, b.id)).map((c) => ({ ...c, box: b }))))).flat();
    if (contents.length === 0) throw new DomainError("state", "These boxes are empty.");
    const lots = await lockLots(tx, contents.map((c) => c.lotId));
    for (const l of lots) {
      if (l.qualityStatus !== "released" || isPastExpiry(l.expiresOn)) throw new DomainError("blocked_lot", `Lot ${l.lotNumber} is ${isPastExpiry(l.expiresOn) ? "expired" : l.qualityStatus.replace(/_/g, " ")}; only released lots are repacked for a customer.`);
    }
    if (new Set(lots.map((l) => l.productId)).size !== 1 || !lots[0].productId) throw new DomainError("validation", "V-MAT: repack boxes of one SKU at a time.", { rule: "V-MAT" });
    await assertLocationsNotFrozen(tx, [sources[0].currentLocationId!]);
    const [prod] = await tx.select().from(products).where(eq(products.id, lots[0].productId!)).limit(1);
    let req = null;
    if (input.customerId) {
      if (!isUuid(input.customerId)) throw new DomainError("validation", "Choose the customer.", { field: "customerId" });
      const [c] = await tx.select({ id: customers.id }).from(customers).where(and(eq(customers.id, input.customerId), eq(customers.organizationId, ctx.organizationId))).limit(1);
      if (!c) throw new DomainError("validation", "Choose the customer.", { field: "customerId" });
      req = await customerFulfilmentRequirements(tx, ctx.organizationId, c.id, prod.id);
    }
    const units = input.unitsPerBox ?? req?.unitsPerBox ?? prod.unitsPerBox;
    const usedDefault = !input.unitsPerBox && !req?.unitsPerBox;
    const allowMixed = await getInventorySetting(tx, ctx.organizationId, siteId, "inventory.container.allow_mixed_lots");
    const tpl = await labelTemplateFor(tx, ctx.organizationId, siteId);
    const packNumber = await nextNumber(tx, ctx.organizationId, "PA");
    const [p] = await tx
      .insert(packs)
      .values({
        organizationId: ctx.organizationId,
        siteId,
        packNumber,
        status: "open",
        sourceKind: "repack",
        productId: prod.id,
        lotId: lots.length === 1 ? lots[0].id : null,
        locationId: sources[0].currentLocationId,
        customerRequirementId: req?.requirementIds[0] ?? null,
        labelTemplateId: tpl?.id ?? null,
        unitsPerBox: units,
        expectedUnitsBase: contents.reduce((a, c) => a.plus(c.qtyBase), new Decimal(0)).toString(),
        configSnapshot: { schema_version: "pack_config/v1", source: input.unitsPerBox ? "entered" : req?.unitsPerBox ? "customer_requirement" : "sku_default", customerId: input.customerId ?? null, customerRequirementIds: req?.requirementIds ?? [], unitsPerBox: units, shippingMarks: req?.shippingMarks ?? null, labelTemplateCode: tpl?.code ?? null, reason, sourceText: `Repack of ${sources.map((b) => b.containerNumber).join(", ")}` },
        usedDefaultConfig: usedDefault,
        packedBy: ctx.userId,
        submittedAt: new Date(),
        verificationMode: "all",
        idempotencyKey: key,
      })
      .returning();
    const operationId = randomUUID();
    // Fill new boxes lot by lot (FEFO), N units each; a lot's last box is partial unless mixed lots are allowed.
    const queue = [...contents].sort((a, z) => {
      const la = lots.find((l) => l.id === a.lotId)!;
      const lz = lots.find((l) => l.id === z.lotId)!;
      return String(la.expiresOn ?? "9999").localeCompare(String(lz.expiresOn ?? "9999")) || la.lotNumber.localeCompare(lz.lotNumber) || a.box.containerNumber.localeCompare(z.box.containerNumber);
    });
    const created: { id: string; number: string; qty: Decimal; sources: Set<string> }[] = [];
    let cur: (typeof created)[number] | null = null;
    let curLot: string | null = null;
    let boxNo = 0;
    const openBox = async () => {
      const b = await newBox(tx, ctx, { siteId, locationId: sources[0].currentLocationId!, kind: sources[0].containerKind, notes: `Repack ${packNumber}` });
      boxNo += 1;
      const entry = { id: b.id, number: b.containerNumber, qty: new Decimal(0), sources: new Set<string>(), boxNo, row: b };
      created.push(entry);
      return entry;
    };
    for (const c of queue) {
      const lot = lots.find((l) => l.id === c.lotId)!;
      let left = D(c.qtyBase);
      while (left.gt(0)) {
        if (!cur || cur.qty.gte(units) || (!allowMixed && curLot !== c.lotId)) {
          cur = await openBox();
          curLot = c.lotId;
        }
        const take = Decimal.min(left, new Decimal(units).minus(cur.qty));
        await addContent(tx, { id: cur.id, organizationId: ctx.organizationId, siteId }, lot.id, lot.baseUom, take);
        await takeContent(tx, c.box.id, lot.id, take);
        await tx.insert(containerLineage).values({ organizationId: ctx.organizationId, siteId, operation: "repack", operationId, parentContainerId: c.box.id, childContainerId: cur.id, lotId: lot.id, qtyBase: take.toString(), reason, performedBy: ctx.userId });
        cur.qty = cur.qty.plus(take);
        cur.sources.add(c.box.containerNumber);
        left = left.minus(take);
      }
    }
    for (const n of created) {
      const partial = n.qty.lt(units);
      await tx.update(containers).set({ status: "sealed", isPartial: partial, updatedAt: new Date() }).where(eq(containers.id, n.id));
      const [only] = await tx.select({ lotId: containerContents.lotId }).from(containerContents).where(and(eq(containerContents.containerId, n.id), sql`${containerContents.qtyBase} > 0`)).limit(1);
      await tx.insert(packBoxes).values({ organizationId: ctx.organizationId, siteId, packId: p.id, containerId: n.id, boxNo: created.indexOf(n) + 1, lotId: only.lotId, qtyBase: n.qty.toString(), isPartial: partial, sourceContainerIds: [...n.sources], createdBy: ctx.userId });
    }
    await tx.update(packs).set({ boxCount: created.length, packedUnitsBase: created.reduce((a, n) => a.plus(n.qty), new Decimal(0)).toString(), verificationSampleSize: created.length }).where(eq(packs.id, p.id));
    // Sources: emptied, their labels superseded, their pack rows marked repacked.
    const affectedPacks = new Set<string>();
    for (const b of sources) {
      await emptyIfDrained(tx, b);
      await voidLabelsForEntityInTx(tx, ctx, "container", b.id, `Superseded by repack ${packNumber}: contents moved to ${created.map((n) => n.number).join(", ")}.`);
      const rows = await tx.update(packBoxes).set({ status: "repacked" }).where(and(eq(packBoxes.containerId, b.id), eq(packBoxes.status, "packed"))).returning({ packId: packBoxes.packId });
      for (const r of rows) affectedPacks.add(r.packId);
    }
    await audit(tx, ctx, {
      action: "inventory.container.repacked",
      entityType: "pack",
      entityId: p.id,
      entityNumber: packNumber,
      siteId,
      reason,
      after: { from: sources.map((b) => b.containerNumber), to: created.map((n) => ({ box: n.number, qty: n.qty.toString(), from: [...n.sources] })), unitsPerBox: units, usedDefaultConfig: usedDefault, operationId },
    });
    // Regenerate the boxing notes of the packs the boxes came from (v2 supersedes v1, lineage printed).
    for (const packIdAffected of affectedPacks) {
      const [had] = await tx.select({ id: generatedDocuments.id }).from(generatedDocuments).where(and(eq(generatedDocuments.sourceEntityType, "pack"), eq(generatedDocuments.sourceEntityId, packIdAffected), eq(generatedDocuments.documentKind, "boxing_note"), eq(generatedDocuments.status, "ready"))).limit(1);
      if (had) {
        await generateBoxingNoteInTx(tx, ctx, packIdAffected, { supersede: true }).catch((e) => {
          if (e instanceof DomainError && e.code === "setup_required") return null;
          throw e;
        });
      }
    }
    const result = { packId: p.id, packNumber, boxes: created.map((n) => ({ id: n.id, number: n.number, qty: n.qty.toString() })) };
    await storeIdempotentResult(tx, ctx.organizationId, key, body, result);
    return { ...result, replayed: false };
  });
}

/* ------------------------------------------------------------------------------------- boxing note */

/** Builds the frozen boxing_note/v1 dataset of a pack (batch, repack or shipment variant). */
export async function boxingNoteData(q: DbOrTx, packId: string): Promise<{ data: BoxingNoteData; pack: PackRow; replaces: string | null }> {
  const [row] = await q
    .select({ p: packs, packer: users.displayName, productName: products.name, sku: products.skuCode })
    .from(packs)
    .innerJoin(users, eq(users.id, packs.packedBy))
    .innerJoin(products, eq(products.id, packs.productId))
    .where(eq(packs.id, packId))
    .limit(1);
  const p = row.p;
  const checker = p.checkedBy ? (await q.select({ n: users.displayName }).from(users).where(eq(users.id, p.checkedBy)).limit(1))[0]?.n ?? null : null;
  const cfg = (p.configSnapshot ?? {}) as { shippingMarks?: string | null; sourceText?: string; source?: string; labelTemplateCode?: string | null };
  let customerText: string | null = null;
  let sourceText = cfg.sourceText ?? "—";
  if (p.salesOrderId) {
    const [o] = await q.select({ n: salesOrders.orderNumber, c: customers.name, code: customers.code }).from(salesOrders).innerJoin(customers, eq(customers.id, salesOrders.customerId)).where(eq(salesOrders.id, p.salesOrderId)).limit(1);
    customerText = o ? `${o.c} (${o.code})` : null;
    if (p.shipmentId) {
      const [s] = await q.select({ n: shipments.shipmentNumber }).from(shipments).where(eq(shipments.id, p.shipmentId)).limit(1);
      sourceText = `Order ${o?.n ?? ""} · shipment ${s?.n ?? ""}`;
    }
  }
  type Box = BoxingNoteData["boxes"][number];
  const boxes: Box[] = [];
  const raw = new Map<Box, Decimal>();
  const lineage: BoxingNoteData["lineage"] = [];
  if (p.shipmentId && p.sourceKind === "sales_order") {
    const lines = await q
      .select({ l: shipmentLines, lotNumber: inventoryLots.lotNumber, expiresOn: inventoryLots.expiresOn, boxNumber: containers.containerNumber, kind: containers.containerKind, sku: products.skuCode, loc: locations.code, partial: containers.isPartial })
      .from(shipmentLines)
      .innerJoin(inventoryLots, eq(inventoryLots.id, shipmentLines.lotId))
      .innerJoin(salesOrderLines, eq(salesOrderLines.id, shipmentLines.salesOrderLineId))
      .innerJoin(products, eq(products.id, salesOrderLines.productId))
      .innerJoin(locations, eq(locations.id, shipmentLines.fromLocationId))
      .leftJoin(containers, eq(containers.id, shipmentLines.containerId))
      .where(eq(shipmentLines.shipmentId, p.shipmentId))
      .orderBy(asc(shipmentLines.verifiedAt));
    lines.forEach((l, i) => {
      const b: Box = {
        boxNo: i + 1,
        boxNumber: l.boxNumber ?? "Loose units",
        kind: l.kind ?? "loose",
        sku: l.sku,
        lotNumber: l.lotNumber,
        expiresText: l.expiresOn ? fmtDate(l.expiresOn) : "No expiry",
        qtyText: qtyText(l.l.qtyBase, l.l.baseUom),
        partial: !!l.partial,
        statusText: l.l.isOverShipment ? "Verified · over-shipment approved" : "Verified",
        locationText: null,
        lineageText: null,
      };
      boxes.push(b);
      raw.set(b, D(l.l.qtyBase));
    });
  } else {
    const rows = await q
      .select({ b: packBoxes, number: containers.containerNumber, kind: containers.containerKind, cstatus: containers.status, lotNumber: inventoryLots.lotNumber, expiresOn: inventoryLots.expiresOn, baseUom: inventoryLots.baseUom, loc: locations.code })
      .from(packBoxes)
      .innerJoin(containers, eq(containers.id, packBoxes.containerId))
      .innerJoin(inventoryLots, eq(inventoryLots.id, packBoxes.lotId))
      .leftJoin(locations, eq(locations.id, containers.currentLocationId))
      .where(and(eq(packBoxes.packId, p.id), inArray(packBoxes.status, ["packed", "repacked"])))
      .orderBy(asc(packBoxes.boxNo));
    const ids = rows.map((r) => r.b.containerId);
    const edges = ids.length
      ? await q
          .select({ e: containerLineage, parent: sql<string>`(select container_number from ${containers} where id = ${containerLineage.parentContainerId})`, child: sql<string>`(select container_number from ${containers} where id = ${containerLineage.childContainerId})`, lotNumber: inventoryLots.lotNumber, baseUom: inventoryLots.baseUom })
          .from(containerLineage)
          .innerJoin(inventoryLots, eq(inventoryLots.id, containerLineage.lotId))
          .where(and(eq(containerLineage.operation, "repack"), or(inArray(containerLineage.parentContainerId, ids), inArray(containerLineage.childContainerId, ids))))
          .orderBy(asc(containerLineage.performedAt))
      : [];
    for (const r of rows) {
      const into = edges.filter((e) => e.e.parentContainerId === r.b.containerId).map((e) => e.child);
      const from = edges.filter((e) => e.e.childContainerId === r.b.containerId).map((e) => e.parent);
      const b: Box = {
        boxNo: r.b.boxNo,
        boxNumber: r.number,
        kind: r.kind,
        sku: row.sku,
        lotNumber: r.lotNumber,
        expiresText: r.expiresOn ? fmtDate(r.expiresOn) : "No expiry",
        qtyText: qtyText(r.b.qtyBase, r.baseUom),
        partial: r.b.isPartial,
        statusText: r.b.status === "repacked" ? "Repacked" : r.cstatus === "sealed" ? "Sealed" : r.cstatus,
        locationText: r.b.status === "repacked" ? null : r.loc,
        lineageText: into.length ? `repacked into ${[...new Set(into)].join(", ")}` : from.length ? `from ${[...new Set(from)].join(", ")}` : null,
      };
      boxes.push(b);
      raw.set(b, D(r.b.qtyBase));
    }
    for (const e of edges) lineage.push({ fromBox: e.parent, toBox: e.child, lotNumber: e.lotNumber, qtyText: qtyText(e.e.qtyBase, e.baseUom), atText: fmtDateTime(e.e.performedAt) });
  }
  const bySkuLot = new Map<string, { sku: string; lotNumber: string; boxes: number; units: Decimal; uom: string }>();
  const lotNumbers = new Set<string>();
  for (const b of boxes) {
    if (b.statusText === "Repacked") continue;
    lotNumbers.add(b.lotNumber);
    const k = `${b.sku}|${b.lotNumber}`;
    const v = bySkuLot.get(k) ?? { sku: b.sku, lotNumber: b.lotNumber, boxes: 0, units: new Decimal(0), uom: "pcs" };
    v.boxes += b.boxNumber === "Loose units" ? 0 : 1;
    v.units = v.units.plus(raw.get(b) ?? 0);
    bySkuLot.set(k, v);
  }
  const live = boxes.filter((b) => b.statusText !== "Repacked");
  const totalUnits = [...bySkuLot.values()].reduce((a, v) => a.plus(v.units), new Decimal(0));
  const [prev] = await q
    .select({ n: generatedDocuments.documentNumber })
    .from(generatedDocuments)
    .where(and(eq(generatedDocuments.sourceEntityType, "pack"), eq(generatedDocuments.sourceEntityId, p.id), eq(generatedDocuments.documentKind, "boxing_note"), eq(generatedDocuments.status, "ready"), sql`${generatedDocuments.reprintOfId} is null`))
    .orderBy(desc(generatedDocuments.generatedAt))
    .limit(1);
  const data: BoxingNoteData = {
    variant: p.sourceKind === "repack" ? "repack" : p.shipmentId ? "order" : p.sourceKind === "sales_order" ? "order" : "batch",
    pack: {
      packNumber: p.packNumber,
      sourceText: sourceText.slice(0, 160),
      customerText,
      productText: `${row.sku} · ${row.productName}`.slice(0, 200),
      lotText: [...lotNumbers].join(", ").slice(0, 300) || "—",
      packedOn: fmtDate(p.createdAt),
      packedBy: row.packer,
      checkedBy: checker,
      checkedAt: p.verifiedAt ? fmtDateTime(p.verifiedAt) : null,
      configText: cfg.source === "customer_requirement" ? "Customer requirement (approved)" : cfg.source === "entered" ? "Entered at repack" : cfg.source === "shipment_verification" ? "Verified against the order" : "SKU default",
      defaultConfigUsed: p.usedDefaultConfig,
      unitsPerBox: p.unitsPerBox,
      shippingMarks: cfg.shippingMarks ?? null,
      statusText: p.status,
    },
    boxes,
    totals: {
      boxes: live.filter((b) => b.boxNumber !== "Loose units").length,
      unitsText: totalUnits.toString(),
      expectedText: p.expectedUnitsBase ? D(p.expectedUnitsBase).toString() : null,
      differenceText: p.expectedUnitsBase ? D(p.expectedUnitsBase).minus(p.packedUnitsBase).toString() : null,
      bySkuLot: [...bySkuLot.values()].map((v) => ({ sku: v.sku, lotNumber: v.lotNumber, boxes: v.boxes, unitsText: v.units.toString() })),
    },
    lineage,
    replaces: prev?.n ?? null,
  };
  return { data, pack: p, replaces: prev?.n ?? null };
}

/** Generates the boxing note / packing list of a pack in the caller's transaction (supersedes the previous one). */
export async function generateBoxingNoteInTx(tx: Tx, ctx: AuthContext, packId: string, opts: { supersede: boolean; idempotencyKey?: string | null }) {
  const { data, pack } = await boxingNoteData(tx, packId);
  const code = await getSetting(tx, ctx.organizationId, "documents.boxing_note.template_code", pack.siteId);
  const resolved = await resolveTemplateVersion(tx, ctx.organizationId, { templateCode: code, siteId: pack.siteId });
  if (!resolved) throw new DomainError("setup_required", `No approved boxing note template (${code}) exists. Ask QA or an administrator to approve one under Admin → Templates.`);
  const doc = await generateForSource(tx, ctx, {
    resolved,
    documentKind: "boxing_note",
    source: { type: "pack", id: pack.id, revisionAt: new Date(), state: pack.status },
    siteId: pack.siteId,
    data,
    watermark: pack.status === "open" ? "NOT VERIFIED" : null,
    idempotencyKey: opts.idempotencyKey ?? null,
    parameters: { dataset: "boxing_note/v1", variant: data.variant },
    supersedePrevious: opts.supersede,
    supersedeReason: data.replaces ? `Regenerated after a change to the pack (replaced by a new version)` : undefined,
  });
  await tx.update(packs).set({ boxingNoteDocumentId: doc.id }).where(eq(packs.id, pack.id));
  return doc;
}

/** The packing list of a shipment's verification pack (used by completePacking). */
export async function generateBoxingNoteForShipment(tx: Tx, ctx: AuthContext, packId: string) {
  return generateBoxingNoteInTx(tx, ctx, packId, { supersede: true });
}

/** On-demand (re)generation from the pack screen (documents.generated_document.create). */
export async function generateBoxingNote(ctx: AuthContext, packId: string, input: { idempotencyKey: string }) {
  ctx.require("documents.generated_document.create");
  ctx.require("inventory.pack.view");
  const p = await getPackRow(ctx, packId);
  const key = `boxingnote:${input.idempotencyKey}`;
  return db.transaction(async (tx) => {
    const [replay] = await tx.select().from(generatedDocuments).where(and(eq(generatedDocuments.organizationId, ctx.organizationId), eq(generatedDocuments.idempotencyKey, key))).limit(1);
    if (replay) return { id: replay.id, documentNumber: replay.documentNumber };
    const doc = await generateBoxingNoteInTx(tx, ctx, p.id, { supersede: true, idempotencyKey: key });
    return { id: doc.id, documentNumber: doc.documentNumber };
  });
}

/* ------------------------------------------------------------------------------------------ queries */

export async function getPack(ctx: AuthContext, packId: string) {
  ctx.require("inventory.pack.view");
  const p = await getPackRow(ctx, packId);
  const [info] = await db
    .select({ packer: users.displayName, sku: products.skuCode, productName: products.name, lotNumber: inventoryLots.lotNumber, lotStatus: inventoryLots.qualityStatus, expiresOn: inventoryLots.expiresOn, baseUom: inventoryLots.baseUom, locationCode: locations.code })
    .from(packs)
    .innerJoin(users, eq(users.id, packs.packedBy))
    .innerJoin(products, eq(products.id, packs.productId))
    .leftJoin(inventoryLots, eq(inventoryLots.id, packs.lotId))
    .leftJoin(locations, eq(locations.id, packs.locationId))
    .where(eq(packs.id, p.id));
  const checker = p.checkedBy ? (await db.select({ n: users.displayName }).from(users).where(eq(users.id, p.checkedBy)))[0]?.n ?? null : null;
  const boxes = await db
    .select({ b: packBoxes, number: containers.containerNumber, status: containers.status, lotNumber: inventoryLots.lotNumber, lotStatus: inventoryLots.qualityStatus })
    .from(packBoxes)
    .innerJoin(containers, eq(containers.id, packBoxes.containerId))
    .innerJoin(inventoryLots, eq(inventoryLots.id, packBoxes.lotId))
    .where(eq(packBoxes.packId, p.id))
    .orderBy(asc(packBoxes.boxNo));
  const ids = boxes.map((b) => b.b.containerId);
  const labels = ids.length
    ? await db.select({ entityId: labelJobs.entityId, status: labelJobs.status, voidedAt: labelJobs.voidedAt, id: labelJobs.id }).from(labelJobs).where(and(eq(labelJobs.entityType, "container"), inArray(labelJobs.entityId, ids))).orderBy(desc(labelJobs.requestedAt))
    : [];
  const scans = await db.select({ s: packVerificationScans, by: users.displayName, number: containers.containerNumber }).from(packVerificationScans).innerJoin(users, eq(users.id, packVerificationScans.scannedBy)).leftJoin(containers, eq(containers.id, packVerificationScans.containerId)).where(eq(packVerificationScans.packId, p.id)).orderBy(desc(packVerificationScans.scannedAt)).limit(100);
  const okIds = new Set(scans.filter((s) => s.s.result === "ok").map((s) => s.s.containerId));
  const docs = await db.select().from(generatedDocuments).where(and(eq(generatedDocuments.organizationId, ctx.organizationId), eq(generatedDocuments.sourceEntityType, "pack"), eq(generatedDocuments.sourceEntityId, p.id))).orderBy(desc(generatedDocuments.generatedAt));
  const tpl = await labelTemplateFor(db, ctx.organizationId, p.siteId);
  return {
    pack: p,
    ...info,
    checkerName: checker,
    boxes: boxes.map((b) => {
      const l = labels.find((x) => x.entityId === b.b.containerId && !x.voidedAt && ["queued", "rendering", "ready", "printed"].includes(x.status));
      return { ...b.b, number: b.number, containerStatus: b.status, lotNumber: b.lotNumber, lotStatus: b.lotStatus, labelStatus: l?.status ?? null, labelJobId: l?.id ?? null, checked: okIds.has(b.b.containerId) };
    }),
    scans: scans.map((s) => ({ ...s.s, scannedByName: s.by, boxNumber: s.number })),
    documents: docs,
    checkedCount: boxes.filter((b) => b.b.status === "packed" && okIds.has(b.b.containerId)).length,
    required: p.verificationMode === "all" ? boxes.filter((b) => b.b.status === "packed").length : Math.min(p.verificationSampleSize ?? 1, boxes.filter((b) => b.b.status === "packed").length),
    labelTemplate: tpl ? { id: tpl.id, code: tpl.code } : null,
    isPacker: p.packedBy === ctx.userId,
  };
}

export async function listPacks(ctx: AuthContext, f: { status?: string } = {}) {
  ctx.require("inventory.pack.view");
  ctx.requireSite(ctx.currentSiteId);
  const conds = [eq(packs.siteId, ctx.currentSiteId)];
  if (f.status === "open" || f.status === "verified" || f.status === "closed" || f.status === "cancelled") conds.push(eq(packs.status, f.status));
  return db
    .select({ id: packs.id, packNumber: packs.packNumber, status: packs.status, sourceKind: packs.sourceKind, boxCount: packs.boxCount, packedUnits: packs.packedUnitsBase, expectedUnits: packs.expectedUnitsBase, createdAt: packs.createdAt, submittedAt: packs.submittedAt, sku: products.skuCode, productName: products.name, lotNumber: inventoryLots.lotNumber, packer: users.displayName, usedDefaultConfig: packs.usedDefaultConfig, shipmentId: packs.shipmentId })
    .from(packs)
    .innerJoin(products, eq(products.id, packs.productId))
    .innerJoin(users, eq(users.id, packs.packedBy))
    .leftJoin(inventoryLots, eq(inventoryLots.id, packs.lotId))
    .where(and(...conds))
    .orderBy(desc(packs.createdAt))
    .limit(200);
}

/** Batch outputs of finished goods at the current site that have no live pack yet (boxing queue). */
export async function boxableOutputs(ctx: AuthContext) {
  ctx.require("inventory.pack.view");
  ctx.requireSite(ctx.currentSiteId);
  return db
    .select({ id: batchOutputs.id, batchNumber: batches.batchNumber, qty: batchOutputs.qtyBase, baseUom: batchOutputs.baseUom, lotNumber: inventoryLots.lotNumber, lotStatus: inventoryLots.qualityStatus, sku: products.skuCode, productName: products.name, recordedAt: batchOutputs.recordedAt })
    .from(batchOutputs)
    .innerJoin(batches, eq(batches.id, batchOutputs.batchId))
    .innerJoin(inventoryLots, eq(inventoryLots.id, batchOutputs.lotId))
    .innerJoin(products, eq(products.id, batchOutputs.productId))
    .where(
      and(
        eq(batchOutputs.siteId, ctx.currentSiteId),
        eq(batchOutputs.outputKind, "finished"),
        sql`not exists (select 1 from ${packs} p where p.batch_output_id = ${batchOutputs.id} and p.status <> 'cancelled')`,
      ),
    )
    .orderBy(desc(batchOutputs.recordedAt))
    .limit(50);
}
