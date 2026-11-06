import "server-only";
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import Decimal from "decimal.js";
import { type DbOrTx, type Tx, db } from "@/db/client";
import { batchBoxes, batchMaterialStagings, batches, containers, inventoryLots, labelJobs, locations, products, stockMovements } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import { nextNumber, peekNextNumber } from "@/lib/numbering";
import { getSetting } from "@/lib/settings";
import { activeStationsAt, approvedLabelTemplatesFor, createLabelJob, labelPreviewOrNull, voidLabelsForEntityInTx } from "@/modules/documents";
import { addContent, containerMachine, newBox } from "@/modules/inventory";
import { postMovement } from "@/modules/inventory/ledger";
import { boxSplit, MAX_BOXES, parsePieces } from "./box-plan";
import { type BatchRow, sortedSteps, stepRecords } from "./execution";
import { currentPackaging } from "./packaging";
import { BATCH_LABEL_STATES, batchLabelValues, fixLabelLotLocked, labelPrintBlocker } from "./packaging-flow";
import { expectedPieces } from "./packaging-lines";
import { type FormulaSnapshot, idempotent, lockBatch } from "./shared";
import { LABELS_MENU_PATH } from "@/lib/menu-paths";

/**
 * ADR-104 §2 "Labels: box labels by default". On the packaging step (and Finish) the operator says how many pieces
 * were packed; the product's pieces per box make the boxes ("12 boxes of 24 and 1 box of 9") and "Print 13 box
 * labels" makes one label job per box (label kind `carton`, entity `batch_box`). Each box gets its BOX number when
 * its label is printed; Finish creates the box (container) with that number and its pieces in the hold area, in
 * the same transaction as the output posting, so warehouse and sales scan boxes. A new count replaces the plan:
 * the old rows are kept as `replaced` (reason, who, when) and their labels are cancelled (not printed) or voided
 * (printed, "destroy"). `per_piece` products also print piece labels (ADR-092 panel); piece labels are not
 * reconciled label by label.
 */

export const BOX_LABEL_KIND = "carton";

async function productOf(q: DbOrTx, productId: string) {
  const [p] = await q.select().from(products).where(eq(products.id, productId)).limit(1);
  if (!p) throw new DomainError("not_found", "Product not found.");
  return p;
}

/** Boxes of the latest plan that is not replaced (planned or boxed), in box order. */
export async function currentBoxPlan(q: DbOrTx, batchId: string) {
  const rows = await q.select().from(batchBoxes).where(and(eq(batchBoxes.batchId, batchId), ne(batchBoxes.status, "replaced"))).orderBy(desc(batchBoxes.planNo), asc(batchBoxes.boxNo));
  const planNo = rows[0]?.planNo;
  return rows.filter((r) => r.planNo === planNo);
}

async function boxTemplate(q: DbOrTx, organizationId: string, siteId: string) {
  return (await approvedLabelTemplatesFor(q, organizationId, siteId, BOX_LABEL_KIND))[0] ?? null;
}

export type BatchBoxInfo = Awaited<ReturnType<typeof batchBoxInfo>>;

