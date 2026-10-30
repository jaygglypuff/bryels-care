import "server-only";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { uuidv7 } from "uuidv7";
import { db, type Tx } from "@/db/client";
import {
  dispositions,
  fileAttachments,
  goodsReceiptLines,
  goodsReceipts,
  inventoryLots,
  locations,
  materials,
  supplierLotDocuments,
  suppliers,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { nextNumber } from "@/lib/numbering";
import { assertReasonCode, findConversionStep, toBasePair } from "@/modules/masterdata";
import { postMovement } from "./ledger";
import { isUuid } from "./lots";
import { receivingPoHooks, type PoReceiptLine } from "./receiving-po";
import {
  DEFAULT_UNPLANNED_REASON,
  DISCREPANCY_BLOCKS_POSTING,
  DISCREPANCY_KINDS,
  DISCREPANCY_LABELS,
  assertReceiptTransition,
  receiptLocationKinds,
  type DiscrepancyKind,
} from "./receiving-state";

// Read side lives in receiving-queries.ts; re-exported here for existing callers (receipt and label pages).
export { getReceipt, receivingFormData, getReceiptDocument, listReceipts, exportReceiptsCsv, lotReleaseBlockers, type ReceiptDocument } from "./receiving-queries";

/* ------------------------------------------------------------------ inputs */

export type ReceiptLineInput = {
  /** Existing draft line when editing a draft; omitted for new lines. */
  lineId?: string | null;
  materialId: string;
  qty: string;
  /** Unit as entered; defaults to the material's base unit (V-UOM). */
  uom?: string | null;
  supplierLotNumber: string;
  /** ADR-076: brand on the delivered containers (optional; copied to the lot at posting). */
  brand?: string | null;
  manufacturedOn?: string | null;
  expiresOn: string;
  retestOn?: string | null;
  containerCount?: number | null;
  storageConditionsConfirmed?: boolean;
  locationId: string;
  discrepancyKind?: DiscrepancyKind | null;
  discrepancyNote?: string | null;
  /** W4A (US-6-03): the PO line received; on an edit, omitted = keep the draft line's PO line. */
  purchaseOrderLineId?: string | null;
};

export type ReceiptHeaderInput = {
  /** A supplier from the supplier list, or a typed name (matched by name or code; unknown names stay unlinked). */
  supplierId?: string | null;
  supplierName?: string | null;
  supplierDocumentNumber: string;
  unplannedReasonCode?: string | null;
  notes?: string | null;
  lines: ReceiptLineInput[];
  /** W4A (US-6-03): receive against this purchase order (receipt_kind purchase_order, no unplanned reason). */
  purchaseOrderId?: string | null;
};

export type ReceiptDraftInput = ReceiptHeaderInput & { idempotencyKey: string };

/** MVP one-step input kept for the original receive form and tests (supplier as typed text). */
export type ReceiptInput = ReceiptDraftInput;

/* ------------------------------------------------------------------ helpers */

export function manilaToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
}

const MIN_NOTE = 5;

function cleanText(v: string | null | undefined, max: number, field: string, label: string): string | null {
  const t = (v ?? "").trim();
  if (!t) return null;
  if (t.length > max) throw new DomainError("validation", `${label} is too long (max ${max} characters).`, { field });
  return t;
}

function requireReason(v: string | null | undefined, field = "reason"): string {
  const r = (v ?? "").trim();
  if (r.length < MIN_NOTE) throw new DomainError("validation", `Give a reason of at least ${MIN_NOTE} characters.`, { field });
  if (r.length > 1000) throw new DomainError("validation", "Reason is too long (max 1,000 characters).", { field });
  return r;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function optDate(v: string | null | undefined, field: string, label: string): string | null {
  if (!v) return null;
  if (!DATE_RE.test(v) || Number.isNaN(Date.parse(v + "T00:00:00Z"))) throw new DomainError("validation", `${label}: use a valid date.`, { field });
  return v;
}

/** Resolves the supplier named on a receipt. Unknown typed names stay unlinked (procurement links them later). */
async function resolveSupplier(tx: Tx, ctx: AuthContext, input: Pick<ReceiptHeaderInput, "supplierId" | "supplierName">) {
  if (input.supplierId) {
    if (!isUuid(input.supplierId)) throw new DomainError("validation", "Choose a supplier from the list.", { field: "supplierId" });
    const [s] = await tx
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.id, input.supplierId), eq(suppliers.organizationId, ctx.organizationId)))
      .limit(1);
    if (!s) throw new DomainError("validation", "Choose a supplier from the list.", { field: "supplierId" });
    if (!s.isActive) throw new DomainError("validation", `Supplier ${s.name} is inactive. Ask procurement to reactivate it or choose another supplier.`, { field: "supplierId" });
    return { supplier: s, supplierName: s.name };
  }
  const name = (input.supplierName ?? "").trim();
  if (name.length < 2) throw new DomainError("validation", "Enter the supplier name.", { field: "supplierName" });
  if (name.length > 200) throw new DomainError("validation", "Supplier name is too long (max 200 characters).", { field: "supplierName" });
  const [s] = await tx
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.organizationId, ctx.organizationId), or(sql`lower(${suppliers.name}) = lower(${name})`, sql`lower(${suppliers.code}) = lower(${name})`)))
    .limit(1);
  if (s && !s.isActive) throw new DomainError("validation", `Supplier ${s.name} is inactive. Ask procurement to reactivate it or choose another supplier.`, { field: "supplierName" });
  return { supplier: s ?? null, supplierName: s?.name ?? name };
}

type MaterialRow = typeof materials.$inferSelect;
type LocationRow = typeof locations.$inferSelect;

export type NormalizedLine = {
  index: number;
  lineId: string | null;
  mat: MaterialRow;
  loc: LocationRow;
  qtyEntered: Decimal;
  uomEntered: string;
  qtyBase: Decimal;
  supplierLotNumber: string;
  brand: string | null;
  manufacturedOn: string | null;
  expiresOn: string;
  retestOn: string | null;
  containerCount: number | null;
  storageConditionsConfirmed: boolean;
  initialQualityStatus: "quarantine" | "released";
  discrepancyKind: DiscrepancyKind | null;
  discrepancyNote: string | null;
  purchaseOrderLineId: string | null | undefined;
};

