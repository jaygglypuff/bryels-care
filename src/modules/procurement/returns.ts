import "server-only";
import Decimal from "decimal.js";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { db, type Tx } from "@/db/client";
import {
  goodsReceiptLines,
  goodsReceipts,
  inventoryBalances,
  inventoryLots,
  locations,
  materials,
  purchaseOrderLines,
  purchaseOrders,
  sites,
  supplierReturnLines,
  supplierReturnStateTransitions,
  supplierReturns,
  suppliers,
  users,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { nextNumber } from "@/lib/numbering";
import { postMovement } from "@/modules/inventory";
import { assertReasonCode, reasonCodeOptions } from "@/modules/masterdata";
import { notifyRoles } from "@/modules/platform";
import { approvalProgress, canDecide, decisionsOf, recordDecision } from "./approvals";
import { SR_STATUS_LABEL, type SrStatus, logCreation, transitionSr } from "./state";
import { assertInScope, canSeePrices, cleanText, idempotent, isUuid, money4, optDecimal, parseDecimal, requireReason, toBase } from "./shared";

/**
 * Supplier returns (US-6-21, W01-11, W04-09; docs/data-model.md `supplier_returns`).
 *
 *   draft → submitted → approved → posted; submitted → draft (returned); draft|submitted|approved → cancelled
 *
 * - Lines name lots of the return's supplier (the goods receipt that created the lot) that are
 *   `rejected` by a QA disposition; any other status is refused until QA rejects the lot (W04-09).
 * - Stock leaves from a receiving, quarantine, hold or rejected location.
 * - Approval per `approval_rules` `supplier_return` on the expected credit (A-PM-15), approver ≠
 *   creator/submitter; posting (`procurement.supplier_return.post`) by someone other than the approver
 *   writes one `issue` movement per line (`source_document_type = supplier_return`) in one transaction,
 *   with an idempotency key. The expected credit feeds the supplier bill dispute (W4B finance).
 */

const RETURN_FROM_KINDS = ["receiving", "quarantine", "hold", "rejected"] as const;

type SrRow = typeof supplierReturns.$inferSelect;

async function lockSr(tx: Tx, ctx: AuthContext, returnId: string) {
  if (!isUuid(returnId)) throw new DomainError("not_found", "Supplier return not found in your sites.");
  const [r] = await tx.select().from(supplierReturns).where(and(eq(supplierReturns.id, returnId), eq(supplierReturns.organizationId, ctx.organizationId))).for("update").limit(1);
  if (!r) throw new DomainError("not_found", "Supplier return not found in your sites.");
  assertInScope(ctx, r.siteId, "Supplier return");
  return r;
}

/** Supplier of a lot: the supplier on the goods receipt that created it. */
async function lotSupplierId(tx: Tx, lotId: string): Promise<string | null> {
  const [r] = await tx.select({ supplierId: goodsReceipts.supplierId }).from(goodsReceiptLines).innerJoin(goodsReceipts, eq(goodsReceipts.id, goodsReceiptLines.goodsReceiptId)).where(eq(goodsReceiptLines.lotId, lotId)).limit(1);
  return r?.supplierId ?? null;
}

export async function returnReasonOptions(ctx: AuthContext) {
  return reasonCodeOptions(db, ctx.organizationId, "return");
}

export async function createSupplierReturn(ctx: AuthContext, input: { supplierId: string; goodsReceiptId?: string | null; reasonCode: string; reasonNote?: string | null; supplierRmaReference?: string | null; idempotencyKey?: string | null }) {
  const siteId = ctx.currentSiteId;
  ctx.requireAt("procurement.supplier_return.create", siteId);
  ctx.assertWritable();
  return db.transaction(async (tx) => {
    const r = await idempotent(tx, ctx, input.idempotencyKey ?? null, "procurement.supplier_return.create", async () => {
      if (!isUuid(input.supplierId)) throw new DomainError("validation", "Choose the supplier.", { field: "supplierId" });
      const [s] = await tx.select().from(suppliers).where(and(eq(suppliers.id, input.supplierId), eq(suppliers.organizationId, ctx.organizationId))).limit(1);
      if (!s) throw new DomainError("validation", "Choose the supplier.", { field: "supplierId" });
      const reason = await assertReasonCode(tx, ctx.organizationId, "return", input.reasonCode, input.reasonNote);
      let goodsReceiptId: string | null = null;
      let purchaseOrderId: string | null = null;
      if (input.goodsReceiptId) {
        if (!isUuid(input.goodsReceiptId)) throw new DomainError("validation", "Choose a receipt from the list.", { field: "goodsReceiptId" });
        const [gr] = await tx.select().from(goodsReceipts).where(and(eq(goodsReceipts.id, input.goodsReceiptId), eq(goodsReceipts.organizationId, ctx.organizationId))).limit(1);
        if (!gr || gr.siteId !== siteId) throw new DomainError("validation", "That receipt is not at this site.", { field: "goodsReceiptId" });
        if (gr.supplierId !== s.id) throw new DomainError("validation", `Receipt ${gr.receiptNumber ?? ""} is not from ${s.name}.`, { field: "goodsReceiptId" });
        goodsReceiptId = gr.id;
        purchaseOrderId = gr.purchaseOrderId;
      }
      const returnNumber = await nextNumber(tx, ctx.organizationId, "SRT");
      const [sr] = await tx
        .insert(supplierReturns)
        .values({
          organizationId: ctx.organizationId,
          siteId,
          returnNumber,
          status: "draft",
          supplierId: s.id,
          goodsReceiptId,
          purchaseOrderId,
          reasonCode: reason.code,
          reasonNote: reason.note,
          supplierRmaReference: cleanText(input.supplierRmaReference, 80, "supplierRmaReference", "Supplier RMA reference"),
          createdBy: ctx.userId,
          statusChangedBy: ctx.userId,
        })
        .returning();
      await logCreation(tx, ctx, "sr", sr);
      await audit(tx, ctx, { action: "procurement.supplier_return.created", entityType: "supplier_return", entityId: sr.id, entityNumber: returnNumber, siteId, reason: reason.note, after: { supplier: s.code, reasonCode: reason.code, goodsReceiptId } });
      return { returnId: sr.id, returnNumber };
    });
    return { ...r.result, replayed: r.replayed };
  });
}

/** Rejected lots of a supplier with stock at the site, for the line picker. */
export async function returnableLots(ctx: AuthContext, supplierId: string) {
  ctx.require("procurement.supplier_return.view");
  if (!isUuid(supplierId)) return [];
  const siteId = ctx.currentSiteId;
  const rows = await db
    .select({ lotId: inventoryLots.id, lotNumber: inventoryLots.lotNumber, status: inventoryLots.qualityStatus, supplierLot: inventoryLots.supplierLotNumber, materialCode: materials.code, materialName: materials.name, baseUom: inventoryLots.baseUom, locationId: locations.id, locationCode: locations.code, locationKind: locations.kind, qty: inventoryBalances.qtyBase })
    .from(inventoryLots)
    .innerJoin(goodsReceiptLines, eq(goodsReceiptLines.lotId, inventoryLots.id))
    .innerJoin(goodsReceipts, eq(goodsReceipts.id, goodsReceiptLines.goodsReceiptId))
    .innerJoin(inventoryBalances, eq(inventoryBalances.lotId, inventoryLots.id))
    .innerJoin(locations, eq(locations.id, inventoryBalances.locationId))
    .innerJoin(materials, eq(materials.id, inventoryLots.materialId))
    .where(and(eq(inventoryLots.siteId, siteId), eq(goodsReceipts.supplierId, supplierId), sql`${inventoryBalances.qtyBase} > 0`, inArray(locations.kind, [...RETURN_FROM_KINDS])))
    .orderBy(asc(inventoryLots.lotNumber));
  return rows.map((r) => ({ ...r, returnable: r.status === "rejected" }));
}

/** Adds a lot line to a draft (W04-09). The lot must be `rejected` and of the return's supplier. */
export async function addSupplierReturnLine(ctx: AuthContext, input: { returnId: string; lotId?: string | null; lotCode?: string | null; locationId: string; qty: string; uom?: string | null; creditExpectedAmount?: string | null }) {
  return db.transaction(async (tx) => {
    const sr = await lockSr(tx, ctx, input.returnId);
    ctx.requireAt("procurement.supplier_return.create", sr.siteId);
    if (sr.status !== "draft") throw new DomainError("state", `Supplier return ${sr.returnNumber} is ${SR_STATUS_LABEL[sr.status as SrStatus].toLowerCase()}; lines change only in a draft.`);
    let lot: typeof inventoryLots.$inferSelect | undefined;
    const code = (input.lotCode ?? "").trim().replace(/^BC:LOT:/i, "");
    if (input.lotId && isUuid(input.lotId)) [lot] = await tx.select().from(inventoryLots).where(and(eq(inventoryLots.id, input.lotId), eq(inventoryLots.organizationId, ctx.organizationId))).limit(1);
    else if (code) [lot] = await tx.select().from(inventoryLots).where(and(eq(inventoryLots.lotNumber, code), eq(inventoryLots.organizationId, ctx.organizationId))).limit(1);
    if (!lot || lot.siteId !== sr.siteId) throw new DomainError("validation", "Choose or scan a lot of this site.", { field: "lotId" });
    if (lot.qualityStatus !== "rejected") {
      throw new DomainError("blocked_lot", `Lot ${lot.lotNumber} is ${lot.qualityStatus.replace("_", " ")}. Only lots rejected by QA are returned to the supplier; ask QA for a disposition first (W04-09).`, { field: "lotId", rule: "V-QA", status: lot.qualityStatus });
    }
    if ((await lotSupplierId(tx, lot.id)) !== sr.supplierId) throw new DomainError("validation", `Lot ${lot.lotNumber} was not received from this supplier.`, { field: "lotId" });
    if (!isUuid(input.locationId)) throw new DomainError("validation", "Choose the location the goods leave from.", { field: "locationId" });
    const [loc] = await tx.select().from(locations).where(and(eq(locations.id, input.locationId), eq(locations.siteId, sr.siteId))).limit(1);
    if (!loc || !(RETURN_FROM_KINDS as readonly string[]).includes(loc.kind)) throw new DomainError("validation", `Returns leave from a ${RETURN_FROM_KINDS.join(", ")} location of this site.`, { field: "locationId" });
    const [mat] = await tx.select().from(materials).where(eq(materials.id, lot.materialId!));
    const qty = parseDecimal(input.qty, "qty", "Quantity");
    const uom = (input.uom || lot.baseUom).trim();
    const qtyBase = mat ? await toBase(tx, ctx.organizationId, mat, qty, uom) : uom === lot.baseUom ? qty : null;
    if (!qtyBase) throw new DomainError("validation", `${uom} cannot be converted to ${lot.baseUom} (V-UOM).`, { field: "uom" });
    const [bal] = await tx.select().from(inventoryBalances).where(and(eq(inventoryBalances.lotId, lot.id), eq(inventoryBalances.locationId, loc.id))).limit(1);
    const existing = await tx.select().from(supplierReturnLines).where(eq(supplierReturnLines.supplierReturnId, sr.id));
    const already = existing.filter((l) => l.lotId === lot!.id && l.fromLocationId === loc.id).reduce((s, l) => s.plus(l.qtyBase), new Decimal(0));
    if (new Decimal(bal?.qtyBase ?? 0).lt(already.plus(qtyBase))) {
      throw new DomainError("insufficient_stock", `Lot ${lot.lotNumber} has ${new Decimal(bal?.qtyBase ?? 0).toString()} ${lot.baseUom} at ${loc.code}; this return would take ${already.plus(qtyBase).toString()}.`, { field: "qty" });
    }
    // Expected credit: entered (price viewers), else the PO line price of the lot's receipt.
    let credit = canSeePrices(ctx) ? optDecimal(input.creditExpectedAmount, "creditExpectedAmount", "Expected credit", { dp: 4, allowZero: true }) : null;
    if (!credit && mat) {
      const [pl] = await tx
        .select({ unit: purchaseOrderLines.unitAmount, uom: purchaseOrderLines.uomEntered })
        .from(goodsReceiptLines)
        .innerJoin(purchaseOrderLines, eq(purchaseOrderLines.id, goodsReceiptLines.purchaseOrderLineId))
        .where(eq(goodsReceiptLines.lotId, lot.id))
        .limit(1);
      const per = pl ? await toBase(tx, ctx.organizationId, mat, new Decimal(1), pl.uom) : null;
      if (pl && per && !per.isZero()) credit = qtyBase.div(per).mul(pl.unit);
    }
    const lineNo = existing.reduce((m, l) => Math.max(m, l.lineNo), 0) + 1;
    const [line] = await tx
      .insert(supplierReturnLines)
      .values({ organizationId: ctx.organizationId, siteId: sr.siteId, supplierReturnId: sr.id, lineNo, lotId: lot.id, fromLocationId: loc.id, qtyEntered: qty.toString(), uomEntered: uom, qtyBase: qtyBase.toString(), baseUom: lot.baseUom, creditExpectedAmount: credit ? money4(credit) : null, currency: sr.currency })
      .returning();
    await refreshCredit(tx, sr.id);
    await audit(tx, ctx, { action: "procurement.supplier_return.line_added", entityType: "supplier_return", entityId: sr.id, entityNumber: sr.returnNumber, siteId: sr.siteId, after: { lineNo, lot: lot.lotNumber, location: loc.code, qtyBase: qtyBase.toString(), uom: lot.baseUom } });
    return { lineId: line.id, lineNo, lotNumber: lot.lotNumber, qty: qtyBase.toString(), uom: lot.baseUom };
  });
}

async function refreshCredit(tx: Tx, returnId: string) {
  const lines = await tx.select({ c: supplierReturnLines.creditExpectedAmount }).from(supplierReturnLines).where(eq(supplierReturnLines.supplierReturnId, returnId));
  const priced = lines.filter((l) => l.c !== null);
  const total = priced.length === lines.length && lines.length ? money4(priced.reduce((s, l) => s.plus(l.c!), new Decimal(0))) : null;
  await tx.update(supplierReturns).set({ creditExpectedAmount: total, updatedAt: new Date() }).where(eq(supplierReturns.id, returnId));
}

export async function removeSupplierReturnLine(ctx: AuthContext, input: { returnId: string; lineId: string }) {
  return db.transaction(async (tx) => {
    const sr = await lockSr(tx, ctx, input.returnId);
    ctx.requireAt("procurement.supplier_return.create", sr.siteId);
    if (sr.status !== "draft") throw new DomainError("state", `Supplier return ${sr.returnNumber} is not a draft.`);
    if (!isUuid(input.lineId)) throw new DomainError("not_found", "Line not found.");
    const del = await tx.delete(supplierReturnLines).where(and(eq(supplierReturnLines.id, input.lineId), eq(supplierReturnLines.supplierReturnId, sr.id))).returning();
    if (!del.length) throw new DomainError("not_found", "Line not found.");
    await refreshCredit(tx, sr.id);
    await audit(tx, ctx, { action: "procurement.supplier_return.line_removed", entityType: "supplier_return", entityId: sr.id, entityNumber: sr.returnNumber, siteId: sr.siteId, after: { lineNo: del[0].lineNo } });
    return { returnId: sr.id };
  });
}

/** Unknown credit is treated as above every threshold (fail-safe: the owner step applies, A-W4A-07). */
const basisOf = (sr: SrRow) => ({ amount: sr.creditExpectedAmount ?? ("unbounded" as const) });

export async function submitSupplierReturn(ctx: AuthContext, input: { returnId: string }) {
  return db.transaction(async (tx) => {
    const sr = await lockSr(tx, ctx, input.returnId);
    ctx.requireAt("procurement.supplier_return.create", sr.siteId);
    const lines = await tx.select().from(supplierReturnLines).where(eq(supplierReturnLines.supplierReturnId, sr.id));
    if (!lines.length) throw new DomainError("validation", "Add at least one lot before submitting.", { field: "lines" });
    await transitionSr(tx, ctx, sr, "submitted", { set: { submittedBy: ctx.userId, submittedAt: new Date() } });
    await audit(tx, ctx, { action: "procurement.supplier_return.submitted", entityType: "supplier_return", entityId: sr.id, entityNumber: sr.returnNumber, siteId: sr.siteId, after: { lines: lines.length, credit: sr.creditExpectedAmount } });
    const progress = await approvalProgress(tx, ctx.organizationId, { recordType: "supplier_return", recordId: sr.id, siteId: sr.siteId, basis: basisOf(sr) });
    await notifyRoles(tx, { roleCodes: progress.next?.roleCodes.length ? progress.next.roleCodes : ["site_manager"], siteId: sr.siteId }, { organizationId: ctx.organizationId, siteId: sr.siteId, kind: "supplier_return_submitted", severity: "info", title: `Supplier return ${sr.returnNumber} waits for approval`, body: `${lines.length} lot line(s).`, entityType: "supplier_return", entityId: sr.id, link: `/procurement/returns/${sr.id}` });
    return { returnId: sr.id, status: "submitted" as const };
  });
}

export async function decideSupplierReturn(ctx: AuthContext, input: { returnId: string; decision: "approve" | "return"; note?: string | null }) {
  if (input.decision !== "approve" && input.decision !== "return") throw new DomainError("validation", "Choose a decision.", { field: "decision" });
  return db.transaction(async (tx) => {
    const sr = await lockSr(tx, ctx, input.returnId);
    ctx.requireAt("procurement.supplier_return.approve", sr.siteId);
    if (sr.status !== "submitted") throw new DomainError("state", `Supplier return ${sr.returnNumber} is ${SR_STATUS_LABEL[sr.status as SrStatus].toLowerCase()}; only submitted returns are approved.`);
    const decision = input.decision === "approve" ? "approved" : "returned";
    const r = await recordDecision(tx, ctx, { recordType: "supplier_return", recordId: sr.id, recordNumber: sr.returnNumber, siteId: sr.siteId, basis: basisOf(sr), pendingSince: sr.submittedAt, excludedUserIds: [sr.createdBy, sr.submittedBy], decision, note: input.note });
    if (decision === "approved" && r.final) {
      await transitionSr(tx, ctx, sr, "approved", { set: { approvedBy: ctx.userId, approvedAt: new Date(), approvalNote: input.note?.trim() || null } });
      await notifyRoles(tx, { roleCodes: ["warehouse_operator", "procurement"], siteId: sr.siteId }, { organizationId: ctx.organizationId, siteId: sr.siteId, kind: "supplier_return_approved", severity: "info", title: `Supplier return ${sr.returnNumber} approved`, body: "Post it when the goods leave.", entityType: "supplier_return", entityId: sr.id, link: `/procurement/returns/${sr.id}` });
    } else if (decision === "returned") {
      await transitionSr(tx, ctx, sr, "draft", { reason: input.note });
    }
    await audit(tx, ctx, { action: decision === "approved" ? (r.final ? "procurement.supplier_return.approved" : "procurement.supplier_return.step_approved") : "procurement.supplier_return.returned", entityType: "supplier_return", entityId: sr.id, entityNumber: sr.returnNumber, siteId: sr.siteId, reason: input.note?.trim() || null, after: { status: sr.status, step: r.step?.step ?? 1, final: r.final } });
    return { returnId: sr.id, status: sr.status as SrStatus, final: r.final };
  });
}

export async function cancelSupplierReturn(ctx: AuthContext, input: { returnId: string; reason: string }) {
  const reason = requireReason(input.reason);
  return db.transaction(async (tx) => {
    const sr = await lockSr(tx, ctx, input.returnId);
    if (!ctx.canAt("procurement.supplier_return.create", sr.siteId) && !ctx.canAt("procurement.supplier_return.approve", sr.siteId)) ctx.requireAt("procurement.supplier_return.create", sr.siteId);
    await transitionSr(tx, ctx, sr, "cancelled", { reason, set: { cancelReason: reason } });
    await audit(tx, ctx, { action: "procurement.supplier_return.cancelled", entityType: "supplier_return", entityId: sr.id, entityNumber: sr.returnNumber, siteId: sr.siteId, reason });
    return { returnId: sr.id };
  });
}

/**
 * Posts an approved return: one `issue` movement per line out of its location, in one transaction. The
 * poster is not the approver (SoD). Every lot is re-checked as `rejected`. Repeat key → original result.
 */
export async function postSupplierReturn(ctx: AuthContext, input: { returnId: string; idempotencyKey: string }) {
  if (!input.idempotencyKey || input.idempotencyKey.length > 120) throw new DomainError("validation", "The form is missing its submission key. Reload the page and try again.");
  ctx.assertWritable();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"srt-post:" + input.idempotencyKey}))`);
    const sr = await lockSr(tx, ctx, input.returnId);
    ctx.requireAt("procurement.supplier_return.post", sr.siteId);
    if (sr.status === "posted" && sr.postIdempotencyKey === input.idempotencyKey) return { returnId: sr.id, returnNumber: sr.returnNumber, movements: (await tx.select().from(supplierReturnLines).where(eq(supplierReturnLines.supplierReturnId, sr.id))).length, replayed: true };
    if (sr.status !== "approved") throw new DomainError("state", `Supplier return ${sr.returnNumber} is ${SR_STATUS_LABEL[sr.status as SrStatus].toLowerCase()}; only approved returns are posted.`);
    ctx.assertSeparationAt(sr.approvedBy === ctx.userId, "You approved this return, so another person must post it (separation of duties).", sr.siteId, { code: "SEPARATION_OF_DUTIES" });
    const lines = await tx.select().from(supplierReturnLines).where(eq(supplierReturnLines.supplierReturnId, sr.id)).orderBy(asc(supplierReturnLines.lineNo));
    if (!lines.length) throw new DomainError("validation", "The return has no lines.");
    const correlationId = uuidv7();
    const posted: { lineNo: number; lot: string; qty: string; movementId: string }[] = [];
    // Lots in id order (deadlock-free, data-model §5.4); postMovement locks each lot and balance.
    for (const l of [...lines].sort((a, b) => (a.lotId < b.lotId ? -1 : a.lotId > b.lotId ? 1 : a.lineNo - b.lineNo))) {
      const [lot] = await tx.select().from(inventoryLots).where(eq(inventoryLots.id, l.lotId)).for("update");
      if (lot.qualityStatus !== "rejected") throw new DomainError("blocked_lot", `Lot ${lot.lotNumber} is no longer rejected (${lot.qualityStatus}); the return cannot post (W04-09).`, { rule: "V-QA" });
      const { movement } = await postMovement(tx, ctx, {
        movementType: "issue",
        lotId: l.lotId,
        fromLocationId: l.fromLocationId,
        qtyBase: l.qtyBase,
        entered: l.uomEntered !== l.baseUom ? { qty: l.qtyEntered, uom: l.uomEntered } : undefined,
        sourceDocumentType: "supplier_return",
        sourceDocumentId: sr.id,
        sourceDocumentNumber: sr.returnNumber,
        reason: `Returned to supplier (${sr.reasonCode})`,
        idempotencyKey: `srt:${sr.id}:${l.lineNo}`,
        correlationId,
      });
      await tx.update(supplierReturnLines).set({ stockMovementId: movement.id }).where(eq(supplierReturnLines.id, l.id));
      posted.push({ lineNo: l.lineNo, lot: lot.lotNumber, qty: l.qtyBase, movementId: movement.id });
    }
    await transitionSr(tx, ctx, sr, "posted", { set: { postedAt: new Date(), postedBy: ctx.userId, postIdempotencyKey: input.idempotencyKey, correlationId } });
    await audit(tx, ctx, { action: "procurement.supplier_return.posted", entityType: "supplier_return", entityId: sr.id, entityNumber: sr.returnNumber, siteId: sr.siteId, after: { correlationId, lines: posted, creditExpected: sr.creditExpectedAmount } });
    return { returnId: sr.id, returnNumber: sr.returnNumber, movements: posted.length, replayed: false };
  });
}

export async function listSupplierReturns(ctx: AuthContext, f: { status?: string } = {}) {
  ctx.require("procurement.supplier_return.view");
  const siteIds = ctx.allowedSiteIds.filter((s) => ctx.canAt("procurement.supplier_return.view", s));
  if (!siteIds.length) return [];
  const conds = [eq(supplierReturns.organizationId, ctx.organizationId), inArray(supplierReturns.siteId, siteIds)];
  if (f.status === "open") conds.push(inArray(supplierReturns.status, ["draft", "submitted", "approved"]));
  else if (f.status && f.status !== "all") conds.push(eq(supplierReturns.status, f.status));
  const rows = await db
    .select({ r: supplierReturns, siteCode: sites.code, supplierName: suppliers.name, lines: sql<number>`(select count(*)::int from supplier_return_lines l where l.supplier_return_id = ${supplierReturns.id})` })
    .from(supplierReturns)
    .innerJoin(sites, eq(sites.id, supplierReturns.siteId))
    .innerJoin(suppliers, eq(suppliers.id, supplierReturns.supplierId))
    .where(and(...conds))
    .orderBy(desc(supplierReturns.createdAt))
    .limit(300);
  const prices = canSeePrices(ctx);
  return rows.map((r) => ({ id: r.r.id, number: r.r.returnNumber, status: r.r.status as SrStatus, siteCode: r.siteCode, supplierName: r.supplierName, lines: Number(r.lines), reasonCode: r.r.reasonCode, credit: prices ? r.r.creditExpectedAmount : undefined, createdAt: r.r.createdAt, postedAt: r.r.postedAt }));
}

export async function getSupplierReturn(ctx: AuthContext, returnId: string) {
  ctx.require("procurement.supplier_return.view");
  if (!isUuid(returnId)) throw new DomainError("not_found", "Supplier return not found in your sites.");
  const [sr] = await db.select().from(supplierReturns).where(and(eq(supplierReturns.id, returnId), eq(supplierReturns.organizationId, ctx.organizationId))).limit(1);
  if (!sr || !ctx.allowedSiteIds.includes(sr.siteId)) throw new DomainError("not_found", "Supplier return not found in your sites.");
  const prices = canSeePrices(ctx);
  const [supplier] = await db.select({ id: suppliers.id, code: suppliers.code, name: suppliers.name }).from(suppliers).where(eq(suppliers.id, sr.supplierId));
  const [site] = await db.select({ code: sites.code, name: sites.name }).from(sites).where(eq(sites.id, sr.siteId));
  const [gr] = sr.goodsReceiptId ? await db.select({ id: goodsReceipts.id, receiptNumber: goodsReceipts.receiptNumber }).from(goodsReceipts).where(eq(goodsReceipts.id, sr.goodsReceiptId)) : [];
  const [po] = sr.purchaseOrderId ? await db.select({ id: purchaseOrders.id, poNumber: purchaseOrders.poNumber }).from(purchaseOrders).where(eq(purchaseOrders.id, sr.purchaseOrderId)) : [];
  const lines = await db
    .select({ l: supplierReturnLines, lotNumber: inventoryLots.lotNumber, lotStatus: inventoryLots.qualityStatus, supplierLot: inventoryLots.supplierLotNumber, materialCode: materials.code, materialName: materials.name, locationCode: locations.code })
    .from(supplierReturnLines)
    .innerJoin(inventoryLots, eq(inventoryLots.id, supplierReturnLines.lotId))
    .innerJoin(locations, eq(locations.id, supplierReturnLines.fromLocationId))
    .leftJoin(materials, eq(materials.id, inventoryLots.materialId))
    .where(eq(supplierReturnLines.supplierReturnId, sr.id))
    .orderBy(asc(supplierReturnLines.lineNo));
  const transitions = await db
    .select({ t: supplierReturnStateTransitions, actorName: users.displayName })
    .from(supplierReturnStateTransitions)
    .innerJoin(users, eq(users.id, supplierReturnStateTransitions.actorId))
    .where(eq(supplierReturnStateTransitions.supplierReturnId, sr.id))
    .orderBy(asc(supplierReturnStateTransitions.occurredAt));
  const progress = await approvalProgress(db, ctx.organizationId, { recordType: "supplier_return", recordId: sr.id, siteId: sr.siteId, basis: basisOf(sr), requesterIds: [sr.createdBy, sr.submittedBy] });
  const decisions = await decisionsOf(db, ctx.organizationId, "supplier_return", sr.id);
  return {
    sr: { ...sr, status: sr.status as SrStatus, creditExpectedAmount: prices ? sr.creditExpectedAmount : null },
    supplier,
    site,
    receipt: gr ?? null,
    po: po ?? null,
    lines: lines.map((r) => ({ ...r.l, creditExpectedAmount: prices ? r.l.creditExpectedAmount : null, lotNumber: r.lotNumber, lotStatus: r.lotStatus, supplierLot: r.supplierLot, materialCode: r.materialCode, materialName: r.materialName, locationCode: r.locationCode })),
    transitions: transitions.map((t) => ({ ...t.t, actorName: t.actorName })),
    progress,
    decisions,
    can: {
      edit: sr.status === "draft" && ctx.canAt("procurement.supplier_return.create", sr.siteId) && ctx.currentSiteId === sr.siteId,
      submit: sr.status === "draft" && ctx.canAt("procurement.supplier_return.create", sr.siteId),
      decide: sr.status === "submitted" && canDecide(ctx, "supplier_return", progress, sr.siteId, sr.submittedAt, [sr.createdBy, sr.submittedBy]),
      post: sr.status === "approved" && ctx.canAt("procurement.supplier_return.post", sr.siteId) && !ctx.sodConflictAt(sr.approvedBy, sr.siteId),
      cancel: ["draft", "submitted", "approved"].includes(sr.status) && (ctx.canAt("procurement.supplier_return.create", sr.siteId) || ctx.canAt("procurement.supplier_return.approve", sr.siteId)),
      seePrices: prices,
    },
  };
}

/** Receipts of the current site (for the "from receipt" picker). */
export async function recentReceiptsOfSupplier(ctx: AuthContext, supplierId: string) {
  ctx.require("procurement.supplier_return.view");
  if (!isUuid(supplierId)) return [];
  return db
    .select({ id: goodsReceipts.id, receiptNumber: goodsReceipts.receiptNumber, receivedAt: goodsReceipts.receivedAt })
    .from(goodsReceipts)
    .where(and(eq(goodsReceipts.siteId, ctx.currentSiteId), eq(goodsReceipts.supplierId, supplierId), or(eq(goodsReceipts.status, "posted"))))
    .orderBy(desc(goodsReceipts.receivedAt))
    .limit(50);
}