/** What the box label card needs on the packaging step and Finish (null fields explain why it cannot print). */
export async function batchBoxInfo(ctx: AuthContext, batch: BatchRow) {
  const p = await productOf(db, batch.productId);
  const plan = await currentBoxPlan(db, batch.id);
  const jobs = plan.some((r) => r.labelJobId) ? await db.select({ id: labelJobs.id, status: labelJobs.status, voidedAt: labelJobs.voidedAt }).from(labelJobs).where(inArray(labelJobs.id, plan.map((r) => r.labelJobId).filter((x): x is string => !!x))) : [];
  const expected = expectedPieces(batch.plannedSizeG, (batch.formulaSnapshot as FormulaSnapshot).theoreticalYieldPct, p.unitNetMassG).toNumber();
  const packed = plan.reduce((t, r) => t + r.pieces, 0);
  const pieceWord = (p.family ?? "").toLowerCase().includes("soap") ? "bars" : "pieces";
  const stepGate =
    batch.status === "in_process" && !batch.outputLotNumber
      ? labelPrintBlocker(sortedSteps(batch.formulaSnapshot as FormulaSnapshot), await stepRecords(db, batch.id), { unitsPerBox: p.unitsPerBox, pieceWord, labelling: p.labelling as "per_box" | "per_piece" })
      : null;
  const allowed = BATCH_LABEL_STATES.includes(batch.status) && !stepGate && !plan.some((r) => r.status === "boxed");
  const template = await boxTemplate(db, ctx.organizationId, batch.siteId);
  const stations = await activeStationsAt(db, ctx.organizationId, batch.siteId);
  const why = plan.some((r) => r.status === "boxed")
    ? null
    : !ctx.can("inventory.label_job.create")
      ? "You cannot print labels. Ask the supervisor."
      : !BATCH_LABEL_STATES.includes(batch.status)
        ? "Box labels are printed once the batch is being made."
        : stepGate
          ? stepGate
          : !template
            ? `No approved box label is set up for this site. Ask QA (${LABELS_MENU_PATH}).`
            : !stations.length
              ? `No label printer is set up for this site. Ask the administrator (${LABELS_MENU_PATH}).`
              : null;
  // ADR-110 C6: the retained samples QA keeps are never boxed, so the default to box is expected - samples and the
  // labels printed here match Finish (which takes the samples out of the good pieces).
  const sampleSetting = await getSetting(db, ctx.organizationId, "production.output.retained_samples", batch.siteId);
  const samples = sampleSetting.enabled ? Number(sampleSetting.units) || 0 : 0;
  const defaultPieces = packed || Math.max((expected || 0) - samples, 0) || expected || 1;
  let preview = null;
  // Finding 6: while the step is locked the operator still sees the label they will print (read only).
  const locked = !!stepGate && !plan.length;
  if ((allowed || locked) && template && ctx.can("inventory.label_job.view")) {
    const v = await batchLabelValues(ctx, batch);
    const first = boxSplit(defaultPieces, p.unitsPerBox);
    preview = await labelPreviewOrNull(ctx, {
      entityType: "batch_box",
      entityId: batch.id,
      boxPreview: { ...v, boxNo: 1, boxCount: first?.boxes ?? 1, pieces: first?.sizes[0] ?? defaultPieces, containerNumber: plan[0]?.containerNumber ?? (await peekNextNumber(db, ctx.organizationId, "BOX")) },
    });
  }
  const jobOf = (id: string | null) => jobs.find((j) => j.id === id);
  return {
    labelling: p.labelling as "per_box" | "per_piece",
    pieceWord,
    /** Locked until the earlier steps are done (finding 6): the planned boxes and the preview are shown read only. */
    locked,
    unitsPerBox: p.unitsPerBox,
    expectedPieces: expected,
    defaultPieces,
    /** Retained samples QA keeps (not boxed); Finish's default "Samples kept". */
    samples,
    plan: plan.length
      ? {
          planNo: plan[0].planNo,
          pieces: packed,
          boxes: plan.map((r) => ({ id: r.id, boxNo: r.boxNo, boxCount: r.boxCount, pieces: r.pieces, containerNumber: r.containerNumber, status: r.status, containerId: r.containerId, labelStatus: jobOf(r.labelJobId)?.voidedAt ? "void" : (jobOf(r.labelJobId)?.status ?? null) })),
          printed: plan.every((r) => jobOf(r.labelJobId)?.status === "printed"),
          boxed: plan.every((r) => r.status === "boxed"),
        }
      : null,
    allowed,
    canPrint: allowed && !why,
    why,
    preview,
    printHref: `/print/labels/batch-boxes/${batch.id}`,
  };
}

/** batchBoxInfo by batch id for the screens (scoped to the caller's organization and sites). */
export async function batchBoxInfoFor(ctx: AuthContext, batchId: string) {
  ctx.require("production.batch.view");
  if (!/^[0-9a-f-]{36}$/i.test(batchId)) throw new DomainError("not_found", "Batch not found.");
  const [b] = await db.select().from(batches).where(and(eq(batches.id, batchId), eq(batches.organizationId, ctx.organizationId))).limit(1);
  if (!b || !ctx.allowedSiteIds.includes(b.siteId)) throw new DomainError("not_found", "Batch not found.");
  return batchBoxInfo(ctx, b as BatchRow);
}

export type PlanBoxesResult = { batchId: string; planNo: number; pieces: number; boxes: number; replacedPlan: boolean; jobIds: string[]; printHref: string };

/**
 * "Print 13 box labels": plans the boxes from the pieces packed (the product's pieces per box, a part box for the
 * rest), takes a BOX number for each box, freezes the lot number and dates of the batch (as the piece labels do)
 * and makes one label job per box. Same count again = same boxes and jobs; a new count replaces the plan
 * (old labels cancelled or voided, audited). Idempotent on the key. Needs `inventory.label_job.create` and the
 * batch at the caller's site; refused before the packaging step and once the boxes are made at Finish.
 */
