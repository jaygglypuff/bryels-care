import "server-only";
import { and, asc, eq } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import { batchMaterials, batchStateTransitions, batches, bomLines, formulaRevisions, formulas, materials, products, routingSteps } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import { nextNumber } from "@/lib/numbering";
import { type FormulaSnapshot, idempotent, lockBatch } from "./shared";
import { transitionBatch } from "./state";

export type CreateBatchInput = {
  formulaRevisionId: string;
  /** Planned batch size in kilograms (decimal string). */
  plannedSizeKg: string;
  /** YYYY-MM-DD */
  plannedStartOn: string;
  idempotencyKey?: string | null;
};

/**
 * Creates a planned batch at the current site in one transaction: allocates the batch number,
 * freezes the approved formula revision into formula_snapshot, scales ingredient requirements to
 * the planned size, computes the theoretical yield, records the first state transition and audits.
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
      const [rev] = await tx
        .select({ rev: formulaRevisions, formula: formulas, product: products })
        .from(formulaRevisions)
        .innerJoin(formulas, eq(formulas.id, formulaRevisions.formulaId))
        .innerJoin(products, eq(products.id, formulas.productId))
        .where(and(eq(formulaRevisions.id, input.formulaRevisionId), eq(formulas.organizationId, ctx.organizationId)))
        .limit(1);
      if (!rev) throw new DomainError("not_found", "Formula revision not found.");
      if (rev.rev.status !== "approved") {
        throw new DomainError("state", `Formula ${rev.formula.code} revision ${rev.rev.revisionNo} is ${rev.rev.status.replace(/_/g, " ")}; only an approved revision can be used for a batch.`);
      }

      const lines = await tx
        .select({ line: bomLines, material: materials })
        .from(bomLines)
        .innerJoin(materials, eq(materials.id, bomLines.materialId))
        .where(eq(bomLines.formulaRevisionId, rev.rev.id))
        .orderBy(asc(bomLines.lineNo));
      const steps = await tx.select().from(routingSteps).where(eq(routingSteps.formulaRevisionId, rev.rev.id)).orderBy(asc(routingSteps.stepNo));
      if (lines.length === 0) throw new DomainError("state", "The formula revision has no ingredient lines.");
      if (steps.length === 0) throw new DomainError("state", "The formula revision has no routing steps.");

      const refSize = new Decimal(rev.rev.referenceBatchSizeG);
      const factor = plannedSizeG.div(refSize);
      const snapshot: FormulaSnapshot = {
        formulaId: rev.formula.id,
        formulaCode: rev.formula.code,
        formulaName: rev.formula.name,
        formulaRevisionId: rev.rev.id,
        revisionNo: rev.rev.revisionNo,
        referenceBatchSizeG: rev.rev.referenceBatchSizeG,
        theoreticalYieldPct: rev.rev.theoreticalYieldPct,
        takenAt: new Date().toISOString(),
        lines: lines.map(({ line, material }) => ({
          bomLineId: line.id,
          lineNo: line.lineNo,
          materialId: material.id,
          materialCode: material.code,
          materialName: material.name,
          inciName: material.inciName,
          quantityG: line.quantityG,
          tolerancePct: line.tolerancePct,
        })),
        steps: steps.map((s) => ({
          routingStepId: s.id,
          stepNo: s.stepNo,
          name: s.name,
          stepKind: s.stepKind,
          instruction: s.instruction,
          requiresChecker: s.requiresChecker,
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
          formulaSnapshot: snapshot,
          plannedSizeG: plannedSizeG.toString(),
          status: "planned",
          plannedStartOn: input.plannedStartOn,
          theoreticalYieldG: theoreticalYieldG.toString(),
          createdBy: ctx.userId,
        })
        .returning();
      await tx.insert(batchMaterials).values(
        lines.map(({ line }) => ({
          batchId: b.id,
          bomLineId: line.id,
          lineNo: line.lineNo,
          materialId: line.materialId,
          theoreticalQtyG: new Decimal(line.quantityG).mul(factor).toDecimalPlaces(6).toString(),
          tolerancePct: line.tolerancePct,
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
    if (b.status !== "planned") throw new DomainError("state", `Batch ${b.batchNumber} is already ${b.status.replace(/_/g, " ")}; only a planned batch can be started.`);
    const before = { status: b.status };
    await transitionBatch(tx, ctx, b, "materials_staged");
    await transitionBatch(tx, ctx, b, "in_process", { set: { startedAt: new Date() } });
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
