import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, lte, ne, or } from "drizzle-orm";
import Decimal from "decimal.js";
import { uuidv7 } from "uuidv7";
import { db, type DbOrTx, type Tx } from "@/db/client";
import { batchMaterials, batchPaperRecords, batches, generatedDocuments, inventoryLots, materials, products, stockReservations } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDateTime, fmtQty } from "@/lib/qty";
import { renderForDisplay } from "@/modules/documents";
import { visibleBatch } from "./bmr";
import { type PaperPageExtras, issuePageInTx, paperEntryCount } from "./bmr-paper";
import { isPackagingKind } from "./packaging-lines";
import { composePaperPack } from "./paper-pack-html";
import { type FormulaSnapshot, addDays, isWeighingStep, lockBatch, manilaToday } from "./shared";
import { toleranceRange } from "./weigh-window";

/**
 * ADR-134 — the paper batch record pack: one printable set of pages per batch, one issued page per routing step (each
 * a `bmr_paper_page` document with its own DOC number, QR and page reference), made online when someone taps "Get the
 * paper record ready". The device keeps a copy (src/lib/offline/paper-packs.ts) so Chrome can print it with no internet.
 * Pages that were never used are voided together by a person, with a reason ("not used"), before the QA decision.
 */

/** Batch states in which a pack can be made (before the batch goes to the hold area). */
export const PACK_OPEN_STATES = ["planned", "materials_staged", "in_process", "rework_approved"] as const;
/** "Today's and the next planned batches": batches planned to start within this many days are cached on the device. */
export const PACK_DAYS_AHEAD = 2;

export const PAPER_OUTAGE_NOTE = "No internet? Write on this page with a pen. Type it in later: open the batch, then Enter from the paper record.";

const LIVE_PAGE = ne(batchPaperRecords.status, "void");

/** Grams with the decimals the value needs (1 to 3), as on the weighing sheet. */
function gramsText(v: Decimal.Value) {
  const d = new Decimal(v);
  const dp = Math.min(Math.max(d.decimalPlaces(), 1), 3);
  return fmtQty(d.toDecimalPlaces(3), "g", dp);
}

/** The ingredient lines of the weighing page and the finish counts of the last page (pure data, frozen on the page). */
async function packExtras(q: DbOrTx, b: typeof batches.$inferSelect) {
  const snap = b.formulaSnapshot as FormulaSnapshot;
  const lines = await q
    .select({ bm: batchMaterials, m: materials })
    .from(batchMaterials)
    .innerJoin(materials, eq(materials.id, batchMaterials.materialId))
    .where(eq(batchMaterials.batchId, b.id))
    .orderBy(asc(batchMaterials.lineNo));
  const reserved = await q
    .selectDistinct({ materialId: inventoryLots.materialId, lotNumber: inventoryLots.lotNumber })
    .from(stockReservations)
    .innerJoin(inventoryLots, eq(inventoryLots.id, stockReservations.lotId))
    .where(and(eq(stockReservations.demandType, "batch"), eq(stockReservations.demandId, b.id), eq(stockReservations.status, "active")));
  const weighings: NonNullable<PaperPageExtras["weighings"]> = lines
    .filter((l) => !isPackagingKind(l.m.materialKind))
    .map((l) => {
      const { min, max } = toleranceRange(l.bm.theoreticalQtyG, l.bm.tolerancePct, l.bm.toleranceAbsG);
      const lots = reserved.filter((r) => r.materialId === l.m.id).map((r) => r.lotNumber);
      return {
        lineNo: l.bm.lineNo,
        materialName: l.m.name,
        materialCode: l.m.code,
        targetText: gramsText(l.bm.theoreticalQtyG),
        toleranceText: l.bm.toleranceAbsG !== null ? `± ${gramsText(l.bm.toleranceAbsG)}` : `± ${fmtQty(l.bm.tolerancePct, "%", 2)}`,
        rangeText: `${gramsText(min)} – ${gramsText(max)}`,
        needsCheck: snap.lines.find((x) => x.lineNo === l.bm.lineNo)?.requiresChecker !== false,
        lotHint: lots.length ? lots.join(", ").slice(0, 120) : null,
      };
    });
  const packaging = lines.filter((l) => isPackagingKind(l.m.materialKind));
  const finishCounts: NonNullable<PaperPageExtras["finishCounts"]> = [
    { label: "Good pieces made", uom: "pcs" },
    { label: "Rejected pieces", uom: "pcs" },
    { label: "QA samples taken", uom: "pcs" },
    ...packaging.flatMap((l) => [
      { label: `${l.m.name}: used`, uom: l.m.baseUom },
      { label: `${l.m.name}: damaged`, uom: l.m.baseUom },
      { label: `${l.m.name}: left over`, uom: l.m.baseUom },
    ]),
  ].slice(0, 30);
  return { weighings, finishCounts };
}