/** Field-level validation of receipt lines (V-UOM, dates, location of the receipt's site). */
async function normalizeLines(tx: Tx, ctx: AuthContext, siteId: string, lines: ReceiptLineInput[]): Promise<NormalizedLine[]> {
  if (!Array.isArray(lines) || lines.length === 0) throw new DomainError("validation", "Add at least one line.", { field: "lines" });
  if (lines.length > 50) throw new DomainError("validation", "A receipt can have at most 50 lines.", { field: "lines" });
  const today = manilaToday();
  const matIds = [...new Set(lines.map((l) => l.materialId).filter((x) => isUuid(String(x ?? ""))))];
  const locIds = [...new Set(lines.map((l) => l.locationId).filter((x) => isUuid(String(x ?? ""))))];
  const mats = matIds.length ? await tx.select().from(materials).where(and(eq(materials.organizationId, ctx.organizationId), inArray(materials.id, matIds))) : [];
  const locs = locIds.length ? await tx.select().from(locations).where(and(eq(locations.siteId, siteId), inArray(locations.id, locIds))) : [];

  // Approved conversion steps for every entered unit (W2G UOM service), looked up before validating the lines.
  const steps = new Map<string, Awaited<ReturnType<typeof findConversionStep>>>();
  for (const l of lines) {
    const mat = mats.find((m) => m.id === l.materialId);
    const uom = (l.uom || mat?.baseUom || "").trim();
    if (!mat || !uom || uom === mat.baseUom || steps.has(`${mat.id}|${uom}`)) continue;
    steps.set(`${mat.id}|${uom}`, await findConversionStep(tx, ctx.organizationId, uom, mat.baseUom, mat.id));
  }
  return lines.map((l, i) => {
    const n = i + 1;
    const f = (k: string) => `lines.${i}.${k}`;
    const mat = mats.find((m) => m.id === l.materialId);
    if (!mat) throw new DomainError("validation", `Line ${n}: choose a material.`, { field: f("materialId") });
    // W2G (US-1-23): only an active material is received; draft, blocked and discontinued ones are refused.
    if (mat.status !== "active") throw new DomainError("validation", `Line ${n}: ${mat.name} is ${mat.status} in master data and cannot be received.`, { field: f("materialId") });
    const initialQualityStatus = mat.requiresIncomingInspection ? "quarantine" : "released";
    const loc = locs.find((x) => x.id === l.locationId);
    const kinds = receiptLocationKinds(initialQualityStatus);
    if (!loc || !loc.isActive || !kinds.includes(loc.kind)) {
      throw new DomainError("validation", `Line ${n}: choose an active ${kinds.join(", ")} location of this site.`, { field: f("locationId") });
    }
    let qtyEntered: Decimal;
    try {
      qtyEntered = new Decimal(String(l.qty ?? "").trim());
    } catch {
      throw new DomainError("validation", `Line ${n}: enter a quantity like 25000 or 12.5.`, { field: f("qty") });
    }
    if (!qtyEntered.isFinite() || qtyEntered.lte(0)) throw new DomainError("validation", `Line ${n}: quantity must be greater than zero.`, { field: f("qty") });
    if (qtyEntered.decimalPlaces() > 6) throw new DomainError("validation", `Line ${n}: use at most 6 decimal places.`, { field: f("qty") });
    const uomEntered = (l.uom || mat.baseUom).trim();
    // V-UOM through the approved conversions of the UOM service (W2G, US-1-21), incl. the material's own pack units.
    const pair = toBasePair({ qty: qtyEntered.toString(), uom: uomEntered }, mat.baseUom, steps.get(`${mat.id}|${uomEntered}`) ?? null);
    if (!pair) throw new DomainError("validation", `Line ${n}: ${uomEntered} cannot be converted to ${mat.name}'s base unit ${mat.baseUom}.`, { field: f("uom") });
    const qtyBase = new Decimal(pair.base.qty);
    if (mat.baseUom === "pcs" && !qtyBase.isInteger()) throw new DomainError("validation", `Line ${n}: ${mat.name} is counted in pieces; enter a whole number.`, { field: f("qty") });
    if (qtyBase.decimalPlaces() > 6) throw new DomainError("validation", `Line ${n}: the quantity is finer than 0.000001 ${mat.baseUom}.`, { field: f("qty") });
    const supplierLotNumber = (l.supplierLotNumber ?? "").trim();
    if (!supplierLotNumber) throw new DomainError("validation", `Line ${n}: enter the supplier's lot number from the container label.`, { field: f("supplierLotNumber") });
    if (supplierLotNumber.length > 80) throw new DomainError("validation", `Line ${n}: supplier lot number is too long (max 80).`, { field: f("supplierLotNumber") });
    const brand = cleanText(l.brand, 80, f("brand"), `Line ${n} brand`);
    const manufacturedOn = optDate(l.manufacturedOn, f("manufacturedOn"), `Line ${n} manufacture date`);
    const expiresOn = optDate(l.expiresOn, f("expiresOn"), `Line ${n} expiry date`);
    if (!expiresOn) throw new DomainError("validation", `Line ${n}: enter the expiry date.`, { field: f("expiresOn") });
    const retestOn = optDate(l.retestOn, f("retestOn"), `Line ${n} retest date`);
    if (manufacturedOn && manufacturedOn > today) throw new DomainError("validation", `Line ${n}: the manufacture date cannot be in the future.`, { field: f("manufacturedOn") });
    if (manufacturedOn && expiresOn <= manufacturedOn) throw new DomainError("validation", `Line ${n}: the expiry date must be after the manufacture date.`, { field: f("expiresOn") });
    if (retestOn && retestOn > expiresOn) throw new DomainError("validation", `Line ${n}: the retest date cannot be after the expiry date.`, { field: f("retestOn") });
    let containerCount: number | null = null;
    if (l.containerCount !== null && l.containerCount !== undefined && String(l.containerCount) !== "") {
      containerCount = Number(l.containerCount);
      if (!Number.isInteger(containerCount) || containerCount < 1 || containerCount > 10_000) {
        throw new DomainError("validation", `Line ${n}: container count must be a whole number from 1 to 10,000.`, { field: f("containerCount") });
      }
    }
    let discrepancyKind: DiscrepancyKind | null = null;
    let discrepancyNote: string | null = null;
    if (l.discrepancyKind) {
      if (!(DISCREPANCY_KINDS as readonly string[]).includes(l.discrepancyKind)) throw new DomainError("validation", `Line ${n}: choose a discrepancy type.`, { field: f("discrepancyKind") });
      discrepancyKind = l.discrepancyKind;
      discrepancyNote = (l.discrepancyNote ?? "").trim();
      if (discrepancyNote.length < MIN_NOTE) throw new DomainError("validation", `Line ${n}: describe the discrepancy (at least ${MIN_NOTE} characters).`, { field: f("discrepancyNote") });
      if (discrepancyNote.length > 1000) throw new DomainError("validation", `Line ${n}: discrepancy note is too long (max 1,000).`, { field: f("discrepancyNote") });
    }
    return {
      index: i,
      lineId: l.lineId ?? null,
      mat,
      loc,
      qtyEntered,
      uomEntered,
      qtyBase,
      supplierLotNumber,
      brand,
      manufacturedOn,
      expiresOn,
      retestOn,
      containerCount,
      storageConditionsConfirmed: !!l.storageConditionsConfirmed,
      initialQualityStatus,
      discrepancyKind,
      discrepancyNote,
      purchaseOrderLineId: l.purchaseOrderLineId === undefined ? undefined : l.purchaseOrderLineId || null,
    };
  });
}

