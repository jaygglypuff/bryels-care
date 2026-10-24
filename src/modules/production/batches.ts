import "server-only";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import { batchMaterials, batchStateTransitions, batches } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import { nextNumber } from "@/lib/numbering";
import { getEffectiveRouting, getInspectionPlan, isEffectiveOn, loadFormulaRevisionForSnapshot } from "@/modules/masterdata";
import { type FormulaSnapshot, idempotent, lockBatch } from "./shared";
import { transitionBatch } from "./state";
import { assertWorkOrderAcceptsBatch, syncWorkOrderProgress } from "./work-orders";
import { getSetting } from "@/lib/settings";

export type CreateBatchInput = {
  formulaRevisionId: string;
  /** Planned batch size in kilograms (decimal string). */
  plannedSizeKg: string;
  /** YYYY-MM-DD */
  plannedStartOn: string;
  /** Work order the batch executes (W2A, US-3-06); use createBatchFromWorkOrder. */
  workOrderId?: string | null;
  idempotencyKey?: string | null;
};

/**
 * Creates a planned batch at the current site in one transaction: checks the chosen formula
 * revision is approved and effective on the planned start date (V-REV), resolves the routing
 * revision and finished-product inspection plan effective on that date, allocates the batch
 * number, freezes all of them into formula_snapshot (plus the revision ids), scales ingredient
 * requirements to the planned size, records the first state transition and audits.
 */
