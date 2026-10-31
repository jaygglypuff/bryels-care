import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import Decimal from "decimal.js";
import { type DbOrTx, type Tx, db } from "@/db/client";
import { batchMaterialPicks, batchMaterialStagings, batchMaterials, batches, inventoryLots, locations, materials, packagingReconciliations, products, stockReservations } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import { nextNumber } from "@/lib/numbering";
import { getSetting } from "@/lib/settings";
import { activeStationsAt, createLabelJob, labelTemplatesForKind } from "@/modules/documents";
import { lockLots } from "@/modules/inventory";
import { assertLotUsable } from "@/modules/inventory/ledger";
import { assertLocationNotHeld } from "@/modules/inventory/holds";
import { type BatchRow, type SnapshotStep, type StepRecord, sortedSteps, stepRecords } from "./execution";
import { assertStockCovers } from "./execution-postings";
import { batchExpiryDates, currentPicks } from "./flow-facts";
import { currentPackaging, RECONCILED_STEP_KINDS } from "./packaging";
import { expectedPieces } from "./packaging-lines";
import { type FormulaSnapshot, lockBatch } from "./shared";
import { convertReservations, expectedLots } from "./staging";

/**
 * ADR-088 §3, packaging and labels in the flow. The packaging lines of a batch are set aside at approval
 * and taken at "Get materials" like ingredients (src/modules/production/packaging-lines.ts). Here:
 *   - `packagingLinesOf`: per packaging line, the lot taken, its place and what is still to record;
 *   - `issueTakenPackagingLocked`: "Step done" on the packaging step records the issue against the taken
 *     lot without a scan (same rules and rows as `issuePackaging`; reconciliation stays at Finish);
 *   - `batchLabelInfo` / `printBatchLabels`: "Print labels for this batch (N labels)" through the label
 *     job path, with the finished lot number and dates frozen on the batch so Finish posts the same.
 */

export type PackagingPlanLot = { lotId: string; lotNumber: string; locationId: string; locationCode: string; qty: string; reservationIds: string[] };
export type PackagingLineView = {
  batchMaterialId: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  uom: string;
  /** What this batch needs (pieces). */
  qty: string;
  /** Materials list state of the line. */
  picked: "open" | "taken" | "not_needed";
  /** Already recorded on the packaging step (current rows). */
  issued: { lotNumber: string; locationCode: string; qty: string }[];
  issuedQty: string;
  /** What "Step done" records: the taken lot first, then the other set-aside lots, up to what is still needed. */
  plan: PackagingPlanLot[];
};