/** The live pages of the newest pack of a batch, in page order. */
async function openPackPages(q: DbOrTx, batchId: string) {
  const [latest] = await q
    .select({ packId: batchPaperRecords.packId })
    .from(batchPaperRecords)
    .where(and(eq(batchPaperRecords.batchId, batchId), isNotNull(batchPaperRecords.packId), LIVE_PAGE))
    .orderBy(desc(batchPaperRecords.issuedAt))
    .limit(1);
  if (!latest?.packId) return [];
  return q
    .select({ p: batchPaperRecords, documentNumber: generatedDocuments.documentNumber })
    .from(batchPaperRecords)
    .leftJoin(generatedDocuments, eq(generatedDocuments.id, batchPaperRecords.generatedDocumentId))
    .where(and(eq(batchPaperRecords.packId, latest.packId), LIVE_PAGE))
    .orderBy(asc(batchPaperRecords.pageNo));
}

export type PaperPackPageRef = { paperRecordId: string; reference: string; documentId: string | null; documentNumber: string | null; stepNo: number; stepName: string; status: string };

const pageRef = (r: Awaited<ReturnType<typeof openPackPages>>[number]): PaperPackPageRef => ({
  paperRecordId: r.p.id,
  reference: r.p.paperReference,
  documentId: r.p.generatedDocumentId,
  documentNumber: r.documentNumber,
  stepNo: r.p.stepNo,
  stepName: r.p.stepName,
  status: r.p.status,
});

/**
 * "Get the paper record ready" (online): issues one page per step of the batch's routing as one pack. One pack per
 * batch: while a pack has pages that are not void, asking again returns it (no new DOC numbers).
 */
export async function issuePaperPack(ctx: AuthContext, input: { batchId: string; idempotencyKey: string }) {
  ctx.require("production.batch.edit");
  ctx.require("documents.generated_document.create");
  if (!input.idempotencyKey || input.idempotencyKey.length < 8) throw new DomainError("validation", "The form is missing its submission key. Reload the page and try again.");
  return db.transaction(async (tx) => {
    await visibleBatch(tx, ctx, input.batchId);
    const b = await lockBatch(tx, ctx, input.batchId);
    const existing = await openPackPages(tx, b.id);
    if (existing.length) return { packId: existing[0].p.packId!, pages: existing.map(pageRef), replayed: true };
    if (!(PACK_OPEN_STATES as readonly string[]).includes(b.status)) {
      throw new DomainError("state", `Batch ${b.batchNumber} is ${b.status.replace(/_/g, " ")}. The paper record is made before the batch goes to the hold area.`);
    }
    const snap = b.formulaSnapshot as FormulaSnapshot;
    const steps = [...snap.steps].sort((x, z) => x.stepNo - z.stepNo);
    if (!steps.length) throw new DomainError("state", `Batch ${b.batchNumber} has no steps to print.`);
    const extras = await packExtras(tx, b);
    const packId = uuidv7();
    const pages: PaperPackPageRef[] = [];
    for (const [i, step] of steps.entries()) {
      const last = i === steps.length - 1;
      const r = await issuePageInTx(tx, ctx, b, step, {
        idempotencyKey: `paper-pack:${input.idempotencyKey}:${step.stepNo}`,
        documentKey: `paper-pack-doc:${input.idempotencyKey}:${step.stepNo}`,
        packId,
        extras: {
          outageNote: PAPER_OUTAGE_NOTE,
          ...(isWeighingStep(step.stepKind) ? { weighings: extras.weighings } : {}),
          ...(last ? { finishCounts: extras.finishCounts } : {}),
        },
      });
      pages.push({ paperRecordId: r.paperRecordId, reference: r.reference, documentId: r.documentId, documentNumber: r.documentNumber, stepNo: r.stepNo, stepName: r.stepName, status: "issued" });
    }
    await audit(tx, ctx, {
      action: "production.paper_pack.issued",
      entityType: "batch",
      entityId: b.id,
      entityNumber: b.batchNumber,
      siteId: b.siteId,
      after: { packId, pages: pages.map((p) => `${p.reference} ${p.documentNumber}`) },
    });
    return { packId, pages, replayed: false };
  });
}

