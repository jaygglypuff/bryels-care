import "server-only";
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, type Tx } from "@/db/client";
import {
  fileAttachments,
  goodsReceiptLines,
  goodsReceipts,
  inventoryLots,
  locations,
  materials,
  qualityHoldLots,
  qualityHolds,
  supplierLotDocuments,
  suppliers,
  users,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { toCsv } from "@/modules/masterdata";
import { isUuid } from "./lots";
import { DISCREPANCY_LABELS, UNPLANNED_REASON_CODES, receiptLocationKinds, unitsFor, type DiscrepancyKind } from "./receiving-state";

type Q = Tx | typeof db;

const canViewReceipts = (ctx: AuthContext) => ctx.can("procurement.goods_receipt.view") || ctx.can("inventory.lot.view");

/** Materials, put-away locations, suppliers and reason codes for the receive form (current site). */
export async function receivingFormData(ctx: AuthContext) {
  ctx.require("procurement.goods_receipt.create");
  ctx.requireSite(ctx.currentSiteId);
  const kinds = [...new Set([...receiptLocationKinds("quarantine"), ...receiptLocationKinds("released")])];
  const [mats, locs, sups] = await Promise.all([
    db
      .select({
        id: materials.id,
        code: materials.code,
        name: materials.name,
        baseUom: materials.baseUom,
        shelfLifeDays: materials.shelfLifeDays,
        storageConditions: materials.storageConditions,
        requiresCoa: materials.requiresCoa,
        requiresIncomingInspection: materials.requiresIncomingInspection,
      })
      .from(materials)
      .where(eq(materials.organizationId, ctx.organizationId))
      .orderBy(asc(materials.code)),
    db
      .select({ id: locations.id, code: locations.code, name: locations.name, kind: locations.kind })
      .from(locations)
      .where(and(eq(locations.siteId, ctx.currentSiteId), eq(locations.isActive, true), inArray(locations.kind, kinds)))
      .orderBy(sql`case ${locations.kind} when 'quarantine' then 0 when 'receiving' then 1 when 'hold' then 2 else 3 end`, asc(locations.code)),
    db
      .select({ id: suppliers.id, code: suppliers.code, name: suppliers.name, qualityStatus: suppliers.qualityStatus })
      .from(suppliers)
      .where(and(eq(suppliers.organizationId, ctx.organizationId), eq(suppliers.isActive, true)))
      .orderBy(asc(suppliers.name)),
  ]);
  return {
    materials: mats.map((m) => ({ ...m, units: unitsFor(m.baseUom) })),
    locations: locs,
    suppliers: sups,
    reasonCodes: UNPLANNED_REASON_CODES.map((r) => ({ ...r })),
  };
}

/**
 * Posted receipt with the lots it created (labels, lot pages). Draft lines have no lot and are not listed.
 * Kept in the MVP shape for the label print page.
 */
export async function getReceipt(ctx: AuthContext, receiptId: string) {
  if (!canViewReceipts(ctx)) ctx.require("procurement.goods_receipt.view");
  if (!isUuid(receiptId)) throw new DomainError("not_found", "Receipt not found in your sites.");
  const [gr] = await db
    .select({ receipt: goodsReceipts, receivedByName: users.displayName })
    .from(goodsReceipts)
    .innerJoin(users, eq(users.id, goodsReceipts.receivedBy))
    .where(and(eq(goodsReceipts.id, receiptId), eq(goodsReceipts.organizationId, ctx.organizationId), inArray(goodsReceipts.siteId, ctx.allowedSiteIds)))
    .limit(1);
  if (!gr) throw new DomainError("not_found", "Receipt not found in your sites.");
  ctx.requireSite(gr.receipt.siteId);
  const lines = await db
    .select({
      id: goodsReceiptLines.id,
      qtyBase: goodsReceiptLines.qtyBase,
      lotId: inventoryLots.id,
      lotNumber: inventoryLots.lotNumber,
      qualityStatus: inventoryLots.qualityStatus,
      supplierLotNumber: inventoryLots.supplierLotNumber,
      manufacturedOn: inventoryLots.manufacturedOn,
      expiresOn: inventoryLots.expiresOn,
      baseUom: inventoryLots.baseUom,
      materialCode: materials.code,
      materialName: materials.name,
      locationCode: locations.code,
      locationName: locations.name,
    })
    .from(goodsReceiptLines)
    .innerJoin(inventoryLots, eq(inventoryLots.id, goodsReceiptLines.lotId))
    .innerJoin(materials, eq(materials.id, goodsReceiptLines.materialId))
    .innerJoin(locations, eq(locations.id, goodsReceiptLines.locationId))
    .where(eq(goodsReceiptLines.goodsReceiptId, receiptId))
    .orderBy(asc(goodsReceiptLines.lineNo), asc(inventoryLots.lotNumber));
  return { ...gr.receipt, receiptNumber: gr.receipt.receiptNumber ?? "Draft", receivedByName: gr.receivedByName, lines };
}

const recorder = alias(users, "discrepancy_recorder");
const approver = alias(users, "discrepancy_approver");
const poster = alias(users, "receipt_poster");
const reverser = alias(users, "receipt_reverser");

/** Full goods receipt document for the receipt page: header, lines, discrepancies, documents and what the viewer may do. */
export async function getReceiptDocument(ctx: AuthContext, receiptId: string) {
  ctx.require("procurement.goods_receipt.view");
  if (!isUuid(receiptId)) throw new DomainError("not_found", "Receipt not found in your sites.");
  const [row] = await db
    .select({
      receipt: goodsReceipts,
      receivedByName: users.displayName,
      postedByName: poster.displayName,
      reversedByName: reverser.displayName,
      supplierCode: suppliers.code,
      supplierQualityStatus: suppliers.qualityStatus,
      supplierQualityReason: suppliers.qualityStatusReason,
      supplierActive: suppliers.isActive,
    })
    .from(goodsReceipts)
    .innerJoin(users, eq(users.id, goodsReceipts.receivedBy))
    .leftJoin(poster, eq(poster.id, goodsReceipts.postedBy))
    .leftJoin(reverser, eq(reverser.id, goodsReceipts.reversedBy))
    .leftJoin(suppliers, eq(suppliers.id, goodsReceipts.supplierId))
    .where(and(eq(goodsReceipts.id, receiptId), eq(goodsReceipts.organizationId, ctx.organizationId), inArray(goodsReceipts.siteId, ctx.allowedSiteIds)))
    .limit(1);
  if (!row) throw new DomainError("not_found", "Receipt not found in your sites.");
  ctx.requireSite(row.receipt.siteId);
  const gr = row.receipt;

  const lineRows = await db
    .select({
      line: goodsReceiptLines,
      materialCode: materials.code,
      materialName: materials.name,
      baseUom: materials.baseUom,
      storageConditions: materials.storageConditions,
      requiresCoa: materials.requiresCoa,
      locationCode: locations.code,
      locationName: locations.name,
      locationKind: locations.kind,
      lotNumber: inventoryLots.lotNumber,
      lotStatus: inventoryLots.qualityStatus,
      recordedByName: recorder.displayName,
      approvedByName: approver.displayName,
    })
    .from(goodsReceiptLines)
    .innerJoin(materials, eq(materials.id, goodsReceiptLines.materialId))
    .innerJoin(locations, eq(locations.id, goodsReceiptLines.locationId))
    .leftJoin(inventoryLots, eq(inventoryLots.id, goodsReceiptLines.lotId))
    .leftJoin(recorder, eq(recorder.id, goodsReceiptLines.discrepancyRecordedBy))
    .leftJoin(approver, eq(approver.id, goodsReceiptLines.discrepancyApprovedBy))
    .where(eq(goodsReceiptLines.goodsReceiptId, gr.id))
    .orderBy(asc(goodsReceiptLines.lineNo), asc(goodsReceiptLines.createdAt));

  const lineIds = lineRows.map((l) => l.line.id);
  const files = await db
    .select({
      id: fileAttachments.id,
      entityType: fileAttachments.entityType,
      entityId: fileAttachments.entityId,
      fileName: fileAttachments.fileName,
      contentType: fileAttachments.contentType,
      sizeBytes: fileAttachments.sizeBytes,
      attachmentKind: fileAttachments.attachmentKind,
      createdAt: fileAttachments.createdAt,
      uploadedBy: users.displayName,
      documentKind: supplierLotDocuments.documentKind,
      documentNumber: supplierLotDocuments.documentNumber,
    })
    .from(fileAttachments)
    .innerJoin(users, eq(users.id, fileAttachments.createdBy))
    .leftJoin(supplierLotDocuments, eq(supplierLotDocuments.fileAttachmentId, fileAttachments.id))
    .where(
      and(
        isNull(fileAttachments.deletedAt),
        or(
          and(eq(fileAttachments.entityType, "goods_receipt"), eq(fileAttachments.entityId, gr.id)),
          lineIds.length ? and(eq(fileAttachments.entityType, "goods_receipt_line"), inArray(fileAttachments.entityId, lineIds)) : sql`false`,
        ),
      ),
    )
    .orderBy(asc(fileAttachments.createdAt));

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
  const isReceiver = gr.receivedBy === ctx.userId || gr.createdBy === ctx.userId;
  const lines = lineRows.map((r) => {
    const l = r.line;
    const docs = files.filter((f) => f.entityType === "goods_receipt_line" && f.entityId === l.id);
    const hasCoa = docs.some((d) => d.documentKind === "coa");
    const flags: string[] = [];
    if (l.expiresOn && l.expiresOn <= today) flags.push(l.discrepancyKind ? "Expired or expiring today: reject candidate for QA." : "Expired or expiring today: record a discrepancy before posting.");
    if (r.requiresCoa && !hasCoa) flags.push(gr.status === "draft" ? "CoA required: attach it before posting, or the lot will be flagged and cannot be released." : "CoA missing: QA cannot release this lot until it is attached.");
    if (r.storageConditions && !l.storageConditionsConfirmed) flags.push(`Storage conditions not confirmed (${r.storageConditions}).`);
    if (l.discrepancyKind && !l.discrepancyApprovedBy) flags.push(`${DISCREPANCY_LABELS[l.discrepancyKind as DiscrepancyKind]} awaiting procurement approval.`);
    return {
      ...l,
      materialCode: r.materialCode,
      materialName: r.materialName,
      baseUom: r.baseUom,
      storageConditions: r.storageConditions,
      requiresCoa: r.requiresCoa,
      locationCode: r.locationCode,
      locationName: r.locationName,
      locationKind: r.locationKind,
      lotNumber: r.lotNumber,
      lotStatus: r.lotStatus,
      recordedByName: r.recordedByName,
      approvedByName: r.approvedByName,
      discrepancyLabel: l.discrepancyKind ? DISCREPANCY_LABELS[l.discrepancyKind as DiscrepancyKind] : null,
      documents: docs,
      hasCoa,
      flags,
    };
  });

  const supplierBlocked = row.supplierQualityStatus === "suspended";
  return {
    ...gr,
    receivedByName: row.receivedByName,
    postedByName: row.postedByName,
    reversedByName: row.reversedByName,
    supplier: gr.supplierId ? { id: gr.supplierId, code: row.supplierCode, qualityStatus: row.supplierQualityStatus, reason: row.supplierQualityReason, isActive: row.supplierActive } : null,
    supplierBlocked,
    reasonLabel: UNPLANNED_REASON_CODES.find((r) => r.code === gr.unplannedReasonCode)?.label ?? gr.unplannedReasonCode,
    lines,
    headerDocuments: files.filter((f) => f.entityType === "goods_receipt"),
    can: {
      edit: gr.status === "draft" && ctx.can("procurement.goods_receipt.create"),
      post: gr.status === "draft" && ctx.can("procurement.goods_receipt.post"),
      cancel: gr.status === "draft" && ctx.can("procurement.goods_receipt.create"),
      reverse: gr.status === "posted" && ctx.can("procurement.goods_receipt.void"),
      recordDiscrepancy: (gr.status === "draft" || gr.status === "posted") && ctx.can("procurement.goods_receipt.create"),
      approveDiscrepancy: (gr.status === "draft" || gr.status === "posted") && ctx.can("procurement.receipt_discrepancy.approve"),
      isReceiver,
      linkSupplier: !gr.supplierId && gr.status !== "cancelled" && ctx.can("procurement.receipt_discrepancy.approve"),
      upload: (gr.status === "draft" || gr.status === "posted") && ctx.can("documents.file_attachment.create") && ctx.can("procurement.supplier_lot_document.create"),
      voidFile: ctx.can("documents.file_attachment.void"),
      printLabels: gr.status === "posted" && ctx.can("inventory.label.print"),
    },
  };
}

export type ReceiptDocument = Awaited<ReturnType<typeof getReceiptDocument>>;

export type ReceiptFilter = { status?: string; q?: string; openDiscrepancies?: boolean };

/** Receipts of the current site, newest first (drafts, posted, reversed, cancelled). */
export async function listReceipts(ctx: AuthContext, f: ReceiptFilter = {}) {
  ctx.require("procurement.goods_receipt.view");
  ctx.requireSite(ctx.currentSiteId);
  const conds: SQL[] = [eq(goodsReceipts.siteId, ctx.currentSiteId)];
  if (f.status && ["draft", "posted", "cancelled", "reversed"].includes(f.status)) conds.push(eq(goodsReceipts.status, f.status));
  const q = f.q?.trim();
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, (c) => "\\" + c)}%`;
    conds.push(or(ilike(goodsReceipts.receiptNumber, like), ilike(goodsReceipts.supplierName, like), ilike(goodsReceipts.supplierDocumentNumber, like))!);
  }
  const openDisc = sql<number>`count(${goodsReceiptLines.id}) filter (where ${goodsReceiptLines.discrepancyKind} is not null and ${goodsReceiptLines.discrepancyApprovedBy} is null)::int`;
  const rows = await db
    .select({
      id: goodsReceipts.id,
      receiptNumber: goodsReceipts.receiptNumber,
      status: goodsReceipts.status,
      supplierName: goodsReceipts.supplierName,
      supplierId: goodsReceipts.supplierId,
      supplierDocumentNumber: goodsReceipts.supplierDocumentNumber,
      receivedAt: goodsReceipts.receivedAt,
      postedAt: goodsReceipts.postedAt,
      receivedByName: users.displayName,
      lineCount: sql<number>`count(${goodsReceiptLines.id})::int`,
      openDiscrepancies: openDisc,
      documentsMissing: sql<number>`count(${goodsReceiptLines.id}) filter (where ${goodsReceiptLines.documentMissing})::int`,
    })
    .from(goodsReceipts)
    .innerJoin(users, eq(users.id, goodsReceipts.receivedBy))
    .leftJoin(goodsReceiptLines, eq(goodsReceiptLines.goodsReceiptId, goodsReceipts.id))
    .where(and(...conds))
    .groupBy(goodsReceipts.id, users.displayName)
    .having(f.openDiscrepancies ? sql`${openDisc} > 0` : undefined)
    .orderBy(desc(goodsReceipts.receivedAt))
    .limit(200);
  return rows;
}

/** CSV of the site's receipts (procurement.goods_receipt.export); writes platform.export.created. */
export async function exportReceiptsCsv(ctx: AuthContext, f: ReceiptFilter = {}) {
  ctx.require("procurement.goods_receipt.export");
  const rows = await listReceipts(ctx, f);
  const csv = toCsv(
    ["Receipt", "Status", "Supplier", "Supplier document", "Received at", "Received by", "Lines", "Open discrepancies", "Documents missing"],
    rows.map((r) => [r.receiptNumber ?? "Draft", r.status, r.supplierName, r.supplierDocumentNumber, r.receivedAt, r.receivedByName, r.lineCount, r.openDiscrepancies, r.documentsMissing]),
  );
  await audit(db, ctx, { action: "platform.export.created", entityType: "export", siteId: ctx.currentSiteId, after: { kind: "goods_receipts", rows: rows.length, filter: f, siteId: ctx.currentSiteId } });
  return { csv, fileName: `goods-receipts-${ctx.currentSite.code}-${new Date().toISOString().slice(0, 10)}.csv`, rows: rows.length };
}

/**
 * Reasons from receiving and holds that stop QA from releasing a lot (W01 exception paths, US-2-07 AC2,
 * US-2-08 AC2, US-2-10 AC3). Empty array = nothing from receiving blocks release. Quality rules (expiry,
 * state, separation of duties) are checked by the quality module.
 */
export async function lotReleaseBlockers(q: Q, lotId: string): Promise<string[]> {
  const out: string[] = [];
  const [r] = await q
    .select({ line: goodsReceiptLines, receipt: goodsReceipts, requiresCoa: materials.requiresCoa })
    .from(goodsReceiptLines)
    .innerJoin(goodsReceipts, eq(goodsReceipts.id, goodsReceiptLines.goodsReceiptId))
    .innerJoin(materials, eq(materials.id, goodsReceiptLines.materialId))
    .where(eq(goodsReceiptLines.lotId, lotId))
    .limit(1);
  if (r) {
    const label = r.receipt.receiptNumber ?? "the receipt";
    if (r.receipt.status === "reversed") out.push(`Receipt ${label} was reversed; this lot has no received stock.`);
    if (!r.receipt.supplierId) out.push(`Receipt ${label} names a supplier that is not in the supplier list ("${r.receipt.supplierName}"); procurement must link it first.`);
    if (r.line.discrepancyKind && !r.line.discrepancyApprovedBy) {
      out.push(`${DISCREPANCY_LABELS[r.line.discrepancyKind as DiscrepancyKind]} recorded on receipt ${label} line ${r.line.lineNo ?? ""} is not yet approved by procurement.`.replace(" line  is", " is"));
    }
    if (r.requiresCoa) {
      const [coa] = await q
        .select({ id: supplierLotDocuments.id })
        .from(supplierLotDocuments)
        .innerJoin(fileAttachments, eq(fileAttachments.id, supplierLotDocuments.fileAttachmentId))
        .where(and(eq(supplierLotDocuments.goodsReceiptLineId, r.line.id), eq(supplierLotDocuments.documentKind, "coa"), isNull(fileAttachments.deletedAt)))
        .limit(1);
      if (!coa) out.push("This material requires a supplier CoA and none is attached to the lot.");
    }
  }
  const holds = await openHoldsForLot(q, lotId);
  for (const h of holds) out.push(`The lot is under QA hold ${h.holdNumber}; lift the hold to release it.`);
  return out;
}

/** Open quality holds that name the lot directly or put it on hold through a location hold. */
export async function openHoldsForLot(q: Q, lotId: string) {
  return q
    .selectDistinct({ id: qualityHolds.id, holdNumber: qualityHolds.holdNumber })
    .from(qualityHolds)
    .leftJoin(qualityHoldLots, eq(qualityHoldLots.qualityHoldId, qualityHolds.id))
    .where(and(inArray(qualityHolds.status, ["open", "investigating"]), or(eq(qualityHolds.lotId, lotId), eq(qualityHoldLots.lotId, lotId))));
}