function lineValues(l: NormalizedLine) {
  return {
    materialId: l.mat.id,
    qtyEntered: l.qtyEntered.toString(),
    uomEntered: l.uomEntered,
    qtyBase: l.qtyBase.toString(),
    locationId: l.loc.id,
    supplierLotNumber: l.supplierLotNumber,
    brand: l.brand,
    manufacturedOn: l.manufacturedOn,
    expiresOn: l.expiresOn,
    retestOn: l.retestOn,
    containerCount: l.containerCount,
    storageConditionsConfirmed: l.storageConditionsConfirmed,
    initialQualityStatus: l.initialQualityStatus,
  };
}

/** Why the delivery has no PO: a shared reason code of category `receipt` (US-1-24); "other" needs the notes. */
async function headerReason(tx: Tx, ctx: AuthContext, input: ReceiptHeaderInput) {
  const code = (input.unplannedReasonCode || DEFAULT_UNPLANNED_REASON).trim();
  try {
    return (await assertReasonCode(tx, ctx.organizationId, "receipt", code, input.notes)).code;
  } catch (e) {
    if (e instanceof DomainError && e.details?.field === "reasonNote") throw new DomainError("validation", e.message, { field: "notes" });
    if (e instanceof DomainError) throw new DomainError("validation", "Choose why this delivery has no purchase order.", { field: "unplannedReasonCode" });
    throw e;
  }
}

function headerDocNo(input: ReceiptHeaderInput) {
  const v = (input.supplierDocumentNumber ?? "").trim();
  if (!v) throw new DomainError("validation", "Enter the delivery document number (DR / invoice).", { field: "supplierDocumentNumber" });
  if (v.length > 80) throw new DomainError("validation", "Delivery document number is too long (max 80).", { field: "supplierDocumentNumber" });
  return v;
}

async function lockReceipt(tx: Tx, ctx: AuthContext, receiptId: string) {
  if (!isUuid(receiptId)) throw new DomainError("not_found", "Receipt not found in your sites.");
  const [gr] = await tx
    .select()
    .from(goodsReceipts)
    .where(and(eq(goodsReceipts.id, receiptId), eq(goodsReceipts.organizationId, ctx.organizationId)))
    .for("update")
    .limit(1);
  if (!gr || !ctx.allowedSiteIds.includes(gr.siteId)) throw new DomainError("not_found", "Receipt not found in your sites.");
  ctx.requireSite(gr.siteId);
  return gr;
}

const receiptLabel = (gr: { receiptNumber: string | null; id: string }) => gr.receiptNumber ?? `draft ${gr.id.slice(-8)}`;

/* ------------------------------------------------------------------ create / edit draft */

/** W4A: a PO receipt takes its supplier from the PO and needs no unplanned reason (the PO is the reason). */
async function poHeader(tx: Tx, ctx: AuthContext, siteId: string, purchaseOrderId: string, lines: NormalizedLine[]) {
  if (!isUuid(purchaseOrderId)) throw new DomainError("validation", "Choose a purchase order.", { field: "purchaseOrderId" });
  const po = await receivingPoHooks().validateDraft(tx, ctx, {
    purchaseOrderId,
    siteId,
    lines: lines.map((l) => ({ index: l.index, purchaseOrderLineId: l.purchaseOrderLineId ?? null, materialId: l.mat.id })),
  });
  return { supplierId: po.supplierId, supplierName: po.supplierName };
}

