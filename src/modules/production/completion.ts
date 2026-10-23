import "server-only";
import { and, asc, eq } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import { batchMaterials, inventoryLots, locations, processStepRecords, products } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import { nextNumber } from "@/lib/numbering";
import { postMovement } from "@/modules/inventory/ledger";
import { type FormulaSnapshot, addDays, idempotent, lockBatch, manilaToday } from "./shared";
import { transitionBatch } from "./state";

export type CompleteBatchInput = {
  batchId: string;
  /** Finished units counted (pcs). */
  actualUnits: string;
  remarks?: string | null;
  idempotencyKey?: string | null;
};

/**
 * Completes a batch after every checklist step: computes actual output (units × unit net mass)
 * and yield against the theoretical yield, creates the finished-goods lot in quarantine with
 * expiry = today + product shelf life, posts the output movement into the site's quarantine
 * location, links the lot to the batch and moves the batch to awaiting_qc. QA decides release.
 */
export async function completeBatch(ctx: AuthContext, input: CompleteBatchInput) {
  ctx.require("production.batch.submit");

  let units: Decimal;
  try {
    units = new Decimal(input.actualUnits);
  } catch {
    throw new DomainError("validation", "Enter the number of finished units.");
  }
  if (!units.isFinite() || units.lte(0) || !units.isInteger()) throw new DomainError("validation", "Finished units must be a whole number greater than zero.");

  return db.transaction(async (tx) => {
    const b = await lockBatch(tx, ctx, input.batchId);
    const { result } = await idempotent(tx, ctx, input.idempotencyKey, "production.batch.complete", async () => {
      if (b.status !== "in_process") {
        throw new DomainError("state", `Batch ${b.batchNumber} is ${b.status.replace(/_/g, " ")}; only a batch in process can be completed.`);
      }
      const snapshot = b.formulaSnapshot as FormulaSnapshot;
      const done = await tx.select({ stepNo: processStepRecords.stepNo }).from(processStepRecords).where(eq(processStepRecords.batchId, b.id));
      const doneSet = new Set(done.map((d) => d.stepNo));
      const open = snapshot.steps.filter((s) => !doneSet.has(s.stepNo)).sort((a, z) => a.stepNo - z.stepNo);
      if (open.length) throw new DomainError("state", `Complete all checklist steps first (next: step ${open[0].stepNo}, ${open[0].name}).`);
      const pending = await tx.select({ id: batchMaterials.id }).from(batchMaterials).where(and(eq(batchMaterials.batchId, b.id), eq(batchMaterials.status, "pending")));
      if (pending.length) throw new DomainError("state", "Every ingredient must be weighed before the batch can be completed.");

      const [product] = await tx.select().from(products).where(eq(products.id, b.productId)).limit(1);
      if (!product) throw new DomainError("not_found", "Product not found.");
      const [quarantine] = await tx
        .select()
        .from(locations)
        .where(and(eq(locations.siteId, b.siteId), eq(locations.kind, "quarantine"), eq(locations.isActive, true)))
        .orderBy(asc(locations.code))
        .limit(1);
      if (!quarantine) throw new DomainError("state", "This site has no active quarantine location. Ask the site manager to set one up.");

      const outputG = units.mul(product.unitNetMassG);
      const theo = new Decimal(b.theoreticalYieldG ?? 0);
      const yieldPct = theo.gt(0) ? outputG.div(theo).mul(100).toDecimalPlaces(2) : null;
      const today = manilaToday();
      const lotNumber = await nextNumber(tx, ctx.organizationId, "LOT");
      const [lot] = await tx
        .insert(inventoryLots)
        .values({
          organizationId: ctx.organizationId,
          siteId: b.siteId,
          lotNumber,
          itemKind: "product",
          productId: product.id,
          manufacturedOn: today,
          expiresOn: addDays(today, product.shelfLifeDays),
          qualityStatus: "quarantine",
          sourceBatchId: b.id,
          baseUom: product.baseUom,
          createdBy: ctx.userId,
        })
        .returning();

      await postMovement(tx, ctx, {
        movementType: "output",
        lotId: lot.id,
        toLocationId: quarantine.id,
        qtyBase: units,
        sourceDocumentType: "batch",
        sourceDocumentId: b.id,
        sourceDocumentNumber: b.batchNumber,
        reason: `Output of batch ${b.batchNumber} to quarantine pending QA`,
        idempotencyKey: `batch-output:${b.id}`,
      });

      const remarks = input.remarks?.trim() || null;
      const before = { status: b.status };
      await transitionBatch(tx, ctx, b, "awaiting_qc", {
        set: {
          completedAt: new Date(),
          actualUnits: units.toString(),
          actualOutputG: outputG.toString(),
          yieldPct: yieldPct?.toString() ?? null,
          outputLotId: lot.id,
          remarks,
        },
      });
      await audit(tx, ctx, {
        action: "production.batch.completed",
        entityType: "batch",
        entityId: b.id,
        entityNumber: b.batchNumber,
        siteId: b.siteId,
        before,
        after: {
          status: "awaiting_qc",
          actualUnits: units.toString(),
          actualOutputG: outputG.toString(),
          theoreticalYieldG: b.theoreticalYieldG,
          yieldPct: yieldPct?.toString() ?? null,
          outputLot: lotNumber,
          location: quarantine.code,
          remarks,
        },
      });
      return { lotNumber, lotId: lot.id, yieldPct: yieldPct?.toString() ?? null };
    });
    return result;
  });
}
