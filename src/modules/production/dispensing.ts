import "server-only";
import { and, eq } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import { batchMaterials, dispenseRecords, inventoryLots, locations, materials } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import { assertLotUsable, postMovement } from "@/modules/inventory/ledger";
import { assertChecker, idempotent, lockBatch } from "./shared";

export type DispenseInput = {
  batchId: string;
  batchMaterialId: string;
  lotId: string;
  fromLocationId: string;
  actualQtyG: string;
  scaleCode?: string | null;
  checkerId: string;
  exceptionReason?: string | null;
  idempotencyKey?: string | null;
};

/**
 * Tolerance window for a theoretical quantity. An absolute tolerance (g) from the BOM line takes
 * precedence over the percentage (tolerances are process-owner configuration, A-PROC-03).
 */
export function toleranceRange(theoreticalQtyG: Decimal.Value, tolerancePct: Decimal.Value, toleranceAbsG?: Decimal.Value | null) {
  const theo = new Decimal(theoreticalQtyG);
  const band = toleranceAbsG !== null && toleranceAbsG !== undefined ? new Decimal(toleranceAbsG) : theo.mul(tolerancePct).div(100);
  return { min: theo.minus(band), max: theo.plus(band) };
}

/**
 * Records one weighing of a batch ingredient: validates lot identity and usability, separation of
 * duties (checker ≠ operator) and tolerance (outside tolerance requires an exception reason and is
 * flagged), then in one transaction writes the dispense record, posts the consumption movement
 * from the lot/location through the ledger, updates the batch material and audits.
 */
export async function recordDispense(ctx: AuthContext, input: DispenseInput) {
  ctx.require("production.dispense_record.create");

  let actual: Decimal;
  try {
    actual = new Decimal(input.actualQtyG);
  } catch {
    throw new DomainError("validation", "Enter the actual weight in grams.");
  }
  if (!actual.isFinite() || actual.lte(0)) throw new DomainError("validation", "Actual weight must be greater than zero.");
  if (actual.decimalPlaces() > 3) throw new DomainError("validation", "Actual weight can have at most 3 decimals.");

  return db.transaction(async (tx) => {
    const b = await lockBatch(tx, ctx, input.batchId);
    const { result } = await idempotent(tx, ctx, input.idempotencyKey, "production.dispense_record.create", async () => {
      if (b.status !== "in_process") {
        throw new DomainError("state", `Batch ${b.batchNumber} is ${b.status.replace(/_/g, " ")}. Weighing is only possible while the batch is in process.`);
      }
      const [row] = await tx
        .select({ bm: batchMaterials, material: materials })
        .from(batchMaterials)
        .innerJoin(materials, eq(materials.id, batchMaterials.materialId))
        .where(and(eq(batchMaterials.id, input.batchMaterialId), eq(batchMaterials.batchId, b.id)))
        .for("update", { of: batchMaterials })
        .limit(1);
      if (!row) throw new DomainError("not_found", "Ingredient line not found on this batch.");
      const { bm, material } = row;
      if (bm.status !== "pending") {
        throw new DomainError("state", `${material.name} has already been weighed for batch ${b.batchNumber}.`);
      }

      const checker = await assertChecker(tx, ctx, b.siteId, input.checkerId);

      const [lot] = await tx
        .select()
        .from(inventoryLots)
        .where(and(eq(inventoryLots.id, input.lotId), eq(inventoryLots.organizationId, ctx.organizationId)))
        .limit(1);
      if (!lot || lot.siteId !== b.siteId) throw new DomainError("not_found", "Lot not found at this site.");
      if (lot.itemKind !== "material" || lot.materialId !== bm.materialId) {
        throw new DomainError("blocked_lot", `Lot ${lot.lotNumber} is not ${material.name} (${material.code}). Choose a ${material.name} lot.`);
      }
      assertLotUsable(lot);

      const [loc] = await tx
        .select()
        .from(locations)
        .where(and(eq(locations.id, input.fromLocationId), eq(locations.siteId, b.siteId)))
        .limit(1);
      if (!loc) throw new DomainError("not_found", "Source location not found at this site.");

      const { min, max } = toleranceRange(bm.theoreticalQtyG, bm.tolerancePct, bm.toleranceAbsG);
      const within = actual.gte(min) && actual.lte(max);
      const reason = input.exceptionReason?.trim() || null;
      if (!within && !reason) {
        throw new DomainError(
          "out_of_tolerance",
          `${actual.toString()} g is outside the tolerance ${min.toDecimalPlaces(1).toString()}–${max.toDecimalPlaces(1).toString()} g. Re-weigh, or enter an exception reason to record it as a flagged exception.`,
        );
      }

      const [rec] = await tx
        .insert(dispenseRecords)
        .values({
          batchMaterialId: bm.id,
          lotId: lot.id,
          fromLocationId: loc.id,
          actualQtyG: actual.toString(),
          isWithinTolerance: within,
          scaleCode: input.scaleCode?.trim() || null,
          operatorId: ctx.userId,
          checkerId: checker.id,
          exceptionReason: within ? null : reason,
        })
        .returning();

      await postMovement(tx, ctx, {
        movementType: "consumption",
        lotId: lot.id,
        fromLocationId: loc.id,
        qtyBase: actual,
        sourceDocumentType: "batch",
        sourceDocumentId: b.id,
        sourceDocumentNumber: b.batchNumber,
        reason: `Dispensed ${material.name} for batch ${b.batchNumber}`,
        idempotencyKey: `dispense:${rec.id}`,
        meta: { dispenseRecordId: rec.id, batchMaterialId: bm.id },
      });

      const newStatus = within ? "dispensed" : "exception";
      await tx
        .update(batchMaterials)
        .set({ dispensedQtyG: new Decimal(bm.dispensedQtyG).plus(actual).toString(), status: newStatus })
        .where(eq(batchMaterials.id, bm.id));

      await audit(tx, ctx, {
        action: "production.dispense_record.created",
        entityType: "dispense_record",
        entityId: rec.id,
        entityNumber: b.batchNumber,
        siteId: b.siteId,
        reason: within ? null : reason,
        before: { status: bm.status, dispensedQtyG: bm.dispensedQtyG },
        after: {
          batchId: b.id,
          material: material.code,
          lot: lot.lotNumber,
          location: loc.code,
          theoreticalQtyG: bm.theoreticalQtyG,
          actualQtyG: actual.toString(),
          withinTolerance: within,
          checker: checker.displayName,
          status: newStatus,
        },
      });
      return { dispenseRecordId: rec.id, materialName: material.name, withinTolerance: within };
    });
    return result;
  });
}