async function insertDraft(tx: Tx, ctx: AuthContext, input: ReceiptDraftInput) {
  const siteId = ctx.currentSiteId;
  const supplierDocumentNumber = headerDocNo(input);
  const notes = cleanText(input.notes, 1000, "notes", "Notes");
  const lines = await normalizeLines(tx, ctx, siteId, input.lines);
  const poId = input.purchaseOrderId || null;
  const { supplier, supplierName } = poId
    ? await (async () => {
        const h = await poHeader(tx, ctx, siteId, poId, lines);
        return { supplier: { id: h.supplierId }, supplierName: h.supplierName };
      })()
    : await resolveSupplier(tx, ctx, input);
  const unplannedReasonCode = poId ? null : await headerReason(tx, ctx, input);

  const [gr] = await tx
    .insert(goodsReceipts)
    .values({
      organizationId: ctx.organizationId,
      siteId,
      receiptKind: poId ? "purchase_order" : "unplanned",
      purchaseOrderId: poId,
      status: "draft",
      supplierId: supplier?.id ?? null,
      supplierName,
      supplierDocumentNumber,
      unplannedReasonCode,
      receivedBy: ctx.userId,
      notes,
      idempotencyKey: input.idempotencyKey,
      createdBy: ctx.userId,
    })
    .returning();
  const now = new Date();
  for (const l of lines) {
    await tx.insert(goodsReceiptLines).values({
      goodsReceiptId: gr.id,
      lineNo: l.index + 1,
      ...lineValues(l),
      purchaseOrderLineId: poId ? (l.purchaseOrderLineId ?? null) : null,
      discrepancyKind: l.discrepancyKind,
      discrepancyNote: l.discrepancyNote,
      discrepancyRecordedBy: l.discrepancyKind ? ctx.userId : null,
      discrepancyRecordedAt: l.discrepancyKind ? now : null,
      createdBy: ctx.userId,
    });
  }
  await audit(tx, ctx, {
    action: "procurement.goods_receipt.created",
    entityType: "goods_receipt",
    entityId: gr.id,
    siteId,
    after: {
      supplierName,
      supplierId: supplier?.id ?? null,
      supplierDocumentNumber,
      unplannedReasonCode,
      purchaseOrderId: poId,
      lines: lines.map((l) => ({ material: l.mat.code, qtyEntered: l.qtyEntered.toString(), uom: l.uomEntered, qtyBase: l.qtyBase.toString(), location: l.loc.code, purchaseOrderLineId: l.purchaseOrderLineId ?? null })),
    },
  });
  for (const l of lines.filter((x) => x.discrepancyKind)) {
    await audit(tx, ctx, {
      action: "procurement.goods_receipt.discrepancy_recorded",
      entityType: "goods_receipt",
      entityId: gr.id,
      siteId,
      reason: l.discrepancyNote,
      after: { lineNo: l.index + 1, kind: l.discrepancyKind },
    });
  }
  return gr;
}

/**
 * Creates a goods receipt draft (W01-01..04). No lot, number or stock exists until it is posted.
 * A repeat with the same idempotency key returns the first draft.
 */