export async function planBatchBoxes(ctx: AuthContext, input: { batchId: string; pieces: string | number; idempotencyKey: string }): Promise<PlanBoxesResult> {
  ctx.require("inventory.label_job.create");
  ctx.require("production.batch.view");
  if (!input.idempotencyKey || input.idempotencyKey.length < 8) throw new DomainError("validation", "The form is missing its submission key. Reload the page and try again.");
  const pieces = parsePieces(input.pieces);
  if (pieces === null) throw new DomainError("validation", "How many pieces did you pack? Write a whole number, for example 297.", { field: "pieces", fieldErrors: { pieces: "Write a whole number above 0." } });
  const key = input.idempotencyKey;
  const planned = await db.transaction(async (tx) => {
    const b = await lockBatch(tx, ctx, input.batchId);
    if (b.siteId !== ctx.currentSiteId) throw new DomainError("state", "This batch is at another of your sites. Switch site to print its box labels.");
    const { result } = await idempotent(tx, ctx, key, "production.batch_boxes.plan", async () => {
      const fixed = await fixLabelLotLocked(tx, ctx, b);
      const p = await productOf(tx, b.productId);
      const split = boxSplit(pieces, p.unitsPerBox)!;
      if (split.boxes > MAX_BOXES) throw new DomainError("validation", `That is ${split.boxes} boxes; at most ${MAX_BOXES} box labels at once. Check the number of pieces.`, { field: "pieces", fieldErrors: { pieces: `At most ${MAX_BOXES * p.unitsPerBox} pieces.` } });
      const current = await currentBoxPlan(tx, b.id);
      if (current.some((r) => r.status === "boxed")) throw new DomainError("state", `The boxes of batch ${b.batchNumber} were made at Finish. Change boxes on the box screen (split, merge, repack).`);
      const sameCount = current.length > 0 && current.reduce((t, r) => t + r.pieces, 0) === pieces && current[0].unitsPerBox === p.unitsPerBox;
      if (sameCount) return { planNo: current[0].planNo, replacedPlan: false };
      if (current.length) {
        const was = current.reduce((t, r) => t + r.pieces, 0);
        const reason = `Pieces packed changed from ${was} to ${pieces}`;
        for (const r of current) {
          await tx.update(batchBoxes).set({ status: "replaced", replacedBy: ctx.userId, replacedAt: new Date(), replacedReason: reason }).where(eq(batchBoxes.id, r.id));
          await voidLabelsForEntityInTx(tx, ctx, "batch_box", r.id, `${reason}: box label ${r.containerNumber} replaced. Destroy it if it was printed.`);
        }
        await audit(tx, ctx, { action: "production.batch_boxes.replaced", entityType: "batch", entityId: b.id, entityNumber: b.batchNumber, siteId: b.siteId, reason, before: { pieces: was, boxes: current.map((r) => r.containerNumber) } });
      }
      const [last] = await tx.select({ planNo: batchBoxes.planNo }).from(batchBoxes).where(eq(batchBoxes.batchId, b.id)).orderBy(desc(batchBoxes.planNo)).limit(1);
      const planNo = (last?.planNo ?? 0) + 1;
      const numbers: string[] = [];
      for (const [i, n] of split.sizes.entries()) {
        const number = await nextNumber(tx, ctx.organizationId, "BOX");
        numbers.push(number);
        await tx.insert(batchBoxes).values({ organizationId: ctx.organizationId, siteId: b.siteId, batchId: b.id, planNo, boxNo: i + 1, boxCount: split.boxes, pieces: n, unitsPerBox: p.unitsPerBox, containerNumber: number, createdBy: ctx.userId });
      }
      await audit(tx, ctx, {
        action: "production.batch_boxes.planned",
        entityType: "batch",
        entityId: b.id,
        entityNumber: b.batchNumber,
        siteId: b.siteId,
        after: { planNo, pieces, perBox: p.unitsPerBox, full: split.full, part: split.part, boxes: numbers, lotNumber: fixed.outputLotNumber },
      });
      return { planNo, replacedPlan: current.length > 0 };
    });
    return { ...result, siteId: b.siteId };
  });
  const template = await boxTemplate(db, ctx.organizationId, planned.siteId);
  if (!template) throw new DomainError("state", "No approved box label is set up for this site. Ask QA.", { setup: "label_template" });
  const rows = (await db.select().from(batchBoxes).where(and(eq(batchBoxes.batchId, input.batchId), eq(batchBoxes.planNo, planned.planNo))).orderBy(asc(batchBoxes.boxNo))).filter((r) => r.status !== "replaced");
  const jobIds: string[] = [];
  for (const r of rows) {
    if (r.labelJobId) {
      jobIds.push(r.labelJobId);
      continue;
    }
    let jobId: string;
    try {
      jobId = (await createLabelJob(ctx, { labelTemplateId: template.id, entityType: "batch_box", entityId: r.id, copies: 1, idempotencyKey: `${key}:box:${r.id}` })).jobId;
    } catch (e) {
      const existing = e instanceof DomainError && e.code === "conflict" ? (e.details?.existingJobId as string | undefined) : undefined;
      if (!existing) throw e;
      jobId = existing;
    }
    await db.update(batchBoxes).set({ labelJobId: jobId }).where(eq(batchBoxes.id, r.id));
    jobIds.push(jobId);
  }
  return { batchId: input.batchId, planNo: planned.planNo, pieces, boxes: rows.length, replacedPlan: planned.replacedPlan, jobIds, printHref: `/print/labels/batch-boxes/${input.batchId}` };
}