export type PaperPackForDevice = {
  batchId: string;
  batchNumber: string;
  productName: string;
  siteId: string;
  status: string;
  plannedStartOn: string | null;
  packId: string;
  /** Changes when a page is added or voided: the device replaces its copy. */
  version: string;
  madeAt: string;
  madeAtText: string;
  pages: PaperPackPageRef[];
  html: string;
};

/**
 * The printable pack for the person's device (GET /api/v1/production/paper-packs/[batchId]). Only for people who may
 * see the batch and its documents, at their sites. Each page is re-rendered from its frozen dataset and must match its
 * checksum (the same check as the print pages), so the device holds exactly the recorded pages. Null: no pack yet.
 */
export async function paperPackForDevice(ctx: AuthContext, batchId: string): Promise<PaperPackForDevice | null> {
  ctx.require("production.batch.view");
  ctx.require("documents.generated_document.view");
  const { batch: b, product } = await visibleBatch(db, ctx, batchId);
  const rows = await openPackPages(db, b.id);
  if (!rows.length) return null;
  const docs = await db.select().from(generatedDocuments).where(inArray(generatedDocuments.id, rows.map((r) => r.p.generatedDocumentId).filter((x): x is string => !!x)));
  const pages: { css: string; body: string }[] = [];
  for (const r of rows) {
    const d = docs.find((x) => x.id === r.p.generatedDocumentId);
    if (!d) continue;
    const out = await renderForDisplay(d);
    if (out.integrity !== "ok" || !out.css || !out.body) throw new DomainError("state", `Page ${r.p.paperReference} (${d.documentNumber}) cannot be reproduced exactly. Do not print it; ask an administrator.`);
    pages.push({ css: out.css, body: out.body });
  }
  const madeAt = rows[0].p.issuedAt;
  return {
    batchId: b.id,
    batchNumber: b.batchNumber,
    productName: product.name,
    siteId: b.siteId,
    status: b.status,
    plannedStartOn: b.plannedStartOn,
    packId: rows[0].p.packId!,
    version: `${rows[0].p.packId}:${rows.map((r) => r.p.id.slice(-6)).join(".")}`,
    madeAt: madeAt.toISOString(),
    madeAtText: fmtDateTime(madeAt),
    pages: rows.map(pageRef),
    html: composePaperPack({ batchNumber: b.batchNumber, productName: product.name, pages }),
  };
}

export type UpcomingPaperPack = { batchId: string; batchNumber: string; productName: string; status: string; plannedStartOn: string | null; siteId: string; packId: string | null; version: string | null; pageCount: number };

/**
 * Today's and the next planned batches at the person's sites (in process, materials ready, or planned to start within
 * PACK_DAYS_AHEAD days), with their pack if one was made. The device caches the packs of these batches.
 */