export async function createReceiptDraft(ctx: AuthContext, input: ReceiptDraftInput) {
  ctx.require("procurement.goods_receipt.create");
  ctx.requireSite(ctx.currentSiteId);
  if (!isUuid(input.idempotencyKey)) throw new DomainError("validation", "The form is missing its submission key. Reload the page and try again.");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"gr:" + input.idempotencyKey}))`);
    const [existing] = await tx
      .select({ id: goodsReceipts.id })
      .from(goodsReceipts)
      .where(and(eq(goodsReceipts.organizationId, ctx.organizationId), eq(goodsReceipts.idempotencyKey, input.idempotencyKey)))
      .limit(1);
    if (existing) return { receiptId: existing.id, replayed: true };
    const gr = await insertDraft(tx, ctx, input);
    return { receiptId: gr.id, replayed: false };
  });
}

/**
 * Replaces the header and lines of a draft. Lines keep their id (and attached documents) when the
 * payload names them; lines left out are removed together with their draft documents.
 */
export async function updateReceiptDraft(ctx: AuthContext, receiptId: string, input: ReceiptHeaderInput) {
  ctx.require("procurement.goods_receipt.create");
  return db.transaction(async (tx) => {
    const gr = await lockReceipt(tx, ctx, receiptId);
    assertReceiptTransition("edit", gr.status, receiptLabel(gr));
    const supplierDocumentNumber = headerDocNo(input);
    const notes = cleanText(input.notes, 1000, "notes", "Notes");
    const lines = await normalizeLines(tx, ctx, gr.siteId, input.lines);
    const existing = await tx.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.goodsReceiptId, gr.id));
    // W4A: a PO receipt keeps its PO and supplier; a line edited without naming its PO line keeps the stored one.
    for (const l of lines) {
      if (l.purchaseOrderLineId === undefined) l.purchaseOrderLineId = gr.purchaseOrderId ? (existing.find((e) => e.id === l.lineId)?.purchaseOrderLineId ?? null) : null;
      if (!gr.purchaseOrderId) l.purchaseOrderLineId = null;
    }
    const { supplier, supplierName } = gr.purchaseOrderId
      ? await (async () => {
          const h = await poHeader(tx, ctx, gr.siteId, gr.purchaseOrderId!, lines);
          return { supplier: { id: h.supplierId }, supplierName: h.supplierName };
        })()
      : await resolveSupplier(tx, ctx, input);
    const unplannedReasonCode = gr.purchaseOrderId ? null : await headerReason(tx, ctx, input);
    for (const l of lines) {
      if (l.lineId && !existing.some((e) => e.id === l.lineId)) throw new DomainError("validation", `Line ${l.index + 1} does not belong to this receipt. Reload the page.`);
    }
    const keep = new Set(lines.map((l) => l.lineId).filter(Boolean) as string[]);
    const removed = existing.filter((e) => !keep.has(e.id));
    if (removed.length) {
      const removedIds = removed.map((r) => r.id);
      const docs = await tx.select({ fileId: supplierLotDocuments.fileAttachmentId }).from(supplierLotDocuments).where(inArray(supplierLotDocuments.goodsReceiptLineId, removedIds));
      await tx.delete(supplierLotDocuments).where(inArray(supplierLotDocuments.goodsReceiptLineId, removedIds));
      if (docs.length) {
        await tx
          .update(fileAttachments)
          .set({ deletedAt: new Date(), deletedBy: ctx.userId, deleteReason: "Receipt line removed from the draft" })
          .where(and(inArray(fileAttachments.id, docs.map((d) => d.fileId)), isNull(fileAttachments.deletedAt)));
      }
      await tx.delete(goodsReceiptLines).where(inArray(goodsReceiptLines.id, removedIds));
    }
    // Clear line numbers first so renumbering never collides with the unique (receipt, line_no) index.
    await tx.update(goodsReceiptLines).set({ lineNo: null }).where(eq(goodsReceiptLines.goodsReceiptId, gr.id));
    const now = new Date();
    for (const l of lines) {
      const prev = existing.find((e) => e.id === l.lineId);
      const discrepancyChanged = !!prev && (prev.discrepancyKind !== l.discrepancyKind || prev.discrepancyNote !== l.discrepancyNote);
      const disc = l.discrepancyKind
        ? {
            discrepancyKind: l.discrepancyKind,
            discrepancyNote: l.discrepancyNote,
            ...(prev && !discrepancyChanged
              ? {}
              : { discrepancyRecordedBy: ctx.userId, discrepancyRecordedAt: now, discrepancyApprovedBy: null, discrepancyApprovedAt: null, discrepancyApprovalNote: null }),
          }
        : { discrepancyKind: null, discrepancyNote: null, discrepancyRecordedBy: null, discrepancyRecordedAt: null, discrepancyApprovedBy: null, discrepancyApprovedAt: null, discrepancyApprovalNote: null };
      if (prev) {
        await tx
          .update(goodsReceiptLines)
          .set({ lineNo: l.index + 1, ...lineValues(l), purchaseOrderLineId: l.purchaseOrderLineId ?? null, ...disc, updatedAt: now })
          .where(eq(goodsReceiptLines.id, prev.id));
      } else {
        await tx.insert(goodsReceiptLines).values({ goodsReceiptId: gr.id, lineNo: l.index + 1, ...lineValues(l), purchaseOrderLineId: l.purchaseOrderLineId ?? null, ...disc, createdBy: ctx.userId });
      }
    }
    await tx
      .update(goodsReceipts)
      .set({ supplierId: supplier?.id ?? null, supplierName, supplierDocumentNumber, unplannedReasonCode, notes, updatedAt: now })
      .where(eq(goodsReceipts.id, gr.id));
    await audit(tx, ctx, {
      action: "procurement.goods_receipt.updated",
      entityType: "goods_receipt",
      entityId: gr.id,
      siteId: gr.siteId,
      before: { supplierName: gr.supplierName, supplierDocumentNumber: gr.supplierDocumentNumber, lines: existing.length },
      after: { supplierName, supplierDocumentNumber, lines: lines.length, removedLines: removed.length },
    });
    return { receiptId: gr.id };
  });
}

/* ------------------------------------------------------------------ post */

/** True when an active CoA document is attached to the receipt line. */
async function lineHasCoa(tx: Tx, lineId: string) {
  const [r] = await tx
    .select({ id: supplierLotDocuments.id })
    .from(supplierLotDocuments)
    .innerJoin(fileAttachments, eq(fileAttachments.id, supplierLotDocuments.fileAttachmentId))
    .where(and(eq(supplierLotDocuments.goodsReceiptLineId, lineId), eq(supplierLotDocuments.documentKind, "coa"), isNull(fileAttachments.deletedAt)))
    .limit(1);
  return !!r;
}

type LineRow = typeof goodsReceiptLines.$inferSelect;
function poLinesOf(rows: LineRow[], lines?: NormalizedLine[]): PoReceiptLine[] {
  return rows.map((r, i) => ({
    lineId: r.id,
    lineNo: r.lineNo ?? i + 1,
    purchaseOrderLineId: r.purchaseOrderLineId,
    materialId: r.materialId,
    qtyBase: lines?.[i]?.qtyBase ?? new Decimal(r.qtyBase),
    discrepancyKind: r.discrepancyKind,
    discrepancyApproved: !!r.discrepancyApprovedBy,
  }));
}

/**
 * Posts a locked draft in the caller's transaction: per line one lot (quarantine unless the material is
 * configured as not requiring incoming inspection), one receipt movement into the line's location, and
 * the receipt number. Already-posted receipts return their original result (V-DUP).
 */
async function postInTx(tx: Tx, ctx: AuthContext, gr: typeof goodsReceipts.$inferSelect) {
  if (gr.status === "posted" || gr.status === "reversed") return { receiptId: gr.id, receiptNumber: gr.receiptNumber ?? "", replayed: true };
  assertReceiptTransition("post", gr.status, receiptLabel(gr));
  const today = manilaToday();

  if (gr.supplierId) {
    const [s] = await tx.select().from(suppliers).where(eq(suppliers.id, gr.supplierId)).limit(1);
    if (s && s.qualityStatus === "suspended") {
      throw new DomainError(
        "conflict",
        `Supplier ${s.name} is suspended${s.qualityStatusReason ? ` (${s.qualityStatusReason})` : ""}. Lines from this supplier are blocked until procurement or QA resolves the supplier status (V-ASL).`,
        { rule: "V-ASL" },
      );
    }
    if (s && !s.isActive) throw new DomainError("conflict", `Supplier ${s.name} is inactive. Ask procurement to reactivate it before posting.`);
  }

  const rows = await tx.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.goodsReceiptId, gr.id)).orderBy(asc(goodsReceiptLines.lineNo));
  if (rows.length === 0) throw new DomainError("validation", "Add at least one line before posting.", { field: "lines" });
  // Re-validate against current master data (a location or material may have changed since the draft was saved).
  const lines = await normalizeLines(
    tx,
    ctx,
    gr.siteId,
    rows.map((r) => ({
      lineId: r.id,
      materialId: r.materialId,
      qty: r.qtyEntered ?? r.qtyBase,
      uom: r.uomEntered,
      supplierLotNumber: r.supplierLotNumber ?? "",
      brand: r.brand,
      manufacturedOn: r.manufacturedOn,
      expiresOn: r.expiresOn ?? "",
      retestOn: r.retestOn,
      containerCount: r.containerCount,
      storageConditionsConfirmed: r.storageConditionsConfirmed,
      locationId: r.locationId,
      // Discrepancies are checked below from the stored row (they may have been recorded after the draft was saved).
      discrepancyKind: null,
      discrepancyNote: null,
      purchaseOrderLineId: r.purchaseOrderLineId,
    })),
  );
  for (const l of lines) {
    const row = rows[l.index];
    const n = row.lineNo ?? l.index + 1;
    if (l.expiresOn <= today && !row.discrepancyKind) {
      throw new DomainError(
        "validation",
        `Line ${n}: the expiry date must be after today. Expired or same-day material can only be received with a recorded discrepancy, as a reject candidate for QA.`,
        { field: `lines.${l.index}.expiresOn` },
      );
    }
    if (row.discrepancyKind && DISCREPANCY_BLOCKS_POSTING.includes(row.discrepancyKind as DiscrepancyKind) && !row.discrepancyApprovedBy) {
      throw new DomainError(
        "conflict",
        `Line ${n}: ${DISCREPANCY_LABELS[row.discrepancyKind as DiscrepancyKind].toLowerCase()} needs procurement approval before posting (CX-QTY).`,
        { rule: "CX-QTY", lineId: row.id },
      );
    }
    if (l.mat.storageConditions && !row.storageConditionsConfirmed) {
      throw new DomainError("validation", `Line ${n}: confirm the storage conditions for ${l.mat.name} (${l.mat.storageConditions}).`, {
        field: `lines.${l.index}.storageConditionsConfirmed`,
      });
    }
  }

  // W4A (US-6-03): PO receipts check V-OVER and move the PO lines and the PO state in this transaction.
  if (gr.purchaseOrderId) {
    await receivingPoHooks().onPost(tx, ctx, { receiptId: gr.id, receiptLabel: receiptLabel(gr), purchaseOrderId: gr.purchaseOrderId, siteId: gr.siteId, lines: poLinesOf(rows, lines) });
  }

  const receiptNumber = await nextNumber(tx, ctx.organizationId, "GR");
  const correlationId = uuidv7();
  const created: { lineNo: number; lotNumber: string; material: string; qty: string; uom: string; location: string; status: string; documentMissing: boolean }[] = [];
  const now = new Date();
  for (const l of lines) {
    const row = rows[l.index];
    const lineNo = row.lineNo ?? l.index + 1;
    const lotNumber = await nextNumber(tx, ctx.organizationId, "LOT");
    const [lot] = await tx
      .insert(inventoryLots)
      .values({
        organizationId: ctx.organizationId,
        siteId: gr.siteId,
        lotNumber,
        itemKind: "material",
        materialId: l.mat.id,
        supplierName: gr.supplierName,
        supplierLotNumber: l.supplierLotNumber,
        brand: l.brand,
        manufacturedOn: l.manufacturedOn,
        expiresOn: l.expiresOn,
        retestOn: l.retestOn,
        qualityStatus: l.initialQualityStatus,
        baseUom: l.mat.baseUom,
        createdBy: gr.receivedBy,
      })
      .returning();
    const { movement } = await postMovement(tx, ctx, {
      movementType: "receipt",
      lotId: lot.id,
      toLocationId: l.loc.id,
      qtyBase: l.qtyBase,
      sourceDocumentType: "goods_receipt",
      sourceDocumentId: gr.id,
      sourceDocumentNumber: receiptNumber,
      idempotencyKey: `gr:${gr.id}:${lineNo}`,
      correlationId,
      meta: { qtyEntered: l.qtyEntered.toString(), uomEntered: l.uomEntered },
    });
    const documentMissing = l.mat.requiresCoa && !(await lineHasCoa(tx, row.id));
    await tx
      .update(goodsReceiptLines)
      .set({
        lotId: lot.id,
        stockMovementId: movement.id,
        documentMissing,
        updatedAt: now,
      })
      .where(eq(goodsReceiptLines.id, row.id));
    await tx.update(supplierLotDocuments).set({ lotId: lot.id }).where(eq(supplierLotDocuments.goodsReceiptLineId, row.id));
    if (l.initialQualityStatus === "released") {
      // Material configured by QA as "release on receipt" (A-PROC-10): still recorded as a disposition.
      await tx.insert(dispositions).values({
        organizationId: ctx.organizationId,
        siteId: gr.siteId,
        subjectType: "lot",
        subjectId: lot.id,
        decision: "release",
        fromStatus: "quarantine",
        toStatus: "released",
        reason: `Released on receipt: ${l.mat.code} is configured by QA as not requiring incoming inspection.`,
        decidedBy: ctx.userId,
      });
    }
    await audit(tx, ctx, {
      action: "inventory.inventory_lot.created",
      entityType: "inventory_lot",
      entityId: lot.id,
      entityNumber: lotNumber,
      siteId: gr.siteId,
      after: { receiptNumber, lineNo, material: l.mat.code, qtyBase: l.qtyBase.toString(), baseUom: l.mat.baseUom, qualityStatus: l.initialQualityStatus, location: l.loc.code },
    });
    created.push({ lineNo, lotNumber, material: l.mat.code, qty: l.qtyBase.toString(), uom: l.mat.baseUom, location: l.loc.code, status: l.initialQualityStatus, documentMissing });
  }

  await tx
    .update(goodsReceipts)
    .set({ status: "posted", receiptNumber, postedAt: now, postedBy: ctx.userId, correlationId, updatedAt: now })
    .where(eq(goodsReceipts.id, gr.id));
  await audit(tx, ctx, {
    action: "procurement.goods_receipt.posted",
    entityType: "goods_receipt",
    entityId: gr.id,
    entityNumber: receiptNumber,
    siteId: gr.siteId,
    before: { status: gr.status },
    after: { status: "posted", supplierName: gr.supplierName, supplierDocumentNumber: gr.supplierDocumentNumber, correlationId, lines: created },
  });
  return { receiptId: gr.id, receiptNumber, replayed: false };
}

/** Posts a draft (W01-06). Double taps and reload-and-repost return the original result; nothing doubles. */
export async function postReceipt(ctx: AuthContext, input: { receiptId: string }) {
  ctx.require("procurement.goods_receipt.post");
  return db.transaction(async (tx) => {
    const gr = await lockReceipt(tx, ctx, input.receiptId);
    return postInTx(tx, ctx, gr);
  });
}

/**
 * Creates and posts a receipt in one transaction (the phone "Post receipt" path). The client sends one
 * UUID per form; a second submit with the same UUID returns the first receipt instead of doubling stock.
 */
export async function receiveAndPost(ctx: AuthContext, input: ReceiptDraftInput) {
  ctx.require("procurement.goods_receipt.create");
  ctx.require("procurement.goods_receipt.post");
  ctx.requireSite(ctx.currentSiteId);
  if (!isUuid(input.idempotencyKey)) throw new DomainError("validation", "The form is missing its submission key. Reload the page and try again.");
  return db.transaction(async (tx) => {
    // Serialize submissions that share the key, then check whether the first one already exists.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"gr:" + input.idempotencyKey}))`);
    const [existing] = await tx
      .select({ id: goodsReceipts.id })
      .from(goodsReceipts)
      .where(and(eq(goodsReceipts.organizationId, ctx.organizationId), eq(goodsReceipts.idempotencyKey, input.idempotencyKey)))
      .limit(1);
    if (existing) {
      const gr = await lockReceipt(tx, ctx, existing.id);
      return postInTx(tx, ctx, gr);
    }
    const draft = await insertDraft(tx, ctx, input);
    const gr = await lockReceipt(tx, ctx, draft.id);
    return postInTx(tx, ctx, gr);
  });
}

