import "server-only";
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import { goodsReceipts, importJobs, inventoryLots, legacyDocuments, locations, openingBalanceLines, products, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { UUID_RE } from "./files";

/**
 * Legacy document index and opening-receipt history of a lot (US-2-26, MC-12, A-PRD-30, A-DM-09).
 * Read: documents.legacy_document.view at the document's site (QA name is personal data). Verify:
 * documents.legacy_document.approve by a second person (never the indexer; also a database check).
 */
const indexer = alias(users, "ldoc_indexer");
const verifier = alias(users, "ldoc_verifier");

const DOC_FIELDS = {
  id: legacyDocuments.id,
  documentNumber: legacyDocuments.documentNumber,
  legacyKind: legacyDocuments.legacyKind,
  legacyNumber: legacyDocuments.legacyNumber,
  productCode: products.skuCode,
  productName: products.name,
  formulaNumber: legacyDocuments.formulaNumber,
  batchSizeQty: legacyDocuments.batchSizeQty,
  startDate: legacyDocuments.startDate,
  endDate: legacyDocuments.endDate,
  expiryDate: legacyDocuments.expiryDate,
  disposition: legacyDocuments.disposition,
  qaName: legacyDocuments.qaName,
  remarks: legacyDocuments.remarks,
  fileAttachmentId: legacyDocuments.fileAttachmentId,
  siteId: legacyDocuments.siteId,
  indexedBy: legacyDocuments.indexedBy,
  indexedByName: indexer.displayName,
  indexedAt: legacyDocuments.indexedAt,
  verifiedByName: verifier.displayName,
  verifiedAt: legacyDocuments.verifiedAt,
  importJobId: legacyDocuments.importJobId,
};

function docsQuery() {
  return db.select(DOC_FIELDS).from(legacyDocuments).leftJoin(products, eq(products.id, legacyDocuments.productId)).innerJoin(indexer, eq(indexer.id, legacyDocuments.indexedBy)).leftJoin(verifier, eq(verifier.id, legacyDocuments.verifiedBy));
}

const siteScope = (ctx: AuthContext) => or(isNull(legacyDocuments.siteId), inArray(legacyDocuments.siteId, ctx.allowedSiteIds));

export type LegacyDocumentRow = Awaited<ReturnType<typeof searchLegacyDocuments>>[number];

/** Search by legacy number, document number or product (legacy numbers are what staff know, R-17). */
export async function searchLegacyDocuments(ctx: AuthContext, f: { q?: string; limit?: number } = {}) {
  ctx.require("documents.legacy_document.view");
  const q = f.q?.trim();
  const like = q ? `%${q.replace(/[%_\\]/g, (c) => "\\" + c)}%` : null;
  return docsQuery()
    .where(and(eq(legacyDocuments.organizationId, ctx.organizationId), isNull(legacyDocuments.voidedAt), siteScope(ctx), like ? or(ilike(legacyDocuments.legacyNumber, like), ilike(legacyDocuments.documentNumber, like), ilike(products.skuCode, like), ilike(products.name, like)) : undefined))
    .orderBy(desc(legacyDocuments.indexedAt))
    .limit(Math.min(f.limit ?? 100, 500));
}

/**
 * What the lot page shows for a migrated lot: the opening receipt line(s) (count sheet, counter and
 * checker, initial status and hold reason) and the legacy documents with the lot's legacy number.
 */
export async function lotMigrationHistory(ctx: AuthContext, lotId: string) {
  ctx.require("inventory.lot.view");
  if (!UUID_RE.test(lotId)) throw new DomainError("not_found", "Lot not found in your sites.");
  const [lot] = await db.select({ id: inventoryLots.id, siteId: inventoryLots.siteId, legacyNumber: inventoryLots.legacyNumber, organizationId: inventoryLots.organizationId }).from(inventoryLots).where(eq(inventoryLots.id, lotId)).limit(1);
  if (!lot || lot.organizationId !== ctx.organizationId || !ctx.allowedSiteIds.includes(lot.siteId)) throw new DomainError("not_found", "Lot not found in your sites.");
  const opening = ctx.can("procurement.goods_receipt.view")
    ? await db
        .select({
          receiptId: goodsReceipts.id,
          receiptNumber: goodsReceipts.receiptNumber,
          receiptStatus: goodsReceipts.status,
          postedAt: goodsReceipts.postedAt,
          importJobId: openingBalanceLines.importJobId,
          importNumber: importJobs.importNumber,
          lineNo: openingBalanceLines.lineNo,
          location: locations.code,
          qtyEntered: openingBalanceLines.qtyEntered,
          uomEntered: openingBalanceLines.uomEntered,
          qtyBase: openingBalanceLines.qtyBase,
          baseUom: openingBalanceLines.baseUom,
          countSheetRef: openingBalanceLines.countSheetRef,
          countedBy: openingBalanceLines.countedBy,
          checkedBy: openingBalanceLines.checkedBy,
          initialQualityStatus: openingBalanceLines.initialQualityStatus,
          holdReasonCode: openingBalanceLines.holdReasonCode,
          holdReasonNote: openingBalanceLines.holdReasonNote,
          qualityStatusClaimed: openingBalanceLines.qualityStatusClaimed,
          containerCount: openingBalanceLines.containerCount,
          reversed: sql<boolean>`${openingBalanceLines.reversalMovementId} is not null`,
        })
        .from(openingBalanceLines)
        .innerJoin(goodsReceipts, eq(goodsReceipts.id, openingBalanceLines.goodsReceiptId))
        .innerJoin(importJobs, eq(importJobs.id, openingBalanceLines.importJobId))
        .innerJoin(locations, eq(locations.id, openingBalanceLines.locationId))
        .where(eq(openingBalanceLines.lotId, lot.id))
        .orderBy(asc(openingBalanceLines.lineNo))
    : [];
  const canDocs = ctx.can("documents.legacy_document.view");
  const documents =
    canDocs && lot.legacyNumber
      ? await docsQuery()
          .where(and(eq(legacyDocuments.organizationId, ctx.organizationId), isNull(legacyDocuments.voidedAt), siteScope(ctx), sql`upper(${legacyDocuments.legacyNumber}) = upper(${lot.legacyNumber})`))
          .orderBy(asc(legacyDocuments.documentNumber))
      : [];
  return { legacyNumber: lot.legacyNumber, opening, documents, canSeeDocuments: canDocs, canVerify: ctx.can("documents.legacy_document.approve") };
}

/** Second-person check of the index fields against the scan (data-model §3.10 `verified_by <> indexed_by`). */
export async function verifyLegacyDocument(ctx: AuthContext, documentId: string, note?: string | null) {
  ctx.require("documents.legacy_document.approve");
  if (!UUID_RE.test(documentId)) throw new DomainError("not_found", "Document not found in your sites.");
  return db.transaction(async (tx) => {
    const [d] = await tx.select().from(legacyDocuments).where(and(eq(legacyDocuments.id, documentId), eq(legacyDocuments.organizationId, ctx.organizationId))).for("update").limit(1);
    if (!d || (d.siteId && !ctx.allowedSiteIds.includes(d.siteId))) throw new DomainError("not_found", "Document not found in your sites.");
    if (d.siteId) ctx.requireAt("documents.legacy_document.approve", d.siteId);
    if (d.voidedAt) throw new DomainError("state", `${d.documentNumber} is void.`);
    if (d.verifiedAt) throw new DomainError("state", `${d.documentNumber} is already verified.`);
    ctx.assertSeparation(d.indexedBy === ctx.userId, "You indexed this document, so a different person must verify it against the scan.");
    const now = new Date();
    await tx.update(legacyDocuments).set({ verifiedBy: ctx.userId, verifiedAt: now }).where(eq(legacyDocuments.id, d.id));
    await audit(tx, ctx, { action: "documents.legacy_document.verified", entityType: "legacy_document", entityId: d.id, entityNumber: d.documentNumber, siteId: d.siteId, reason: note?.trim() || null, before: { verified: false }, after: { verified: true, legacyNumber: d.legacyNumber } });
    return { documentId: d.id };
  });
}
