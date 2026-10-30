import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import Decimal from "decimal.js";
import { type Tx, db } from "@/db/client";
import { batchMaterials, batchOutputs, dispenseRecords, inventoryLots, locations, materials, processStepRecords, products } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import { nextNumber } from "@/lib/numbering";
import { getSetting } from "@/lib/settings";
import { lockLots } from "@/modules/inventory/ledger";
import { assertLocationNotHeld, resolveLocationRef } from "@/modules/inventory/holds";
import { dispensingBlockers } from "./dispensing";
import { executionHooks } from "./execution-hooks";
import { type BatchRow, endEquipmentUses, findStepOfKind, sortedSteps, stepRecord, stepRecords } from "./execution";
import { postBatchMovement, postDispenseConsumption, postPackagingConsumption } from "./execution-postings";
import { currentPackaging, uncountedPackagingBlockers } from "./packaging";
import { type FormulaSnapshot, addDays, idempotent, lockBatch, manilaToday } from "./shared";
import { transitionBatch } from "./state";
import { releaseBatchStagingReservations } from "./staging";
import { syncWorkOrderProgress } from "./work-orders";
import { currentYield, yieldBlockers } from "./yield";
import { batchExpiryDates } from "./flow-facts";

export type PostToQuarantineInput = {
  batchId: string;
  /** The quarantine location scanned at the storage area (BC:LOC payload, code or id). */
  locationRef: string;
  idempotencyKey?: string | null;
};

/** Everything that blocks posting to quarantine, for the transfer screen and the 409. */
export async function transferBlockers(batch: BatchRow): Promise<string[]> {
  const out: string[] = [];
  if (batch.status !== "in_process") out.push(`The batch is ${batch.status.replace(/_/g, " ")}.`);
  const recs = await stepRecords(db, batch.id);
  for (const s of sortedSteps(batch.formulaSnapshot as FormulaSnapshot)) {
    if (s.stepKind === "transfer") continue;
    const r = recs.find((x) => x.stepNo === s.stepNo);
    if (r?.status !== "completed") {
      out.push(`Step ${s.stepNo} (${s.name}) is ${r ? r.status.replace(/_/g, " ") : "not started"}.`);
      break;
    }
  }
  out.push(...(await dispensingBlockers(db, batch)));
  out.push(...(await yieldBlockers(db, batch)));
  out.push(...(await uncountedPackagingBlockers(db, batch.id)));
  return out;
}

/**
 * Transfer to quarantine (W05-17, US-3-13 AC1; checklist line 7). In one transaction, after the
 * checker co-signs and the scanned location is a quarantine location (V-LOC): posts every
 * consumption not yet posted (weighings and packaging components; A-PROC-31), creates the finished
 * lot in quarantine (one lot per batch, A-PROC-21) with expiry = basis date + product shelf life
 * (A-PROC-08), records the batch output and posts the output movement, completes the transfer step,
 * moves the batch in_process → awaiting_qc and calls the quality and work-order hooks (finished
 * product inspection; work order completed when it was the last batch). Every movement goes through
 * postMovement with a production_postings row. Idempotent with the command key.
 */
export async function postBatchToQuarantine(ctx: AuthContext, input: PostToQuarantineInput, signers: { checker?: AuthContext | null } = {}) {
  ctx.require("production.batch.post");
  ctx.require("production.batch.submit");
  ctx.require("production.batch_output.create");
  return db.transaction(async (tx) => {
    const batch = await lockBatch(tx, ctx, input.batchId);
    const { result } = await idempotent(tx, ctx, input.idempotencyKey, "production.batch.post_to_quarantine", () => postBatchToQuarantineLocked(tx, ctx, batch, input, signers));
    return result;
  });
}

/**
 * Body of postBatchToQuarantine for a caller that already holds the batch lock (finishBatch,
 * ADR-080 §6). Lock order as postMovement: batch (caller) → lots in id order → balances.
 * `opts.finishDeviation`: Finish opened a problem report for a yield outside the range or rejects
 * above the threshold; that report replaces the prior approval (QA decides with it, and an open
 * report blocks the pass). The caller checks permissions.
 */