/** MVP name kept for the original one-step receive flow and its tests. */
export const postGoodsReceipt = receiveAndPost;

/* ------------------------------------------------------------------ cancel / reverse */

export async function cancelReceiptDraft(ctx: AuthContext, input: { receiptId: string; reason: string }) {
  ctx.require("procurement.goods_receipt.create");
  const reason = requireReason(input.reason);
  return db.transaction(async (tx) => {
    const gr = await lockReceipt(tx, ctx, input.receiptId);
    const to = assertReceiptTransition("cancel", gr.status, receiptLabel(gr));
    await tx.update(goodsReceipts).set({ status: to, cancelledAt: new Date(), cancelledBy: ctx.userId, cancelReason: reason, updatedAt: new Date() }).where(eq(goodsReceipts.id, gr.id));
    await audit(tx, ctx, { action: "procurement.goods_receipt.cancelled", entityType: "goods_receipt", entityId: gr.id, siteId: gr.siteId, reason, before: { status: gr.status }, after: { status: to } });
    return { receiptId: gr.id };
  });
}

/**
 * Voids a posted receipt by reversal (US-2-07 AC3): one reversal movement per line out of the receipt
 * location. The lots stay (zero balance) and the receipt becomes `reversed`. If the stock has moved
 * since, the reversal is refused (409) until it is moved back.
 */