export async function packagingLinesOf(q: DbOrTx, batch: Pick<BatchRow, "id" | "workOrderId">): Promise<PackagingLineView[]> {
  const lines = await q
    .select({ bm: batchMaterials, m: materials })
    .from(batchMaterials)
    .innerJoin(materials, eq(materials.id, batchMaterials.materialId))
    .where(and(eq(batchMaterials.batchId, batch.id), eq(materials.materialKind, "packaging")))
    .orderBy(asc(batchMaterials.lineNo));
  if (!lines.length) return [];
  const picks = currentPicks(await q.select().from(batchMaterialPicks).where(eq(batchMaterialPicks.batchId, batch.id)));
  const issuedRows = await currentPackaging(q, batch.id);
  const out: PackagingLineView[] = [];
  for (const { bm, m } of lines) {
    const pick = picks.get(bm.id);
    const picked = !pick || pick.action === "untaken" ? "open" : (pick.action as "taken" | "not_needed");
    const issued = issuedRows.filter((x) => x.r.materialId === m.id);
    const issuedQty = issued.reduce((t, x) => t.plus(x.r.issuedQty), new Decimal(0));
    let need = Decimal.max(new Decimal(bm.theoreticalQtyG).minus(issuedQty), 0);
    // Places to take from: the staging move of the tick (stock moved to the production area), then the
    // order's set-aside lots (the taken lot first).
    const cands: Omit<PackagingPlanLot, "qty">[] = [];
    const caps: Decimal[] = [];
    if (pick?.stagingId) {
      const [st] = await q
        .select({ s: batchMaterialStagings, lotNumber: inventoryLots.lotNumber, code: locations.code })
        .from(batchMaterialStagings)
        .innerJoin(inventoryLots, eq(inventoryLots.id, batchMaterialStagings.lotId))
        .innerJoin(locations, eq(locations.id, batchMaterialStagings.toLocationId))
        .where(eq(batchMaterialStagings.id, pick.stagingId))
        .limit(1);
      if (st) {
        cands.push({ lotId: st.s.lotId, lotNumber: st.lotNumber, locationId: st.s.toLocationId, locationCode: st.code, reservationIds: [] });
        caps.push(new Decimal(st.s.qtyBase));
      }
    }
    const exp = batch.workOrderId ? await expectedLots(q, batch.workOrderId, m.id) : [];
    const ordered = pick?.lotId ? [...exp.filter((x) => x.r.lotId === pick.lotId), ...exp.filter((x) => x.r.lotId !== pick.lotId)] : exp;
    for (const x of ordered) {
      const same = cands.findIndex((c) => c.lotId === x.r.lotId && c.locationId === x.r.locationId);
      if (same >= 0) {
        cands[same].reservationIds.push(x.r.id);
        caps[same] = caps[same].plus(x.r.qtyBase);
      } else {
        cands.push({ lotId: x.r.lotId, lotNumber: x.lotNumber, locationId: x.r.locationId, locationCode: x.locationCode, reservationIds: [x.r.id] });
        caps.push(new Decimal(x.r.qtyBase));
      }
    }
    const plan: PackagingPlanLot[] = [];
    for (const [i, c] of cands.entries()) {
      if (need.lte(0)) break;
      const take = Decimal.min(need, caps[i]);
      if (take.lte(0)) continue;
      plan.push({ ...c, qty: take.toString() });
      need = need.minus(take);
    }
    out.push({
      batchMaterialId: bm.id,
      materialId: m.id,
      materialCode: m.code,
      materialName: m.name,
      uom: m.baseUom,
      qty: new Decimal(bm.theoreticalQtyG).toString(),
      picked,
      issued: issued.map((x) => ({ lotNumber: x.lotNumber, locationCode: x.locationCode, qty: new Decimal(x.r.issuedQty).toString() })),
      issuedQty: issuedQty.toString(),
      plan,
    });
  }
  return out;
}

/**
 * Records the packaging issue of the step from the lots taken at "Get materials" (no scan). Same rules and
 * rows as `issuePackaging` (usable lot, place not on hold, stock free of other unposted claims); the
 * order's set-aside quantity of that lot is converted, as a weighing does (A-PF2-21). The caller holds
 * the batch lock and opened the step. Returns how many rows were recorded.
 */
export async function issueTakenPackagingLocked(tx: Tx, ctx: AuthContext, batch: BatchRow, step: SnapshotStep, rec: StepRecord): Promise<number> {
  if (!(RECONCILED_STEP_KINDS as readonly string[]).includes(step.stepKind)) return 0;
  const lines = await packagingLinesOf(tx, batch);
  const todo = lines.flatMap((l) => l.plan.map((p) => ({ line: l, p })));
  if (!todo.length) return 0;
  await lockLots(tx, todo.map((t) => t.p.lotId));
  let n = 0;
  for (const { line, p } of todo) {
    const [lot] = await tx.select().from(inventoryLots).where(eq(inventoryLots.id, p.lotId)).limit(1);
    if (!lot || lot.siteId !== batch.siteId) throw new DomainError("not_found", `Lot ${p.lotNumber} is not at this batch's site.`);
    try {
      assertLotUsable(lot);
    } catch (e) {
      const why = e instanceof DomainError ? e.message.replace(/\.$/, "") : "it cannot be used now";
      throw new DomainError("blocked_lot", `${line.materialName} lot ${lot.lotNumber} cannot be used now (${why}). Ask QA which lot to use instead.`, { rule: "V-HOLD", lotNumber: lot.lotNumber });
    }
    const [loc] = await tx.select().from(locations).where(eq(locations.id, p.locationId)).limit(1);
    await assertLocationNotHeld(tx, loc);
    const qty = new Decimal(p.qty);
    await assertStockCovers(tx, lot, loc, qty);
    const [row] = await tx
      .insert(packagingReconciliations)
      .values({
        organizationId: ctx.organizationId,
        siteId: batch.siteId,
        batchId: batch.id,
        processStepRecordId: rec.id,
        materialId: line.materialId,
        lotId: lot.id,
        fromLocationId: loc.id,
        baseUom: lot.baseUom,
        issuedQty: qty.toString(),
        issuedBy: ctx.userId,
      })
      .returning();
    if (p.reservationIds.length) {
      const rs = await tx.select().from(stockReservations).where(and(inArray(stockReservations.id, p.reservationIds), eq(stockReservations.status, "active")));
      if (rs.length) await convertReservations(tx, ctx, rs, qty, `Used for packaging of batch ${batch.batchNumber}`, "converted");
    }
    await audit(tx, ctx, {
      action: "production.packaging_component.issued",
      entityType: "packaging_reconciliation",
      entityId: row.id,
      entityNumber: batch.batchNumber,
      siteId: batch.siteId,
      after: { stepNo: step.stepNo, material: line.materialCode, lot: lot.lotNumber, location: loc.code, issued: qty.toString(), uom: lot.baseUom, source: "materials_list", picked: line.picked },
    });
    n += 1;
  }
  return n;
}