export async function createBatch(ctx: AuthContext, input: CreateBatchInput): Promise<{ batchId: string; batchNumber: string }> {
  ctx.require("production.batch.create");
  const siteId = ctx.currentSiteId;
  ctx.requireSite(siteId);

  let sizeKg: Decimal;
  try {
    sizeKg = new Decimal(input.plannedSizeKg);
  } catch {
    throw new DomainError("validation", "Enter the planned batch size in kg.");
  }
  if (!sizeKg.isFinite() || sizeKg.lte(0)) throw new DomainError("validation", "Planned batch size must be greater than zero.");
  if (sizeKg.decimalPlaces() > 3) throw new DomainError("validation", "Planned batch size can have at most 3 decimals (grams).");
  const plannedSizeG = sizeKg.mul(1000);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.plannedStartOn) || Number.isNaN(Date.parse(input.plannedStartOn))) {
    throw new DomainError("validation", "Enter a valid planned start date.");
  }

  return db.transaction(async (tx) => {
    const { result } = await idempotent(tx, ctx, input.idempotencyKey, "production.batch.create", async () => {
      // W2A (US-3-06, W05-03): batches come from work orders; direct creation only while the transition setting allows it.
      if (!input.workOrderId && !(await getSetting(tx, ctx.organizationId, "production.batch.allow_without_work_order", siteId))) {
        throw new DomainError("validation", "Batches are created from a planned or released work order. Open the work order and choose Create batch.");
      }
      const rev = await loadFormulaRevisionForSnapshot(tx, ctx.organizationId, input.formulaRevisionId);
      if (!rev) throw new DomainError("not_found", "Formula revision not found.");
      const revLabel = `Formula ${rev.formula.code} revision ${rev.rev.revisionNo}`;
      if (rev.rev.status !== "approved") {
        throw new DomainError("state", `${revLabel} is ${rev.rev.status.replace(/_/g, " ")}; only an approved revision can be used for a batch.`);
      }
      // V-REV: the revision must be effective on the planned start date (docs/process-maps.md §1.5).
      if (!isEffectiveOn(rev.rev, input.plannedStartOn)) {
        const range = `${rev.rev.effectiveFrom ?? "?"}${rev.rev.effectiveTo ? ` until ${rev.rev.effectiveTo}` : " onwards"}`;
        throw new DomainError("validation", `${revLabel} is not effective on ${input.plannedStartOn} (effective ${range}). Choose the revision effective on that date.`, {
          rule: "V-REV",
          fieldErrors: { plannedStartOn: "No effective revision on this date." },
        });
      }
      const routing = await getEffectiveRouting(ctx, rev.product.id, input.plannedStartOn, { tx });
      if (!routing) {
        throw new DomainError("validation", `${rev.product.name} has no approved routing effective on ${input.plannedStartOn}. A routing revision must be approved first (V-REV).`, { rule: "V-REV" });
      }
      const wo = input.workOrderId
        ? await assertWorkOrderAcceptsBatch(tx, ctx, input.workOrderId, { siteId, formulaRevisionId: rev.rev.id, routingRevisionId: routing.rev.id, plannedSizeG, plannedStartOn: input.plannedStartOn })
        : null;
      const plan = await getInspectionPlan(ctx, { planKind: "finished_product", productId: rev.product.id, date: input.plannedStartOn }, { tx });
      const { lines } = rev;
      const steps = routing.steps;
      if (lines.length === 0) throw new DomainError("state", "The formula revision has no ingredient lines.");
      if (steps.length === 0) throw new DomainError("state", "The routing revision has no steps.");

      const refSize = new Decimal(rev.rev.referenceBatchSizeG);
      const factor = plannedSizeG.div(refSize);
      // Proportional lines scale with the batch size; fixed lines copy (docs/data-model.md §4.4).
      const scaled = lines.map(({ line, material }) => {
        const target = line.scaling === "fixed" ? new Decimal(line.quantityG) : new Decimal(line.quantityG).mul(factor).toDecimalPlaces(6);
        // For an absolute tolerance the stored percentage is only the display equivalent.
        const pct = line.toleranceAbsG !== null ? (target.gt(0) ? new Decimal(line.toleranceAbsG).div(target).mul(100).toDecimalPlaces(6) : new Decimal(0)) : new Decimal(line.tolerancePct ?? 0);
        return { line, material, target, pct };
      });
      const snapshot: FormulaSnapshot = {
        schemaVersion: "bom_snapshot/v2",
        formulaId: rev.formula.id,
        formulaCode: rev.formula.code,
        formulaName: rev.formula.name,
        formulaRevisionId: rev.rev.id,
        revisionNo: rev.rev.revisionNo,
        effectiveFrom: rev.rev.effectiveFrom,
        referenceBatchSizeG: rev.rev.referenceBatchSizeG,
        theoreticalYieldPct: rev.rev.theoreticalYieldPct,
        takenAt: new Date().toISOString(),
        routing: {
          routingId: routing.routing.id,
          routingCode: routing.routing.code,
          routingName: routing.routing.name,
          routingRevisionId: routing.rev.id,
          revisionNo: routing.rev.revisionNo,
          effectiveFrom: routing.rev.effectiveFrom,
        },
        inspectionPlan: plan
          ? {
              id: plan.plan.id,
              code: plan.plan.code,
              revisionNo: plan.plan.revisionNo,
              isPlaceholder: plan.plan.isPlaceholder,
              tests: plan.tests.map((t) => ({ testCode: t.testCode, name: t.name, valueKind: t.valueKind, uom: t.uom, specMin: t.specMin, specMax: t.specMax, specText: t.specText, isRequired: t.isRequired })),
            }
          : null,
        lines: scaled.map(({ line, material, target, pct }) => ({
          bomLineId: line.id,
          lineNo: line.lineNo,
          materialId: material.id,
          materialCode: material.code,
          materialName: material.name,
          inciName: material.inciName,
          quantityG: line.quantityG,
          tolerancePct: pct.toString(),
          toleranceAbsG: line.toleranceAbsG,
          scaling: line.scaling,
          phaseCode: line.phaseCode,
          targetQtyG: target.toString(),
          requiresChecker: line.requiresChecker,
        })),
        steps: steps.map((s) => ({
          routingStepId: s.id,
          stepNo: s.stepNo,
          name: s.name,
          stepKind: s.stepKind,
          area: s.area,
          instruction: s.instruction,
          requiresChecker: s.requiresChecker,
          requiresEquipment: s.requiresEquipment,
          equipmentKind: s.equipmentKind,
          workInstruction: s.workInstruction
            ? { code: s.workInstruction.code, name: s.workInstruction.name, revisionNo: s.workInstruction.revisionNo, revisionId: s.workInstruction.revisionId, bodyMarkdown: s.workInstruction.bodyMarkdown }
            : null,
          parameters: s.parameters.map((p) => ({ id: p.id, code: p.code, name: p.name, valueKind: p.valueKind, uom: p.uom, minValue: p.minValue, targetValue: p.targetValue, maxValue: p.maxValue, isRequired: p.isRequired })),
          checklistItems: s.checklistItems.map((c) => ({ id: c.id, itemNo: c.itemNo, text: c.text, requiresPhoto: c.requiresPhoto, isBlocking: c.isBlocking })),
        })),
      };
      const theoreticalYieldG = plannedSizeG.mul(rev.rev.theoreticalYieldPct).div(100).toDecimalPlaces(6);

      const batchNumber = await nextNumber(tx, ctx.organizationId, "BATCH");
      const [b] = await tx
        .insert(batches)
        .values({
          organizationId: ctx.organizationId,
          siteId,
          batchNumber,
          productId: rev.product.id,
          formulaRevisionId: rev.rev.id,
          routingRevisionId: routing.rev.id,
          inspectionPlanId: plan?.plan.id ?? null,
          formulaSnapshot: snapshot,
          plannedSizeG: plannedSizeG.toString(),
          status: "planned",
          plannedStartOn: input.plannedStartOn,
          theoreticalYieldG: theoreticalYieldG.toString(),
          workOrderId: wo?.id ?? null,
          createdBy: ctx.userId,
        })
        .returning();
      await tx.insert(batchMaterials).values(
        scaled.map(({ line, target, pct }) => ({
          batchId: b.id,
          bomLineId: line.id,
          lineNo: line.lineNo,
          materialId: line.materialId,
          theoreticalQtyG: target.toString(),
          tolerancePct: pct.toString(),
          toleranceAbsG: line.toleranceAbsG,
        })),
      );
      await tx.insert(batchStateTransitions).values({ batchId: b.id, fromState: null, toState: "planned", actorId: ctx.userId });
      await audit(tx, ctx, {
        action: "production.batch.created",
        entityType: "batch",
        entityId: b.id,
        entityNumber: batchNumber,
        siteId,
        after: {
          product: rev.product.skuCode,
          formula: `${rev.formula.code} rev ${rev.rev.revisionNo}`,
          plannedSizeG: plannedSizeG.toString(),
          plannedStartOn: input.plannedStartOn,
          theoreticalYieldG: theoreticalYieldG.toString(),
          workOrder: wo?.workOrderNumber ?? null,
        },
      });
      await audit(tx, ctx, {
        action: "production.batch.revisions_snapshotted",
        entityType: "batch",
        entityId: b.id,
        entityNumber: batchNumber,
        siteId,
        after: {
          formulaRevision: `${rev.formula.code} rev ${rev.rev.revisionNo}`,
          routingRevision: `${routing.routing.code} rev ${routing.rev.revisionNo}`,
          inspectionPlan: plan ? `${plan.plan.code} rev ${plan.plan.revisionNo}` : null,
        },
      });
      return { batchId: b.id, batchNumber };
    });
    return result;
  });
}