export async function upcomingPaperPacks(ctx: AuthContext, now = new Date()): Promise<UpcomingPaperPack[]> {
  ctx.require("production.batch.view");
  if (!ctx.allowedSiteIds.length) return [];
  const until = addDays(manilaToday(now), PACK_DAYS_AHEAD);
  const rows = await db
    .select({ b: batches, productName: products.name })
    .from(batches)
    .innerJoin(products, eq(products.id, batches.productId))
    .where(
      and(
        eq(batches.organizationId, ctx.organizationId),
        inArray(batches.siteId, ctx.allowedSiteIds),
        or(inArray(batches.status, ["materials_staged", "in_process", "rework_approved"]), and(eq(batches.status, "planned"), lte(batches.plannedStartOn, until))),
      ),
    )
    .orderBy(asc(batches.plannedStartOn), asc(batches.batchNumber))
    .limit(12);
  const out: UpcomingPaperPack[] = [];
  for (const r of rows) {
    const pages = await openPackPages(db, r.b.id);
    out.push({
      batchId: r.b.id,
      batchNumber: r.b.batchNumber,
      productName: r.productName,
      status: r.b.status,
      plannedStartOn: r.b.plannedStartOn,
      siteId: r.b.siteId,
      packId: pages[0]?.p.packId ?? null,
      version: pages.length ? `${pages[0].p.packId}:${pages.map((p) => p.p.id.slice(-6)).join(".")}` : null,
      pageCount: pages.length,
    });
  }
  return out;
}

/** The pack's pages and how far each was typed in (for the batch page card). */
export async function paperPackSummary(ctx: AuthContext, batchId: string) {
  ctx.require("production.batch.view");
  const { batch: b } = await visibleBatch(db, ctx, batchId);
  const rows = await openPackPages(db, b.id);
  const pages = [];
  for (const r of rows) pages.push({ ...pageRef(r), entries: await paperEntryCount(db, r.p.id) });
  return { batchId: b.id, status: b.status, packId: rows[0]?.p.packId ?? null, pages, canMake: (PACK_OPEN_STATES as readonly string[]).includes(b.status) };
}

/**
 * "The paper record was not used": voids every page of the batch's pack that is still blank in the system (issued, no
 * line typed from it), with the person's reason. Pages with typed lines are kept: they are scanned, attached and
 * reviewed. Needed before the QA decision when the batch was recorded in the system after all.
 */
export async function voidUnusedPackPages(ctx: AuthContext, input: { batchId: string; reason: string }) {
  ctx.require("production.batch.edit");
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 5) throw new DomainError("validation", "Say why the paper record was not used (at least 5 characters).", { field: "reason", fieldErrors: { reason: "Say why." } });
  return db.transaction(async (tx: Tx) => {
    await visibleBatch(tx, ctx, input.batchId);
    const b = await lockBatch(tx, ctx, input.batchId);
    const rows = await tx
      .select()
      .from(batchPaperRecords)
      .where(and(eq(batchPaperRecords.batchId, b.id), isNotNull(batchPaperRecords.packId), eq(batchPaperRecords.status, "issued")))
      .orderBy(asc(batchPaperRecords.pageNo))
      .for("update");
    const now = new Date();
    const voided: string[] = [];
    const kept: string[] = [];
    for (const p of rows) {
      if ((await paperEntryCount(tx, p.id)) > 0) {
        kept.push(p.paperReference);
        continue;
      }
      await tx.update(batchPaperRecords).set({ status: "void", voidedBy: ctx.userId, voidedAt: now, voidReason: reason, updatedAt: now }).where(eq(batchPaperRecords.id, p.id));
      await audit(tx, ctx, { action: "production.batch_paper_record.voided", entityType: "batch_paper_record", entityId: p.id, entityNumber: b.batchNumber, siteId: b.siteId, reason, before: { status: "issued" }, after: { status: "void", reference: p.paperReference, unusedPack: true } });
      voided.push(p.paperReference);
    }
    return { voided: voided.length, voidedReferences: voided, kept };
  });
}