/* ------------------------------------------------------------------ product labels of the batch */

const LABEL_STATES = ["in_process", "awaiting_qc", "quarantined"];

/**
 * Printing fixes the finished lot number, made date and expiry (ADR-092), so it is allowed only once the
 * batch has reached its packaging step: every step before the first packaging / filling step is done
 * (2026-10-31 audit: the button was live while the batch was still at weighing). A batch without a
 * packaging step may print once every step except Finish is done. Pure: returns the reason, or null.
 */
export function labelPrintBlocker(steps: { stepNo: number; stepKind: string; name: string }[], recs: { stepNo: number; status: string }[]): string | null {
  const ordered = [...steps].sort((a, z) => a.stepNo - z.stepNo);
  const pk = ordered.find((s) => (RECONCILED_STEP_KINDS as readonly string[]).includes(s.stepKind));
  const before = pk ? ordered.filter((s) => s.stepNo < pk.stepNo) : ordered.filter((s) => s.stepKind !== "transfer");
  const open = before.find((s) => !["completed", "skipped"].includes(recs.find((r) => r.stepNo === s.stepNo)?.status ?? ""));
  if (!open) return null;
  return pk ? `Labels are printed on the step "${pk.name}". Finish "${open.name}" first.` : `Labels are printed when every making step is done. Finish "${open.name}" first.`;
}

async function batchLabelTemplate(q: DbOrTx, organizationId: string, siteId: string) {
  const code = (await getSetting(q, organizationId, "production.packaging.batch_label_template", siteId)).trim().toUpperCase();
  // ADR-099: the product label (kind `product`) goes on each bar; an approved finished-goods label is the fallback.
  const all = await labelTemplatesForKind(q, organizationId, siteId, "product");
  return (code ? all.find((t) => t.code === code) : null) ?? all[0] ?? null;
}

/** What the "Print labels for this batch" button needs (null fields explain why it cannot print). */
export async function batchLabelInfo(ctx: AuthContext, batch: BatchRow) {
  const [p] = await db.select().from(products).where(eq(products.id, batch.productId)).limit(1);
  const pieces = p ? expectedPieces(batch.plannedSizeG, (batch.formulaSnapshot as FormulaSnapshot).theoreticalYieldPct, p.unitNetMassG) : new Decimal(0);
  const template = await batchLabelTemplate(db, ctx.organizationId, batch.siteId);
  const stations = await activeStationsAt(db, ctx.organizationId, batch.siteId);
  const canPrint = ctx.can("inventory.label_job.create") && LABEL_STATES.includes(batch.status);
  const stepGate = batch.status === "in_process" && !batch.outputLotNumber ? labelPrintBlocker(sortedSteps(batch.formulaSnapshot as FormulaSnapshot), await stepRecords(db, batch.id)) : null;
  const why = !ctx.can("inventory.label_job.create")
    ? "You cannot print labels. Ask the supervisor."
    : !LABEL_STATES.includes(batch.status)
      ? "Labels are printed once the batch is being made."
      : stepGate
        ? stepGate
      : !template
        ? "No approved product label is set up for this site. Ask the site manager (Settings › Labels)."
        : !stations.length
          ? "No label printer is set up for this site. Ask the administrator (Settings › Labels and printouts)."
          : null;
  return {
    defaultCount: Math.max(1, Math.min(999, pieces.toNumber() || 1)),
    lotNumber: batch.outputLotNumber,
    expiresOn: batch.outputExpiresOn,
    template: template ? { id: template.id, code: template.code, name: template.name } : null,
    canPrint: canPrint && !why,
    why,
  };
}