/**
 * Starts a planned batch: planned → materials_staged → in_process (two recorded transitions,
 * matching the paper flow where staging precedes the first line clearance). Sets startedAt.
 */
export async function startBatch(ctx: AuthContext, batchId: string): Promise<{ batchNumber: string }> {
  ctx.require("production.batch.edit");
  return db.transaction(async (tx) => {
    const b = await lockBatch(tx, ctx, batchId);
    // W2A: a work-order batch starts only after its materials are staged by scan (W05-05).
    if (b.workOrderId && b.status === "planned") throw new DomainError("state", `Stage the materials of batch ${b.batchNumber} first: scan the reserved lots to the staging location.`);
    if (b.status !== "planned" && b.status !== "materials_staged") throw new DomainError("state", `Batch ${b.batchNumber} is already ${b.status.replace(/_/g, " ")}; only a planned or staged batch can be started.`);
    const before = { status: b.status };
    if (b.status === "planned") await transitionBatch(tx, ctx, b, "materials_staged");
    await transitionBatch(tx, ctx, b, "in_process", { set: { startedAt: new Date() } });
    await syncWorkOrderProgress(tx, ctx, b.workOrderId);
    await audit(tx, ctx, {
      action: "production.batch.started",
      entityType: "batch",
      entityId: b.id,
      entityNumber: b.batchNumber,
      siteId: b.siteId,
      before,
      after: { status: "in_process" },
    });
    return { batchNumber: b.batchNumber };
  });
}