export async function reverseReceipt(ctx: AuthContext, input: { receiptId: string; reason: string }) {
  ctx.require("procurement.goods_receipt.void");
  const reason = requireReason(input.reason);
  return db.transaction(async (tx) => {
    const gr = await lockReceipt(tx, ctx, input.receiptId);
    const to = assertReceiptTransition("reverse", gr.status, receiptLabel(gr));
    // W3C: opening stock lines live in opening_balance_lines; the import job void reverses them (docs/data-migration-plan.md §9.3).
    if (gr.receiptKind === "opening_balance") throw new DomainError("state", `Receipt ${receiptLabel(gr)} is an opening balance; reverse it by voiding its import job.`);
    const rows = await tx
      .select({ line: goodsReceiptLines, lotNumber: inventoryLots.lotNumber, locationCode: locations.code })
      .from(goodsReceiptLines)
      .innerJoin(inventoryLots, eq(inventoryLots.id, goodsReceiptLines.lotId))
      .innerJoin(locations, eq(locations.id, goodsReceiptLines.locationId))
      .where(eq(goodsReceiptLines.goodsReceiptId, gr.id))
      .orderBy(asc(goodsReceiptLines.lineNo));
    const reversed: { lotNumber: string; qty: string; location: string; movementId: string }[] = [];
    for (const { line, lotNumber, locationCode } of rows) {
      if (!line.lotId || !line.stockMovementId) continue;
      try {
        const { movement } = await postMovement(tx, ctx, {
          movementType: "reversal",
          lotId: line.lotId,
          fromLocationId: line.locationId,
          qtyBase: line.qtyBase,
          sourceDocumentType: "goods_receipt",
          sourceDocumentId: gr.id,
          sourceDocumentNumber: gr.receiptNumber ?? undefined,
          reason,
          reversalOfId: line.stockMovementId,
          correlationId: gr.correlationId ?? undefined,
          idempotencyKey: `gr-reversal:${gr.id}:${line.lineNo ?? line.id}`,
        });
        reversed.push({ lotNumber, qty: line.qtyBase, location: locationCode, movementId: movement.id });
      } catch (e) {
        if (e instanceof DomainError && e.code === "insufficient_stock") {
          throw new DomainError(
            "insufficient_stock",
            `Lot ${lotNumber} no longer has its full received quantity at ${locationCode}. Move the stock back (or reverse the later movements) before reversing the receipt.`,
          );
        }
        throw e;
      }
    }
    if (gr.purchaseOrderId) {
      await receivingPoHooks().onReverse(tx, ctx, { receiptId: gr.id, receiptNumber: gr.receiptNumber, purchaseOrderId: gr.purchaseOrderId, siteId: gr.siteId, reason, lines: poLinesOf(rows.map((r) => r.line)) });
    }
    const now = new Date();
    await tx.update(goodsReceipts).set({ status: to, reversedAt: now, reversedBy: ctx.userId, reversalReason: reason, updatedAt: now }).where(eq(goodsReceipts.id, gr.id));
    await audit(tx, ctx, {
      action: "procurement.goods_receipt.reversed",
      entityType: "goods_receipt",
      entityId: gr.id,
      entityNumber: gr.receiptNumber,
      siteId: gr.siteId,
      reason,
      before: { status: gr.status },
      after: { status: to, reversed },
    });
    return { receiptId: gr.id, reversed: reversed.length };
  });
}