/**
 * "Print labels for this batch (N labels)": freezes the finished lot number, made date and expiry on the
 * batch the first time (audited), then creates ONE label job of N copies for the batch through the label
 * job path (station queue, print page, controlled reprint). A second press with the same content returns
 * the existing job (a new copy needs Reprint with a reason on the label job). Idempotent on the key.
 */
export async function printBatchLabels(ctx: AuthContext, input: { batchId: string; copies: number | string; printStationId?: string | null; idempotencyKey: string }) {
  ctx.require("inventory.label_job.create");
  const copies = Number(String(input.copies).trim());
  if (!Number.isInteger(copies) || copies < 1 || copies > 999) throw new DomainError("validation", "Enter how many labels: a whole number from 1 to 999.", { field: "copies", fieldErrors: { copies: "1 to 999." } });
  const batch = await db.transaction(async (tx) => {
    const b = await lockBatch(tx, ctx, input.batchId);
    if (!LABEL_STATES.includes(b.status)) throw new DomainError("state", `Batch ${b.batchNumber} is ${b.status.replace(/_/g, " ")}. Labels are printed while the batch is being made or waiting for QA.`);
    if (b.outputLotNumber) return b;
    // Printing fixes lot and dates: only from the packaging step on (labelPrintBlocker).
    const gate = b.status === "in_process" ? labelPrintBlocker(sortedSteps(b.formulaSnapshot as FormulaSnapshot), await stepRecords(tx, b.id)) : null;
    if (gate) throw new DomainError("state", gate, { rule: "V-STATE" });
    const [product] = await tx.select().from(products).where(eq(products.id, b.productId)).limit(1);
    const basis = await getSetting(tx, ctx.organizationId, "production.output.expiry_basis");
    const dates = batchExpiryDates(b, sortedSteps(b.formulaSnapshot as FormulaSnapshot), await stepRecords(tx, b.id), basis, product.shelfLifeDays);
    const lotNumber = await nextNumber(tx, ctx.organizationId, "LOT");
    const [u] = await tx.update(batches).set({ outputLotNumber: lotNumber, outputManufacturedOn: dates.manufacturedOn, outputExpiresOn: dates.expiresOn }).where(eq(batches.id, b.id)).returning();
    await audit(tx, ctx, {
      action: "production.batch.label_lot_fixed",
      entityType: "batch",
      entityId: b.id,
      entityNumber: b.batchNumber,
      siteId: b.siteId,
      after: { lotNumber, manufacturedOn: dates.manufacturedOn, expiresOn: dates.expiresOn, basis: dates.basis },
    });
    return u;
  });
  const template = await batchLabelTemplate(db, ctx.organizationId, batch.siteId);
  if (!template) throw new DomainError("state", "No approved product label is set up for this site. Ask the site manager.", { setup: "label_template" });
  try {
    const r = await createLabelJob(ctx, { labelTemplateId: template.id, entityType: "batch", entityId: batch.id, copies, printStationId: input.printStationId ?? null, idempotencyKey: input.idempotencyKey });
    return { jobId: r.jobId, lotNumber: batch.outputLotNumber!, expiresOn: batch.outputExpiresOn!, copies, alreadyPrinted: false };
  } catch (e) {
    const existing = e instanceof DomainError && e.code === "conflict" ? (e.details?.existingJobId as string | undefined) : undefined;
    if (existing) return { jobId: existing, lotNumber: batch.outputLotNumber!, expiresOn: batch.outputExpiresOn!, copies, alreadyPrinted: true };
    throw e;
  }
}
