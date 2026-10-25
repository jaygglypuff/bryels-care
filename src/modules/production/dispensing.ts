import "server-only";
import { and, eq, inArray, isNull, gt, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { type DbOrTx, db } from "@/db/client";
import { batchMaterials, dispenseRecords, inventoryBalances, inventoryLots, locations, materials, productionPostings, stockReservations } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import { getSetting } from "@/lib/settings";
import { assertLotUsable } from "@/modules/inventory/ledger";
import { assertLocationNotHeld, resolveLotRef } from "@/modules/inventory/holds";
import { DEVIATION_UNAVAILABLE, executionHooks } from "./execution-hooks";
import { type BatchRow, findStepOfKind, openStep, stepRecord } from "./execution";
import { assertStockCovers, postBatchMovement, postDispenseConsumption } from "./execution-postings";
import { useEquipment } from "./process";
import { type FormulaSnapshot, WEIGHING_STEP_KINDS, idempotent, lockBatch } from "./shared";

/**
 * Tolerance window for a theoretical quantity. An absolute tolerance (g) from the BOM line takes
 * precedence over the percentage (tolerances are process-owner configuration, A-PROC-03).
 */
export function toleranceRange(theoreticalQtyG: Decimal.Value, tolerancePct: Decimal.Value, toleranceAbsG?: Decimal.Value | null) {
  const theo = new Decimal(theoreticalQtyG);
  const band = toleranceAbsG !== null && toleranceAbsG !== undefined ? new Decimal(toleranceAbsG) : theo.mul(tolerancePct).div(100);
  return { min: theo.minus(band), max: theo.plus(band) };
}

/** Physical unit factors to the base unit (not business configuration; ADR-010). */
const TO_BASE: Record<string, Record<string, string>> = { g: { g: "1", kg: "1000", mg: "0.001" }, mL: { mL: "1", L: "1000" }, pcs: { pcs: "1" } };

/** Converts what the operator typed to the base unit; refuses units with no conversion (V-UOM). */
export function toBaseQty(qty: string, uom: string, baseUom: string): { base: Decimal; entered: Decimal } {
  let entered: Decimal;
  try {
    entered = new Decimal((qty ?? "").trim().replace(/,/g, ""));
  } catch {
    throw new DomainError("validation", "Enter the weight as a number.", { field: "qty" });
  }
  if (!entered.isFinite() || entered.lte(0)) throw new DomainError("validation", "The weight must be greater than zero.", { field: "qty" });
  const f = TO_BASE[baseUom]?.[uom];
  if (!f) throw new DomainError("validation", `This material is weighed in ${baseUom}; ${uom} cannot be converted.`, { field: "uom", rule: "V-UOM" });
  const base = entered.mul(f);
  if (base.decimalPlaces() > 3) throw new DomainError("validation", `The weight can have at most 3 decimals in ${baseUom}.`, { field: "qty" });
  return { base, entered };
}

export type DispenseInput = {
  batchId: string;
  batchMaterialId: string;
  /** Scanned BC:LOT payload, lot number or lot id (the physical container is scanned, US-3-08). */
  lotRef: string;
  /** Location the container is taken from (id, BC:LOC or code); optional when the lot has stock in one place only. */
  locationRef?: string | null;
  /** Net quantity as typed, in `uom` (default the material base unit). Optional when gross and tare are given. */
  qty?: string | null;
  uom?: string;
  tare?: string | null;
  gross?: string | null;
  /** Scale (equipment id, BC:EQP payload or code); required when the weighing step requires equipment. */
  equipmentRef?: string | null;
  /** Another lot follows for this line (split dispense). */
  partial?: boolean;
  /** Re-weigh after a void: the voided row this one replaces, with the reason. */
  supersedesId?: string | null;
  correctionReason?: string | null;
  /** CX-TOL: reason given by the approver for accepting an out-of-tolerance weight. */
  exceptionReason?: string | null;
  idempotencyKey?: string | null;
};

/** Lots reserved for this batch for a material (stock_reservations demand batch), if any. */
async function reservedLotsFor(q: DbOrTx, batchId: string, materialId: string) {
  return q
    .selectDistinct({ lotId: stockReservations.lotId, lotNumber: inventoryLots.lotNumber })
    .from(stockReservations)
    .innerJoin(inventoryLots, eq(inventoryLots.id, stockReservations.lotId))
    .where(and(eq(stockReservations.demandType, "batch"), eq(stockReservations.demandId, batchId), eq(stockReservations.status, "active"), eq(inventoryLots.materialId, materialId)));
}

/** Location a lot is taken from: the given reference, or the only location holding it. */
async function resolveSourceLocation(q: DbOrTx, ctx: AuthContext, siteId: string, lotId: string, lotNumber: string, ref?: string | null) {
  if (ref && ref.trim()) {
    const v = ref.trim();
    const isId = /^[0-9a-f-]{36}$/i.test(v);
    const code = v.toUpperCase().replace(/^BC:LOC:/, "");
    const [loc] = await q
      .select()
      .from(locations)
      .where(and(eq(locations.siteId, siteId), isId ? eq(locations.id, v) : eq(locations.code, code)))
      .limit(1);
    if (!loc) throw new DomainError("not_found", `Location ${code} not found at this site.`, { field: "location" });
    ctx.requireSite(loc.siteId);
    return loc;
  }
  const rows = await q
    .select({ loc: locations })
    .from(inventoryBalances)
    .innerJoin(locations, eq(locations.id, inventoryBalances.locationId))
    .where(and(eq(inventoryBalances.lotId, lotId), gt(inventoryBalances.qtyBase, "0")));
  if (rows.length === 1) return rows[0].loc;
  if (rows.length === 0) throw new DomainError("insufficient_stock", `Lot ${lotNumber} has no stock at this site.`, { field: "lot" });
  throw new DomainError("validation", `Lot ${lotNumber} is in ${rows.length} locations (${rows.map((r) => r.loc.code).join(", ")}). Scan or choose the location you take it from.`, {
    field: "location",
  });
}

/**
 * Records one weighing (US-3-10, W05-07..09). Order of checks: permission and site → batch in
 * process and weighing clearance done (the weighing step opens) → ingredient line open → lot
 * re-read at scan time: right material (V-MAT: "This is Palm Oil, not Coconut Oil"), reserved for
 * the batch when reservations exist, released and in date (V-EXP/V-HOLD, 409) → source location
 * not under a hold and stock not already promised to unposted weighings (V-NEG) → scale usable
 * (V-CAL) and within capacity → line total within tolerance (V-TOL; a qa_qc co-signed exception
 * with a deviation accepts it, CX-TOL) → row saved with the next sequence, line projection updated,
 * consumption posted now or at transfer to quarantine (A-PROC-31). A co-signed checker may sign in
 * the same transaction; otherwise the checker signs later from their own session (checkDispense).
 */
export async function recordDispense(ctx: AuthContext, input: DispenseInput, signers: { checker?: AuthContext | null; exceptionApprover?: AuthContext | null } = {}) {
  ctx.require("production.dispense_record.create");
  return db.transaction(async (tx) => {
    const batch = await lockBatch(tx, ctx, input.batchId);
    const { result } = await idempotent(tx, ctx, input.idempotencyKey, "production.dispense_record.create", async () => {
      if (batch.status === "materials_staged") {
        // §6.2: the signed weighing-area line clearance (step 1) moves the batch in process.
        const first = [...(batch.formulaSnapshot as FormulaSnapshot).steps].sort((x, z) => x.stepNo - z.stepNo).find((s) => s.stepKind === "line_clearance");
        throw new DomainError("state", `Complete step ${first?.stepNo ?? 1} (${first?.name ?? "line clearance"}) first: weighing starts once the line clearance is signed.`, { rule: "V-STATE" });
      }
      if (batch.status !== "in_process") {
        throw new DomainError("state", `Batch ${batch.batchNumber} is ${batch.status.replace(/_/g, " ")}. Weighing is only possible while the batch is in process.`);
      }
      const step = findStepOfKind(batch, WEIGHING_STEP_KINDS);
      if (!step) throw new DomainError("state", "This batch's routing has no weighing step.");
      const rec = await openStep(tx, ctx, batch, step);

      const [row] = await tx
        .select({ bm: batchMaterials, material: materials })
        .from(batchMaterials)
        .innerJoin(materials, eq(materials.id, batchMaterials.materialId))
        .where(and(eq(batchMaterials.id, input.batchMaterialId), eq(batchMaterials.batchId, batch.id)))
        .for("update", { of: batchMaterials })
        .limit(1);
      if (!row) throw new DomainError("not_found", "Ingredient line not found on this batch.");
      const { bm, material } = row;
      if (bm.status === "dispensed" || bm.status === "exception") {
        throw new DomainError("state", `${material.name} has already been weighed for batch ${batch.batchNumber}. A correction needs the weighing voided first.`);
      }

      // Amount.
      let net: Decimal;
      let entered: { qty: Decimal; uom: string };
      const uom = input.uom || material.baseUom;
      const tare = input.tare?.trim() ? toBaseQty(input.tare, uom, material.baseUom).base : null;
      const gross = input.gross?.trim() ? toBaseQty(input.gross, uom, material.baseUom).base : null;
      if ((tare === null) !== (gross === null)) throw new DomainError("validation", "Enter both gross and tare, or the net weight only.", { field: "tare" });
      if (input.qty?.trim()) {
        const c = toBaseQty(input.qty, uom, material.baseUom);
        net = c.base;
        entered = { qty: c.entered, uom };
        if (gross && tare && !gross.minus(tare).eq(net)) throw new DomainError("validation", "Gross minus tare does not equal the net weight.", { field: "qty" });
      } else if (gross && tare) {
        net = gross.minus(tare);
        if (net.lte(0)) throw new DomainError("validation", "Gross must be greater than tare.", { field: "gross" });
        entered = { qty: net.div(TO_BASE[material.baseUom][uom]), uom };
      } else {
        throw new DomainError("validation", "Enter the weight.", { field: "qty" });
      }

      // Lot identity and status, re-read now (status may have changed since staging).
      const lot = await resolveLotRef(tx, ctx, input.lotRef);
      if (lot.siteId !== batch.siteId) throw new DomainError("not_found", `Lot ${lot.lotNumber} is not at this batch's site.`, { field: "lot" });
      if (lot.itemKind !== "material" || lot.materialId !== bm.materialId) {
        const [other] = lot.materialId ? await tx.select({ name: materials.name }).from(materials).where(eq(materials.id, lot.materialId)).limit(1) : [];
        throw new DomainError("blocked_lot", `This is ${other?.name ?? "a finished product"}, not ${material.name}. Lot ${lot.lotNumber} cannot be used on this line.`, { rule: "V-MAT", field: "lot" });
      }
      const reserved = await reservedLotsFor(tx, batch.id, bm.materialId);
      if (reserved.length && !reserved.some((r) => r.lotId === lot.id)) {
        throw new DomainError("blocked_lot", `Lot ${lot.lotNumber} is not the lot reserved for this batch. Expected: ${reserved.map((r) => r.lotNumber).join(", ")}.`, { rule: "V-MAT", field: "lot" });
      }
      assertLotUsable(lot);
      const loc = await resolveSourceLocation(tx, ctx, batch.siteId, lot.id, lot.lotNumber, input.locationRef);
      await assertLocationNotHeld(tx, loc);
      await assertStockCovers(tx, lot, loc, net);

      // Scale (V-CAL) and capacity.
      let equipmentId: string | null = null;
      let scaleCode: string | null = null;
      if (input.equipmentRef?.trim()) {
        const { equipment: e } = await useEquipment(tx, ctx, batch, step, rec, input.equipmentRef);
        if (e.capacityUom === material.baseUom && ((e.capacityMax && net.gt(e.capacityMax)) || (e.capacityMin && net.lt(e.capacityMin)))) {
          throw new DomainError("validation", `${net.toString()} ${material.baseUom} is outside the range of ${e.code} (${e.capacityMin ?? "0"}–${e.capacityMax ?? "∞"} ${e.capacityUom}). Use another scale.`, { field: "equipment" });
        }
        equipmentId = e.id;
        scaleCode = e.code;
      } else if (step.requiresEquipment) {
        throw new DomainError("validation", `Select the ${step.equipmentKind ?? "scale"} you weigh on.`, { field: "equipment" });
      }

      // Supersession after a void.
      const live = await tx.select().from(dispenseRecords).where(eq(dispenseRecords.batchMaterialId, bm.id));
      let supersedesId: string | null = null;
      if (input.supersedesId) {
        const prev = live.find((r) => r.id === input.supersedesId);
        if (!prev || !prev.voidedAt) throw new DomainError("validation", "Only a voided weighing of this ingredient can be replaced.");
        if (live.some((r) => r.supersedesId === prev.id)) throw new DomainError("state", "That weighing has already been replaced.");
        if (!input.correctionReason?.trim()) throw new DomainError("validation", "Give the reason for the correction.", { field: "correctionReason" });
        supersedesId = prev.id;
      }

      // Tolerance on the line total (V-TOL).
      const before = live.filter((r) => !r.voidedAt).reduce((s, r) => s.plus(r.actualQtyG), new Decimal(0));
      const total = before.plus(net);
      const { min, max } = toleranceRange(bm.theoreticalQtyG, bm.tolerancePct, bm.toleranceAbsG);
      const range = `${min.toDecimalPlaces(3).toString()}–${max.toDecimalPlaces(3).toString()} ${material.baseUom}`;
      let within: boolean;
      let exception: { approver: AuthContext; reason: string; deviationId: string } | null = null;
      if (input.partial) {
        if (total.gte(min) && total.lte(max)) throw new DomainError("validation", `This weighing brings ${material.name} to ${total.toString()} ${material.baseUom}, within ${range}: untick "another lot follows" to complete the line.`, { field: "partial" });
        if (total.gt(max)) throw new DomainError("out_of_tolerance", `The line total ${total.toString()} ${material.baseUom} would be above ${range}. Re-weigh.`, { rule: "V-TOL", min: min.toString(), max: max.toString(), actual: total.toString() });
        within = true;
      } else {
        within = total.gte(min) && total.lte(max);
        if (!within) {
          const approver = signers.exceptionApprover ?? null;
          const reason = input.exceptionReason?.trim() ?? "";
          if (!approver) {
            throw new DomainError(
              "out_of_tolerance",
              `${total.toString()} ${material.baseUom} is outside the tolerance ${range} (target ${new Decimal(bm.theoreticalQtyG).toString()}). Re-weigh, or request an exception: QA must approve on this device.`,
              { rule: "V-TOL", min: min.toString(), max: max.toString(), actual: total.toString() },
            );
          }
          approver.require("production.over_tolerance_dispense.approve");
          approver.requireSite(batch.siteId);
          ctx.assertSeparation(approver.userId === ctx.userId, "The exception must be approved by someone other than the operator.");
          if (reason.length < 10) throw new DomainError("validation", "The approver must give the reason for accepting this weight (at least 10 characters).", { field: "exceptionReason" });
          const opener = executionHooks().openDeviation;
          if (!opener) throw new DomainError("state", DEVIATION_UNAVAILABLE, { rule: "CX-TOL" });
          const { deviationId } = await opener(tx, approver, {
            kind: "out_of_tolerance",
            batchId: batch.id,
            batchNumber: batch.batchNumber,
            siteId: batch.siteId,
            lotId: lot.id,
            description: `${material.name} weighed ${total.toString()} ${material.baseUom}, tolerance ${range}. ${reason}`,
            approvedBy: approver.userId,
          });
          exception = { approver, reason, deviationId };
        }
      }

      const checker = signers.checker ?? null;
      if (checker) {
        ctx.assertSeparation(checker.userId === ctx.userId, "The checker must be a different person from the operator.", { rule: "V-SOD" });
        checker.require("production.dispense_record.approve");
        checker.requireSite(batch.siteId);
      }

      const seq = live.reduce((m, r) => Math.max(m, r.sequence), 0) + 1;
      const now = new Date();
      const [rec2] = await tx
        .insert(dispenseRecords)
        .values({
          batchMaterialId: bm.id,
          sequence: seq,
          lotId: lot.id,
          fromLocationId: loc.id,
          actualQtyG: net.toString(),
          enteredQty: entered.qty.toString(),
          enteredUom: entered.uom,
          tareQtyG: tare?.toString() ?? null,
          grossQtyG: gross?.toString() ?? null,
          isPartial: !!input.partial,
          isWithinTolerance: within,
          scaleCode,
          equipmentId,
          operatorId: ctx.userId,
          checkerId: checker?.userId ?? null,
          checkedAt: checker ? now : null,
          exceptionApprovedBy: exception?.approver.userId ?? null,
          exceptionReason: exception?.reason ?? null,
          deviationId: exception?.deviationId ?? null,
          supersedesId,
          correctionReason: supersedesId ? input.correctionReason!.trim() : null,
        })
        .returning();
      const status = input.partial ? "partial" : exception ? "exception" : "dispensed";
      await tx.update(batchMaterials).set({ dispensedQtyG: total.toString(), status }).where(eq(batchMaterials.id, bm.id));

      const atDispense = await getSetting(tx, ctx.organizationId, "production.post_consumption_at_dispense", batch.siteId);
      if (atDispense) await postDispenseConsumption(tx, ctx, batch, rec2, material.name);

      await audit(tx, ctx, {
        action: "production.dispense_record.recorded",
        entityType: "dispense_record",
        entityId: rec2.id,
        entityNumber: batch.batchNumber,
        siteId: batch.siteId,
        reason: supersedesId ? input.correctionReason : null,
        before: { status: bm.status, dispensedQtyG: bm.dispensedQtyG },
        after: {
          batchId: batch.id,
          material: material.code,
          materialName: material.name,
          lot: lot.lotNumber,
          location: loc.code,
          scale: scaleCode,
          sequence: seq,
          targetQtyG: bm.theoreticalQtyG,
          actualQtyG: net.toString(),
          entered: `${entered.qty.toString()} ${entered.uom}`,
          lineTotal: total.toString(),
          partial: !!input.partial,
          withinTolerance: within,
          status,
          postedNow: atDispense,
          supersedes: supersedesId,
        },
      });
      if (exception) {
        await audit(tx, exception.approver, {
          action: "production.dispense_record.over_tolerance_approved",
          entityType: "dispense_record",
          entityId: rec2.id,
          entityNumber: batch.batchNumber,
          siteId: batch.siteId,
          reason: exception.reason,
          after: { material: material.code, actualQtyG: total.toString(), tolerance: range, deviationId: exception.deviationId, operator: ctx.displayName },
        });
      }
      if (checker) {
        await audit(tx, checker, {
          action: "production.dispense_record.checked",
          entityType: "dispense_record",
          entityId: rec2.id,
          entityNumber: batch.batchNumber,
          siteId: batch.siteId,
          after: { material: material.code, lot: lot.lotNumber, actualQtyG: net.toString(), operator: ctx.displayName, signedOn: "operator_device" },
        });
      }
      return { dispenseRecordId: rec2.id, materialName: material.name, withinTolerance: within, status, lineTotalG: total.toString(), checked: !!checker };
    });
    return result;
  });
}

/**
 * The checker verifies a saved weighing (W05-08): sees material, lot, target, actual and signs.
 * The operator can never check their own row (409 separation_of_duties; CHECK dispense_records_sod_ck).
 */
export async function checkDispense(checker: AuthContext, input: { dispenseRecordId: string; idempotencyKey?: string | null }) {
  checker.require("production.dispense_record.approve");
  return db.transaction(async (tx) => {
    const [r] = await tx
      .select({ rec: dispenseRecords, batchId: batchMaterials.batchId, materialName: materials.name, lotNumber: inventoryLots.lotNumber })
      .from(dispenseRecords)
      .innerJoin(batchMaterials, eq(batchMaterials.id, dispenseRecords.batchMaterialId))
      .innerJoin(materials, eq(materials.id, batchMaterials.materialId))
      .innerJoin(inventoryLots, eq(inventoryLots.id, dispenseRecords.lotId))
      .where(eq(dispenseRecords.id, input.dispenseRecordId))
      .limit(1);
    if (!r) throw new DomainError("not_found", "Weighing not found.");
    const batch = await lockBatch(tx, checker, r.batchId);
    const { result } = await idempotent(tx, checker, input.idempotencyKey, "production.dispense_record.check", async () => {
      const [rec] = await tx.select().from(dispenseRecords).where(eq(dispenseRecords.id, r.rec.id)).for("update").limit(1);
      if (rec.voidedAt) throw new DomainError("state", "This weighing was voided.");
      if (rec.checkerId) throw new DomainError("state", "This weighing is already checked.");
      if (checker.sodBlocks(rec.operatorId === checker.userId, "You weighed this ingredient; another person must check it.")) {
        throw new DomainError("separation_of_duties", "You weighed this ingredient; another person must check it.", { ...checker.refusalDetails(), rule: "V-SOD" });
      }
      const now = new Date();
      await tx.update(dispenseRecords).set({ checkerId: checker.userId, checkedAt: now }).where(eq(dispenseRecords.id, rec.id));
      await audit(tx, checker, {
        action: "production.dispense_record.checked",
        entityType: "dispense_record",
        entityId: rec.id,
        entityNumber: batch.batchNumber,
        siteId: batch.siteId,
        after: { material: r.materialName, lot: r.lotNumber, actualQtyG: rec.actualQtyG, signedOn: "own_session" },
      });
      return { dispenseRecordId: rec.id, materialName: r.materialName };
    });
    return result;
  });
}

/**
 * Voids a weighing with a reason (production.dispense_record.void; appends, never deletes). A
 * posted consumption is reversed in the same transaction (reversal movement + reversal posting).
 * The line projection is recomputed; the replacement weighing supersedes the voided row.
 * Allowed while the weighing step is still open.
 */
export async function voidDispense(ctx: AuthContext, input: { dispenseRecordId: string; reason: string }) {
  ctx.require("production.dispense_record.void");
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 5) throw new DomainError("validation", "Give the reason for voiding (at least 5 characters).", { field: "reason" });
  return db.transaction(async (tx) => {
    const [r] = await tx
      .select({ rec: dispenseRecords, bm: batchMaterials, materialName: materials.name })
      .from(dispenseRecords)
      .innerJoin(batchMaterials, eq(batchMaterials.id, dispenseRecords.batchMaterialId))
      .innerJoin(materials, eq(materials.id, batchMaterials.materialId))
      .where(eq(dispenseRecords.id, input.dispenseRecordId))
      .limit(1);
    if (!r) throw new DomainError("not_found", "Weighing not found.");
    const batch = await lockBatch(tx, ctx, r.bm.batchId);
    if (batch.status !== "in_process") throw new DomainError("state", `Batch ${batch.batchNumber} is ${batch.status.replace(/_/g, " ")}; weighings can no longer be voided.`);
    const step = findStepOfKind(batch, WEIGHING_STEP_KINDS);
    const stepRec = step ? await stepRecord(tx, batch.id, step.stepNo) : null;
    if (stepRec && stepRec.status !== "in_progress") throw new DomainError("state", "The weighing step is already signed off. A correction now needs a deviation through QA.");
    const [rec] = await tx.select().from(dispenseRecords).where(eq(dispenseRecords.id, r.rec.id)).for("update").limit(1);
    if (rec.voidedAt) throw new DomainError("state", "This weighing is already voided.");
    const now = new Date();
    await tx.update(dispenseRecords).set({ voidedAt: now, voidedBy: ctx.userId, voidReason: reason }).where(eq(dispenseRecords.id, rec.id));
    if (rec.productionPostingId) {
      const [posting] = await tx.select().from(productionPostings).where(eq(productionPostings.id, rec.productionPostingId)).limit(1);
      await postBatchMovement(tx, ctx, batch, {
        postingType: "reversal",
        lotId: rec.lotId,
        qtyBase: rec.actualQtyG,
        toLocationId: rec.fromLocationId,
        reason: `Void of weighing ${r.materialName} (seq ${rec.sequence}): ${reason}`,
        idempotencyKey: `dispense-void:${rec.id}`,
        reversalOfMovementId: posting.stockMovementId,
        reversalOfPostingId: posting.id,
        links: { batchMaterialId: rec.batchMaterialId, dispenseRecordId: rec.id },
      });
    }
    const rest = await tx
      .select({ qty: dispenseRecords.actualQtyG, partial: dispenseRecords.isPartial })
      .from(dispenseRecords)
      .where(and(eq(dispenseRecords.batchMaterialId, rec.batchMaterialId), isNull(dispenseRecords.voidedAt)));
    const total = rest.reduce((s, x) => s.plus(x.qty), new Decimal(0));
    const status = rest.length === 0 ? "pending" : "partial";
    await tx.update(batchMaterials).set({ dispensedQtyG: total.toString(), status }).where(eq(batchMaterials.id, rec.batchMaterialId));
    await audit(tx, ctx, {
      action: "production.dispense_record.voided",
      entityType: "dispense_record",
      entityId: rec.id,
      entityNumber: batch.batchNumber,
      siteId: batch.siteId,
      reason,
      before: { actualQtyG: rec.actualQtyG, lineStatus: r.bm.status },
      after: { voided: true, lineStatus: status, lineTotal: total.toString(), reversed: !!rec.productionPostingId },
    });
    return { lineStatus: status };
  });
}