/** The label jobs of the current box plan, in box order (print page). */
export async function batchBoxPrintJobs(ctx: AuthContext, batchId: string) {
  ctx.require("production.batch.view");
  if (!/^[0-9a-f-]{36}$/i.test(batchId)) throw new DomainError("not_found", "Batch not found in your sites.");
  const [b] = await db.select({ siteId: batches.siteId, workOrderId: batches.workOrderId }).from(batches).where(and(eq(batches.id, batchId), eq(batches.organizationId, ctx.organizationId))).limit(1);
  if (!b || !ctx.allowedSiteIds.includes(b.siteId)) throw new DomainError("not_found", "Batch not found in your sites.");
  const boxes = (await currentBoxPlan(db, batchId)).map((r) => ({ boxId: r.id, boxNo: r.boxNo, boxCount: r.boxCount, pieces: r.pieces, containerNumber: r.containerNumber, jobId: r.labelJobId }));
  return { workOrderId: b.workOrderId, boxes };
}

/**
 * Finish, before anything is posted: the boxes planned must fit the pieces left to sell (good − samples).
 * Returns the planned pieces (0 = no box plan: the pieces stay loose, as before).
 */
export async function assertBoxesFit(tx: Tx, batch: BatchRow, sellable: Decimal): Promise<number> {
  const plan = (await currentBoxPlan(tx, batch.id)).filter((r) => r.status === "planned");
  const total = plan.reduce((t, r) => t + r.pieces, 0);
  if (total > 0 && sellable.lt(total)) {
    const msg = `You printed box labels for ${total} pieces in ${plan.length} boxes, but only ${sellable.toString()} good pieces are left after the samples. Count again, or change "How many pieces did you pack?" and print the box labels again.`;
    throw new DomainError("validation", msg, { field: "goodUnits", fieldErrors: { goodUnits: msg }, rule: "V-BOX" });
  }
  return total;
}

/**
 * Finish, after the finished lot is posted to the hold area: each planned box becomes a sealed box (container)
 * with the BOX number on its label, holding its pieces of the lot, at the hold location (same transaction).
 * Pieces not in a box stay loose at the same place.
 */
export async function makeBatchBoxesLocked(tx: Tx, ctx: AuthContext, batch: BatchRow, posted: { lotId: string; locationId: string; lotNumber: string }) {
  const plan = (await currentBoxPlan(tx, batch.id)).filter((r) => r.status === "planned");
  if (!plan.length) return [];
  const [lot] = await tx.select().from(inventoryLots).where(eq(inventoryLots.id, posted.lotId)).limit(1);
  const made: { containerId: string; containerNumber: string; pieces: number }[] = [];
  for (const r of plan) {
    const partial = r.pieces < r.unitsPerBox;
    const box = await newBox(tx, ctx, { siteId: batch.siteId, locationId: posted.locationId, kind: "box", isPartial: partial, notes: `Batch ${batch.batchNumber} · box ${r.boxNo} of ${r.boxCount}`, containerNumber: r.containerNumber });
    await addContent(tx, box, lot.id, lot.baseUom, new Decimal(r.pieces));
    containerMachine.assert("open", "sealed", `Box ${box.containerNumber}`);
    await tx.update(containers).set({ status: "sealed", updatedAt: new Date() }).where(eq(containers.id, box.id));
    await tx.update(batchBoxes).set({ status: "boxed", containerId: box.id }).where(eq(batchBoxes.id, r.id));
    await audit(tx, ctx, {
      action: "inventory.container.created",
      entityType: "container",
      entityId: box.id,
      entityNumber: box.containerNumber,
      siteId: batch.siteId,
      after: { batchNumber: batch.batchNumber, boxNo: r.boxNo, boxCount: r.boxCount, lotNumber: posted.lotNumber, qtyBase: String(r.pieces), baseUom: lot.baseUom, partial, statusInherited: lot.qualityStatus, source: "finish" },
    });
    made.push({ containerId: box.id, containerNumber: box.containerNumber, pieces: r.pieces });
  }
  return made;
}