export async function postBatchToQuarantineLocked(
  tx: Tx,
  ctx: AuthContext,
  batch: BatchRow,
  input: Omit<PostToQuarantineInput, "batchId" | "idempotencyKey">,
  signers: { checker?: AuthContext | null } = {},
  opts: { finishDeviation?: boolean } = {},
) {
  if (batch.status !== "in_process") throw new DomainError("state", `Batch ${batch.batchNumber} is ${batch.status.replace(/_/g, " ")}; only a batch in process can be posted to quarantine.`);
  const steps = sortedSteps(batch.formulaSnapshot as FormulaSnapshot);
  const transfer = findStepOfKind(batch, ["transfer"]);
  const recs = await stepRecords(tx, batch.id);
  const open = steps.filter((s) => s.stepKind !== "transfer" && recs.find((r) => r.stepNo === s.stepNo)?.status !== "completed");
  if (open.length) throw new DomainError("state", `Complete all steps first (next: step ${open[0].stepNo}, ${open[0].name}).`, { rule: "V-STATE" });
  const blockers = [...(await dispensingBlockers(tx, batch)), ...(await yieldBlockers(tx, batch, { finishDeviation: opts.finishDeviation })), ...(await uncountedPackagingBlockers(tx, batch.id))];
  if (blockers.length) throw new DomainError("state", blockers.join(" "), { rule: "V-STATE", blockers });

  const checker = signers.checker ?? null;
  if ((transfer?.requiresChecker ?? true) && !checker) throw new DomainError("validation", "The checker must sign the transfer to quarantine.", { field: "checkerId", rule: "V-SOD" });
  if (checker) {
    ctx.assertSeparation(checker.userId === ctx.userId, "The checker must be a different person from the operator.", { rule: "V-SOD" });
    checker.require("production.process_step_record.approve");
    checker.requireSite(batch.siteId);
  }

  const loc = await resolveLocationRef(tx, ctx, batch.siteId, input.locationRef);
  if (loc.kind !== "quarantine") throw new DomainError("validation", `${loc.code} is a ${loc.kind} location. Scan a quarantine location: finished goods wait there for QA.`, { field: "locationRef", rule: "V-LOC" });
  if (!loc.isActive) throw new DomainError("validation", `${loc.code} is not active.`, { field: "locationRef" });
  await assertLocationNotHeld(tx, loc);

  const [product] = await tx.select().from(products).where(eq(products.id, batch.productId)).limit(1);
  if (!product) throw new DomainError("not_found", "Product not found.");
  const y = await currentYield(tx, batch.id);
  if (!y) throw new DomainError("state", "Record the actual output first.");
  const units = new Decimal(y.actualUnits);

  // 1. Consumption not yet posted (A-PROC-31): lock every lot first in id order (no deadlocks).
  const unpostedDispenses = await tx
    .select({ rec: dispenseRecords, materialName: materials.name })
    .from(dispenseRecords)
    .innerJoin(batchMaterials, eq(batchMaterials.id, dispenseRecords.batchMaterialId))
    .innerJoin(materials, eq(materials.id, batchMaterials.materialId))
    .where(and(eq(batchMaterials.batchId, batch.id), isNull(dispenseRecords.voidedAt), isNull(dispenseRecords.productionPostingId)));
  const pkg = (await currentPackaging(tx, batch.id)).filter((p) => !p.r.productionPostingId && p.r.countedAt);
  await lockLots(tx, [...unpostedDispenses.map((d) => d.rec.lotId), ...pkg.map((p) => p.r.lotId)]);
  let consumptionCount = 0;
  for (const d of unpostedDispenses) if (await postDispenseConsumption(tx, ctx, batch, d.rec, d.materialName)) consumptionCount += 1;
  for (const p of pkg) if (await postPackagingConsumption(tx, ctx, batch, p.r, p.materialName)) consumptionCount += 1;

  // 2. Finished lot in quarantine (A-PROC-21, A-PROC-08).
  const basis = await getSetting(tx, ctx.organizationId, "production.output.expiry_basis");
  // ADR-080 §7: one source for the lot, the BMR and the wrap label (batchExpiryDates).
  const { manufacturedOn: mfgDate, expiresOn } = batchExpiryDates(batch, steps, recs, basis, product.shelfLifeDays);
  const lotNumber = await nextNumber(tx, ctx.organizationId, "LOT");
  const [lot] = await tx
    .insert(inventoryLots)
    .values({
      organizationId: ctx.organizationId,
      siteId: batch.siteId,
      lotNumber,
      itemKind: "product",
      productId: product.id,
      manufacturedOn: mfgDate,
      expiresOn,
      qualityStatus: "quarantine",
      sourceBatchId: batch.id,
      baseUom: product.baseUom,
      createdBy: ctx.userId,
    })
    .returning();
  const [out] = await tx
    .insert(batchOutputs)
    .values({
      organizationId: ctx.organizationId,
      siteId: batch.siteId,
      batchId: batch.id,
      lineNo: 1,
      outputKind: "finished",
      productId: product.id,
      qtyBase: units.toString(),
      baseUom: product.baseUom,
      massG: y.actualBase,
      toLocationId: loc.id,
      lotId: lot.id,
      recordedBy: ctx.userId,
      checkedBy: checker?.userId ?? null,
    })
    .returning();
  const outputPosting = await postBatchMovement(tx, ctx, batch, {
    postingType: "output",
    lotId: lot.id,
    qtyBase: units,
    toLocationId: loc.id,
    reason: `Output of batch ${batch.batchNumber} to quarantine pending QA`,
    idempotencyKey: `batch-output:${batch.id}`,
    links: { batchOutputId: out.id },
    meta: { batchOutputId: out.id, location: loc.code },
  });
  await tx.update(batchOutputs).set({ productionPostingId: outputPosting.id }).where(eq(batchOutputs.id, out.id));

  // 3. Transfer step record (checklist line 7), signed by operator and checker.
  const now = new Date();
  if (transfer) {
    const existing = await stepRecord(tx, batch.id, transfer.stepNo);
    if (existing && existing.status === "completed") throw new DomainError("state", "The transfer step is already complete.");
    if (existing) {
      await tx
        .update(processStepRecords)
        .set({ status: "completed", conductedBy: ctx.userId, performedAt: now, completedAt: now, checkedBy: checker?.userId ?? null, checkedAt: checker ? now : null, notes: `Posted to ${loc.code}` })
        .where(eq(processStepRecords.id, existing.id));
      await endEquipmentUses(tx, ctx, batch, existing);
    } else {
      await tx.insert(processStepRecords).values({
        batchId: batch.id,
        routingStepId: transfer.routingStepId,
        stepNo: transfer.stepNo,
        name: transfer.name,
        stepKind: transfer.stepKind,
        area: transfer.area ?? null,
        status: "completed",
        conductedBy: ctx.userId,
        checkedBy: checker?.userId ?? null,
        checkedAt: checker ? now : null,
        startedAt: now,
        performedAt: now,
        completedAt: now,
        notes: `Posted to ${loc.code}`,
      });
    }
  }

  // 4. Batch → awaiting_qc with the output projection.
  const before = { status: batch.status };
  await transitionBatch(tx, ctx, batch, "awaiting_qc", {
    reason: `Posted to quarantine ${loc.code}`,
    set: { completedAt: now, actualUnits: units.toString(), actualOutputG: y.actualBase, yieldPct: y.yieldPct, outputLotId: lot.id },
  });

  // 5. Hooks (same transaction): finished-product inspection (W2C) and work order (W2A).
  const inspection = (await executionHooks().createFinishedProductInspection?.(tx, ctx, { batchId: batch.id, lotId: lot.id, inspectionPlanId: batch.inspectionPlanId, siteId: batch.siteId })) ?? null;
  await executionHooks().onBatchSubmitted?.(tx, ctx, { id: batch.id, batchNumber: batch.batchNumber, siteId: batch.siteId });
  // W2A: staged stock is consumed now, so its batch reservations end; the work order completes with its last batch.
  const stagingReleased = await releaseBatchStagingReservations(tx, ctx, batch.id, `Batch ${batch.batchNumber} posted to quarantine; staged stock consumed`);
  await syncWorkOrderProgress(tx, ctx, batch.workOrderId);

  const base = { entityNumber: batch.batchNumber, siteId: batch.siteId } as const;
  if (consumptionCount) {
    await audit(tx, ctx, { ...base, action: "production.production_posting.consumption_posted", entityType: "batch", entityId: batch.id, after: { postings: consumptionCount } });
  }
  await audit(tx, ctx, {
    ...base,
    action: "production.production_posting.output_posted",
    entityType: "production_posting",
    entityId: outputPosting.id,
    after: { lot: lotNumber, qty: units.toString(), uom: product.baseUom, location: loc.code, expiresOn },
  });
  if (transfer) {
    await audit(tx, ctx, { ...base, action: "production.process_step_record.completed", entityType: "process_step_record", entityId: batch.id, after: { stepNo: transfer.stepNo, name: transfer.name, status: "completed", checker: checker?.displayName ?? null } });
  }
  if (checker) {
    await audit(tx, checker, { ...base, action: "production.process_step_record.checked", entityType: "process_step_record", entityId: batch.id, after: { stepNo: transfer?.stepNo ?? null, name: transfer?.name ?? "Transfer to quarantine", signedOn: "operator_device" } });
  }
  await audit(tx, ctx, {
    ...base,
    action: "production.batch.submitted",
    entityType: "batch",
    entityId: batch.id,
    before,
    after: {
      status: "awaiting_qc",
      actualUnits: units.toString(),
      actualOutputG: y.actualBase,
      theoreticalYieldG: batch.theoreticalYieldG,
      yieldPct: y.yieldPct,
      outputLot: lotNumber,
      location: loc.code,
      expiresOn,
      inspectionId: inspection?.inspectionId ?? null,
      stagingReservationsReleased: stagingReleased,
    },
  });
  return { lotNumber, lotId: lot.id, yieldPct: y.yieldPct, consumptionPostings: consumptionCount, expiresOn, location: loc.code, locationId: loc.id, inspectionId: inspection?.inspectionId ?? null };
}

/** Quarantine locations of a site, for the transfer screen. */
export async function quarantineLocations(ctx: AuthContext, siteId: string) {
  ctx.requireSite(siteId);
  return db
    .select({ id: locations.id, code: locations.code, name: locations.name })
    .from(locations)
    .where(and(eq(locations.siteId, siteId), eq(locations.kind, "quarantine"), eq(locations.isActive, true)))
    .orderBy(locations.code);
}