/**
 * What keeps the weighing step from completing: lines not fully weighed and weighings not checked
 * (every BOM line requires a checker unless its snapshot says otherwise).
 */
export async function dispensingBlockers(q: DbOrTx, batch: BatchRow): Promise<string[]> {
  const snap = batch.formulaSnapshot as FormulaSnapshot;
  const lines = await q
    .select({ bm: batchMaterials, name: materials.name })
    .from(batchMaterials)
    .innerJoin(materials, eq(materials.id, batchMaterials.materialId))
    .where(eq(batchMaterials.batchId, batch.id));
  const out: string[] = [];
  const open = lines.filter((l) => l.bm.status === "pending" || l.bm.status === "partial");
  if (open.length) out.push(`${open.length} ingredient(s) still need to be weighed: ${open.map((l) => l.name).join(", ")}.`);
  const ids = lines.map((l) => l.bm.id);
  if (ids.length) {
    const unchecked = await q
      .select({ id: dispenseRecords.id, bmId: dispenseRecords.batchMaterialId })
      .from(dispenseRecords)
      .where(and(inArray(dispenseRecords.batchMaterialId, ids), isNull(dispenseRecords.voidedAt), isNull(dispenseRecords.checkerId)));
    const needing = unchecked.filter((u) => {
      const line = lines.find((l) => l.bm.id === u.bmId);
      const snapLine = snap.lines.find((x) => x.bomLineId === line?.bm.bomLineId);
      return snapLine?.requiresChecker !== false;
    });
    if (needing.length) out.push(`${needing.length} weighing(s) still need the checker's signature.`);
  }
  return out;
}

/** Sum of weighed quantities per lot of a batch (BMR ingredient rows). */
export async function dispensedByLot(q: DbOrTx, batchId: string) {
  return q
    .select({ lotId: dispenseRecords.lotId, qty: sql<string>`sum(${dispenseRecords.actualQtyG})::text` })
    .from(dispenseRecords)
    .innerJoin(batchMaterials, eq(batchMaterials.id, dispenseRecords.batchMaterialId))
    .where(and(eq(batchMaterials.batchId, batchId), isNull(dispenseRecords.voidedAt)))
    .groupBy(dispenseRecords.lotId);
}