/* ------------------------------------------------------------------ left-over wrappers back to the shelf (ADR-106 §4) */

export type LeftOverWrapper = { reconciliationId: string; lotId: string; materialName: string; lotNumber: string; qty: string; uom: string; fromLocationId: string; fromCode: string; toLocationId: string | null; toCode: string | null; returned: boolean };

const returnKey = (reconciliationId: string) => `wrapper-return:${reconciliationId}`;

/**
 * Left-over wrappers counted at Finish (returned_qty) that still sit in the production area: they were moved there
 * at Get materials (a staging transfer), so they go back to the shelf they came from. Wrappers issued straight from
 * the shelf never left it (toLocationId null: nothing to carry back).
 */
export async function leftOverWrappers(q: DbOrTx, batchId: string): Promise<LeftOverWrapper[]> {
  const rows = (await currentPackaging(q, batchId)).filter((x) => x.r.countedAt && new Decimal(x.r.returnedQty ?? 0).gt(0));
  const out: LeftOverWrapper[] = [];
  for (const x of rows) {
    const [st] = await q
      .select({ from: batchMaterialStagings.fromLocationId, code: locations.code })
      .from(batchMaterialStagings)
      .innerJoin(locations, eq(locations.id, batchMaterialStagings.fromLocationId))
      .where(and(eq(batchMaterialStagings.batchId, batchId), eq(batchMaterialStagings.lotId, x.r.lotId), eq(batchMaterialStagings.toLocationId, x.r.fromLocationId)))
      .orderBy(asc(batchMaterialStagings.stagedAt))
      .limit(1);
    const [done] = await q.select({ id: stockMovements.id }).from(stockMovements).where(eq(stockMovements.idempotencyKey, returnKey(x.r.id))).limit(1);
    out.push({ reconciliationId: x.r.id, lotId: x.r.lotId, materialName: x.materialName, lotNumber: x.lotNumber, qty: new Decimal(x.r.returnedQty!).toString(), uom: x.r.baseUom, fromLocationId: x.r.fromLocationId, fromCode: x.locationCode, toLocationId: st?.from ?? null, toCode: st?.code ?? null, returned: !!done });
  }
  return out;
}

/**
 * "Put the 12 left-over wrappers back on shelf PKG-01" (one tap after Finish): a transfer per counted row from the
 * production area to the shelf the wrappers came from, through postMovement (idempotent per row, audited). Needs
 * `production.batch.post` at the batch's site; only after Finish (the left-over count is final).
 */
export async function returnLeftOverWrappers(ctx: AuthContext, input: { batchId: string }) {
  ctx.require("production.batch.post");
  return db.transaction(async (tx) => {
    const b = await lockBatch(tx, ctx, input.batchId);
    if (["planned", "materials_staged", "in_process"].includes(b.status)) throw new DomainError("state", "Finish the batch first: the left-over wrappers are counted there.");
    const items = (await leftOverWrappers(tx, b.id)).filter((x) => x.toLocationId && !x.returned);
    const moved: { materialName: string; qty: string; toCode: string }[] = [];
    for (const x of items) {
      await postMovement(tx, ctx, {
        movementType: "transfer",
        lotId: x.lotId,
        fromLocationId: x.fromLocationId,
        toLocationId: x.toLocationId!,
        qtyBase: x.qty,
        sourceDocumentType: "batch",
        sourceDocumentId: b.id,
        sourceDocumentNumber: b.batchNumber,
        reason: `Left-over ${x.materialName} of batch ${b.batchNumber} back to the shelf`,
        idempotencyKey: returnKey(x.reconciliationId),
        meta: { batchId: b.id, reconciliationId: x.reconciliationId },
      });
      await audit(tx, ctx, { action: "production.packaging_component.returned", entityType: "packaging_reconciliation", entityId: x.reconciliationId, entityNumber: b.batchNumber, siteId: b.siteId, after: { material: x.materialName, lot: x.lotNumber, qty: x.qty, from: x.fromCode, to: x.toCode } });
      moved.push({ materialName: x.materialName, qty: x.qty, toCode: x.toCode! });
    }
    return { moved };
  });
}