/* ------------------------------------------------------------------ discrepancies */

async function lockLine(tx: Tx, ctx: AuthContext, lineId: string) {
  if (!isUuid(lineId)) throw new DomainError("not_found", "Receipt line not found in your sites.");
  const [row] = await tx.select({ receiptId: goodsReceiptLines.goodsReceiptId }).from(goodsReceiptLines).where(eq(goodsReceiptLines.id, lineId)).limit(1);
  if (!row) throw new DomainError("not_found", "Receipt line not found in your sites.");
  const gr = await lockReceipt(tx, ctx, row.receiptId);
  const [line] = await tx.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.id, lineId)).for("update").limit(1);
  return { gr, line };
}

/** Records (or replaces an unapproved) discrepancy on a line (W01-04), on a draft or a posted receipt. */
export async function recordLineDiscrepancy(ctx: AuthContext, input: { lineId: string; kind: DiscrepancyKind; note: string }) {
  ctx.require("procurement.goods_receipt.create");
  if (!(DISCREPANCY_KINDS as readonly string[]).includes(input.kind)) throw new DomainError("validation", "Choose a discrepancy type.", { field: "kind" });
  const note = requireReason(input.note, "note");
  return db.transaction(async (tx) => {
    const { gr, line } = await lockLine(tx, ctx, input.lineId);
    if (gr.status !== "draft" && gr.status !== "posted") throw new DomainError("state", `Receipt ${receiptLabel(gr)} is ${gr.status}; discrepancies can no longer be recorded.`);
    if (line.discrepancyApprovedBy) throw new DomainError("state", "This line's discrepancy is already approved by procurement and cannot be changed.");
    await tx
      .update(goodsReceiptLines)
      .set({ discrepancyKind: input.kind, discrepancyNote: note, discrepancyRecordedBy: ctx.userId, discrepancyRecordedAt: new Date(), updatedAt: new Date() })
      .where(eq(goodsReceiptLines.id, line.id));
    await audit(tx, ctx, {
      action: "procurement.goods_receipt.discrepancy_recorded",
      entityType: "goods_receipt",
      entityId: gr.id,
      entityNumber: gr.receiptNumber,
      siteId: gr.siteId,
      reason: note,
      before: { kind: line.discrepancyKind },
      after: { lineNo: line.lineNo, kind: input.kind },
    });
    return { lineId: line.id };
  });
}

/**
 * Procurement accepts a recorded discrepancy (CX-QTY, G-W01-A). The approver must not be the person who
 * received the goods or recorded the discrepancy (separation of duties).
 */
export async function approveLineDiscrepancy(ctx: AuthContext, input: { lineId: string; note: string }) {
  ctx.require("procurement.receipt_discrepancy.approve");
  const note = requireReason(input.note, "note");
  return db.transaction(async (tx) => {
    const { gr, line } = await lockLine(tx, ctx, input.lineId);
    if (!line.discrepancyKind) throw new DomainError("state", "This line has no discrepancy to approve.");
    if (line.discrepancyApprovedBy) throw new DomainError("state", "This discrepancy is already approved.");
    if (gr.status !== "draft" && gr.status !== "posted") throw new DomainError("state", `Receipt ${receiptLabel(gr)} is ${gr.status}.`);
    const excluded = new Set([gr.receivedBy, gr.createdBy, line.discrepancyRecordedBy, line.createdBy].filter(Boolean) as string[]);
    if (ctx.sodBlocks(excluded.has(ctx.userId), "You received these goods or recorded this discrepancy, so another procurement user must approve it (separation of duties).")) {
      throw new DomainError("separation_of_duties", "You received these goods or recorded this discrepancy, so another procurement user must approve it (separation of duties).", ctx.refusalDetails());
    }
    const now = new Date();
    await tx
      .update(goodsReceiptLines)
      .set({ discrepancyApprovedBy: ctx.userId, discrepancyApprovedAt: now, discrepancyApprovalNote: note, updatedAt: now })
      .where(eq(goodsReceiptLines.id, line.id));
    await audit(tx, ctx, {
      action: "procurement.goods_receipt_line.discrepancy_approved",
      entityType: "goods_receipt_line",
      entityId: line.id,
      entityNumber: gr.receiptNumber,
      siteId: gr.siteId,
      reason: note,
      after: { receiptId: gr.id, lineNo: line.lineNo, kind: line.discrepancyKind },
    });
    return { lineId: line.id };
  });
}

/** Links a receipt that named an unregistered supplier to a supplier master record (W01-11). */
export async function linkReceiptSupplier(ctx: AuthContext, input: { receiptId: string; supplierId: string }) {
  ctx.require("procurement.receipt_discrepancy.approve");
  return db.transaction(async (tx) => {
    const gr = await lockReceipt(tx, ctx, input.receiptId);
    if (gr.status === "cancelled") throw new DomainError("state", "The receipt is cancelled.");
    if (gr.supplierId) throw new DomainError("state", "This receipt is already linked to a supplier.");
    const { supplier } = await resolveSupplier(tx, ctx, { supplierId: input.supplierId });
    await tx.update(goodsReceipts).set({ supplierId: supplier!.id, supplierName: supplier!.name, updatedAt: new Date() }).where(eq(goodsReceipts.id, gr.id));
    await audit(tx, ctx, {
      action: "procurement.goods_receipt.supplier_linked",
      entityType: "goods_receipt",
      entityId: gr.id,
      entityNumber: gr.receiptNumber,
      siteId: gr.siteId,
      before: { supplierName: gr.supplierName, supplierId: null },
      after: { supplierName: supplier!.name, supplierId: supplier!.id },
    });
    return { receiptId: gr.id };
  });
}
