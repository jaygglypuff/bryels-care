import "server-only";
import { isPackagingKind } from "./packaging-lines";
import { and, eq, inArray, isNull, gt, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { type DbOrTx, db } from "@/db/client";
import { batchMaterials, dispenseRecords, inventoryBalances, inventoryLots, locations, materials, productionPostings, stockReservations } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import { checkEntryMode, TYPING_IS_OFF } from "@/lib/scan/code-sql";
import { typedChecksAllowed } from "@/lib/scan/typed-check";
import type { PickVia } from "@/lib/scan/pick";
import { getSetting } from "@/lib/settings";
import { assertLotUsable } from "@/modules/inventory/ledger";
import { assertLocationNotHeld, resolveLotRef } from "@/modules/inventory/holds";
import { DEVIATION_UNAVAILABLE, executionHooks } from "./execution-hooks";
import { type BatchRow, findStepOfKind, openStep, stepRecord } from "./execution";
import { assertStockCovers, postBatchMovement, postDispenseConsumption } from "./execution-postings";
import { useEquipment } from "./process";
import { convertReservations, expectedLots } from "./staging";
import { type FormulaSnapshot, WEIGHING_STEP_KINDS, idempotent, lockBatch } from "./shared";
import { changeLotInTx, lineForLotChange } from "./material-swaps";
import { offPlanWarning } from "./pick-plan";
import { notifyNextActors } from "@/modules/governance";
import { flowHref } from "./flow-paths";
import { CHECKS_HREF } from "./checks-href";

/** Tolerance window at the typed resolution (shared with the weigh card, weigh-window.ts). */
export { toleranceRange } from "./weigh-window";
import { toleranceRange } from "./weigh-window";
import { plural } from "@/lib/plural";

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
  /**
   * ADR-080 §3: the screen preselected the lot (Weigh card). The operator must then confirm it per
   * `production.weighing.lot_confirm`: `lotConfirm` = the last 4 characters printed on the container
   * label, or the scanned BC:LOT label. A lot the operator scanned or typed into `lotRef` (the
   * advanced batch workspace, offline sync) is itself the confirmation.
   */
  lotPreselected?: boolean;
  lotConfirm?: string | null;
  /** How `lotConfirm` was given (A-SCAN-TYPED-01): "scan", "typed" (the lot number on the label, full or last 4) or "tap" (refused). */
  lotConfirmVia?: PickVia | null;
  /**
   * How `lotRef` itself was given when the lot is not preselected (offline weighing, ADR-125): "scan" or "typed" is
   * recorded as the lot confirmation; "tap" is refused (`checkEntryMode`: a tap is not a check). Absent = older
   * callers, recorded "typed_lot" as before.
   */
  lotVia?: PickVia | null;
  /** ADR-106 §3: one-tap reason for weighing from a lot that was not taken at Get materials (and a note for "other"). */
  offPlanReasonCode?: string | null;
  offPlanNote?: string | null;
  idempotencyKey?: string | null;
};

const alnum = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Lot confirmation at weighing (ADR-080 §3, UX review B5). Returns how the lot was confirmed for the
 * record. Mismatch → 409 blocked_lot with the expected lot ("This label says …. Use lot …").
 */
export function confirmLot(mode: "last4" | "scan" | "none", preselected: boolean, lot: { lotNumber: string }, confirm: string | null | undefined, via?: PickVia | null, typedAllowed = true): "typed_lot" | "last4" | "scan" | "typed" | "not_required" {
  if (!preselected) return "typed_lot"; // the label itself was scanned or typed into the lot field
  if (mode === "none") return "not_required";
  const c = (confirm ?? "").trim();
  const field = { field: "lotConfirm", rule: "V-MAT" };
  // A-SCAN-TYPED-01 (owner decision 2026-11-08): reading the container's label is the check, by scan or by typing
  // the lot number printed on it (full, or its last 4). Tapping a lot in the list does not confirm it.
  if (via === "tap") throw new DomainError("validation", "Tapping the list does not confirm the lot. Scan the lot label, or type the lot number printed on it.", { ...field, fieldErrors: { lotConfirm: "Scan or type the lot number." } });
  if (!c) {
    if (!typedAllowed) throw new DomainError("validation", `Scan the lot label on the container (lot ${lot.lotNumber}).`, { ...field, fieldErrors: { lotConfirm: "Scan the lot label." } });
    throw new DomainError("validation", mode === "scan" ? `Scan the lot label on the container, or type the lot number printed on it (lot ${lot.lotNumber}).` : `Type the last 4 characters of the lot number printed on the container label.`, { ...field, fieldErrors: { lotConfirm: mode === "scan" ? "Scan or type the lot number." : "Type the last 4." } });
  }
  // ADR-126: with `scan.typed_code_counts_as_check` off only a scan confirms the lot. A typed number is refused, and so
  // is a bare "last 4" (it can only have been typed), whatever `production.weighing.lot_confirm` says.
  if (!typedAllowed && (via === "typed" || (via !== "scan" && mode === "last4" && !/^BC:LOT:/i.test(c)))) {
    throw new DomainError("validation", TYPING_IS_OFF, { ...field, code: "TYPED_NOT_A_CHECK", fieldErrors: { lotConfirm: "Scan the lot label." } });
  }
  if (via === "typed") {
    const typed = alnum(c.replace(/^BC:LOT:/i, ""));
    const want = alnum(lot.lotNumber);
    if (typed === want || (typed.length >= 4 && want.endsWith(typed))) return "typed";
    throw new DomainError("blocked_lot", `You typed ${c.toUpperCase()}. That is not lot ${lot.lotNumber}. Use lot ${lot.lotNumber}, or choose another lot.`, { ...field, expected: lot.lotNumber, fieldErrors: { lotConfirm: "Wrong lot." } });
  }
  const scanned = c.toUpperCase().startsWith("BC:LOT:") ? c.slice(7) : null;
  if (scanned !== null || mode === "scan") {
    const label = alnum(scanned ?? c);
    if (label === alnum(lot.lotNumber)) return "scan";
    throw new DomainError("blocked_lot", `This label says ${(scanned ?? c).toUpperCase()}. Use lot ${lot.lotNumber}, or choose another lot.`, { ...field, expected: lot.lotNumber, fieldErrors: { lotConfirm: "Wrong lot." } });
  }
  const want = alnum(lot.lotNumber).slice(-4);
  if (alnum(c).slice(-4) === want && alnum(c).length >= 4) return "last4";
  throw new DomainError("blocked_lot", `The label ends in ${alnum(c).slice(-4) || c.toUpperCase()}, not ${want}. Use lot ${lot.lotNumber}, or choose another lot.`, { ...field, expected: lot.lotNumber, fieldErrors: { lotConfirm: "Does not match." } });
}

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
  // A-SCAN-TYPED-01: a lot tapped in a list is not a lot confirmation (offline replay included, ADR-125).
  if (!input.lotPreselected && input.lotVia) checkEntryMode(input.lotVia, "lotRef");
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
      if (isPackagingKind(material.materialKind)) {
        throw new DomainError("validation", `${material.name} is packaging: it is not weighed. Its lot is recorded at the packaging step.`);
      }
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
      let reserved = await reservedLotsFor(tx, batch.id, bm.materialId);
      // ADR-080 §2: a batch that got its materials by the Materials list (no staging move) weighs from the
      // lots set aside for its order.
      let woReserved = !reserved.length && batch.workOrderId ? await expectedLots(tx, batch.workOrderId, bm.materialId) : [];
      const offPlan = (reserved.length && !reserved.some((r) => r.lotId === lot.id)) || (woReserved.length && !woReserved.some((r) => r.r.lotId === lot.id));
      if (offPlan) {
        // ADR-106 §3: another allowed lot of the same ingredient than the one taken at Get materials. The operator may
        // continue with a one-tap reason: the set-aside moves to this lot and QA sees the note (batch_material_substitutions
        // floor_lot, "Not the lot taken at Get materials"). Without the reason: refused with the plain warning.
        const taken = [...new Set([...reserved.map((r) => r.lotNumber), ...woReserved.map((r) => r.lotNumber)])];
        assertLotUsable(lot); // expired, stopped or waiting-for-QA lots are never accepted
        if (!input.offPlanReasonCode?.trim()) {
          throw new DomainError("blocked_lot", offPlanWarning(taken), { rule: "V-MAT", field: "lot", expected: taken, offPlan: true, fieldErrors: { offPlanReasonCode: "Tap a reason to continue." } });
        }
        const line = await lineForLotChange(tx, batch, bm.id);
        await changeLotInTx(tx, ctx, batch, line, { lotId: lot.id, locationId: input.locationRef && /^[0-9a-f-]{36}$/i.test(input.locationRef) ? input.locationRef : null, reasonCode: input.offPlanReasonCode, note: input.offPlanNote, offPlan: true, atLeast: net });
        reserved = await reservedLotsFor(tx, batch.id, bm.materialId);
        woReserved = !reserved.length && batch.workOrderId ? await expectedLots(tx, batch.workOrderId, bm.materialId) : [];
      }
      assertLotUsable(lot);
      const lotConfirmMode = await getSetting(tx, ctx.organizationId, "production.weighing.lot_confirm", batch.siteId);
      // ADR-126: a typed lot number counts only while `scan.typed_code_counts_as_check` is on (read inside the idempotent
      // block, so a weighing already recorded still answers with its stored result).
      const typedAllowed = await typedChecksAllowed(tx, ctx.organizationId);
      const lotConfirmedBy = !input.lotPreselected && input.lotVia ? checkEntryMode(input.lotVia, "lotRef", typedAllowed) : confirmLot(lotConfirmMode, !!input.lotPreselected, lot, input.lotConfirm, input.lotConfirmVia, typedAllowed);
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
      // The order's set-aside quantity of this lot is used up by the weighing (Materials-list batches).
      const atLot = woReserved.filter((r) => r.r.lotId === lot.id && r.r.locationId === loc.id);
      if (atLot.length) await convertReservations(tx, ctx, atLot.map((r) => r.r), net, `Weighed for batch ${batch.batchNumber}`, "converted");

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
          lotConfirmed: lotConfirmedBy,
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
      // Hand-off (docs/NEXT_APPROVER.md): a weighing that needs a second person tells the people who can check it, once
      // per batch weighing step (never the weigher); the checker's Home lists "Check a weighing" (floor-tasks.ts).
      const needsCheck = !checker && (batch.formulaSnapshot as FormulaSnapshot).lines.find((l) => l.lineNo === bm.lineNo)?.requiresChecker !== false;
      if (needsCheck) {
        await notifyNextActors(tx, ctx, "weighing_check", { siteId: batch.siteId, excludeUserIds: [ctx.userId] }, {
          title: `Check a weighing of batch ${batch.batchNumber}`,
          body: `${ctx.displayName} weighed ${material.name}. Watch the container and the scale, then confirm it on the Weigh screen.`,
          // ADR-130: the message opens the checker's list, where the check is done (never the operator's screen).
          link: CHECKS_HREF,
          entityType: "batch",
          entityId: batch.id,
          dedupeKey: `handoff.weighing_check:${batch.id}:${rec.id}`,
        });
      }
      return { dispenseRecordId: rec2.id, materialName: material.name, withinTolerance: within, status, lineTotalG: total.toString(), checked: !!checker, needsCheck, siteId: batch.siteId };
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
        // ADR-130: where it was signed comes from the context (coSign marks a password co-signature), never from the form.
        after: { material: r.materialName, lot: r.lotNumber, actualQtyG: rec.actualQtyG, signedOn: checker.signedOn },
      });
      return { dispenseRecordId: rec.id, materialName: r.materialName };
    });
    return result;
  });
}

/**
 * ADR-130 "Check 4 weighings for B-26-0004": the checker confirms every listed weighing of ONE batch in one
 * transaction (all or nothing), each with the same rules as `checkDispense` (not voided, not checked, not the
 * checker's own weighing, permission at the batch's site). Whether one confirmation may cover several weighings
 * is a QA rule: `production.weighing.check_together` (default on, A-CHK-01). Off: one weighing per call.
 */
export async function checkDispenses(checker: AuthContext, input: { batchId: string; dispenseRecordIds: string[]; idempotencyKey?: string | null }) {
  checker.require("production.dispense_record.approve");
  const ids = [...new Set(input.dispenseRecordIds)];
  if (ids.length === 0) throw new DomainError("validation", "Nothing to check.");
  if (ids.length > 50) throw new DomainError("validation", "Check at most 50 weighings at once.");
  return db.transaction(async (tx) => {
    const batch = await lockBatch(tx, checker, input.batchId);
    if (!checker.canAt("production.dispense_record.approve", batch.siteId)) checker.requireAt("production.dispense_record.approve", batch.siteId);
    if (ids.length > 1 && !(await getSetting(tx, checker.organizationId, "production.weighing.check_together", batch.siteId))) {
      throw new DomainError("validation", "Check each weighing on its own (company rule).", { code: "CHECK_ONE_BY_ONE" });
    }
    const { result } = await idempotent(tx, checker, input.idempotencyKey, "production.dispense_record.check_many", async () => {
      const rows = await tx
        .select({ rec: dispenseRecords, batchId: batchMaterials.batchId, materialName: materials.name, lotNumber: inventoryLots.lotNumber })
        .from(dispenseRecords)
        .innerJoin(batchMaterials, eq(batchMaterials.id, dispenseRecords.batchMaterialId))
        .innerJoin(materials, eq(materials.id, batchMaterials.materialId))
        .innerJoin(inventoryLots, eq(inventoryLots.id, dispenseRecords.lotId))
        .where(inArray(dispenseRecords.id, ids))
        .for("update", { of: dispenseRecords });
      if (rows.length !== ids.length || rows.some((x) => x.batchId !== batch.id)) throw new DomainError("not_found", "A weighing on this card is not part of this batch.");
      const now = new Date();
      for (const r of rows) {
        if (r.rec.voidedAt) throw new DomainError("state", `${r.materialName}: this weighing was undone. Go back to your list.`);
        if (r.rec.checkerId) throw new DomainError("state", `${r.materialName} is already checked. Go back to your list.`);
        if (checker.sodBlocks(r.rec.operatorId === checker.userId, "You weighed this ingredient; another person must check it.")) {
          throw new DomainError("separation_of_duties", `You weighed ${r.materialName}; another person must check it.`, { ...checker.refusalDetails(), rule: "V-SOD" });
        }
      }
      for (const r of rows) {
        await tx.update(dispenseRecords).set({ checkerId: checker.userId, checkedAt: now }).where(eq(dispenseRecords.id, r.rec.id));
        await audit(tx, checker, {
          action: "production.dispense_record.checked",
          entityType: "dispense_record",
          entityId: r.rec.id,
          entityNumber: batch.batchNumber,
          siteId: batch.siteId,
          after: { material: r.materialName, lot: r.lotNumber, actualQtyG: r.rec.actualQtyG, signedOn: checker.signedOn, together: rows.length },
        });
      }
      return { checked: rows.length, batchNumber: batch.batchNumber, materials: rows.map((r) => r.materialName) };
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
  return voidDispenseCore(ctx, input.dispenseRecordId, reason, "production.dispense_record.voided");
}

/**
 * "No, send it back" on the second-person check of a weighing (re-audit 2026-11-01 N9, ADR-100 "confirm or send back
 * with a reason"; ADR-105). The checker (production.dispense_record.approve, never the person who weighed) refuses an
 * unchecked weighing with a reason: the weighing is voided exactly like voidDispense (append-only, a posted
 * consumption is reversed, the line is weighed again) and audited as `production.dispense_record.returned`.
 */
export async function returnDispense(checker: AuthContext, input: { dispenseRecordId: string; reason: string }) {
  checker.require("production.dispense_record.approve");
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 5) throw new DomainError("validation", "Say what was wrong (at least 5 characters).", { field: "reason", fieldErrors: { reason: "Say what was wrong." } });
  return voidDispenseCore(checker, input.dispenseRecordId, `Sent back by the second person: ${reason}`, "production.dispense_record.returned", (rec) => {
    if (rec.checkerId) throw new DomainError("state", "This weighing is already checked.");
    if (checker.sodBlocks(rec.operatorId === checker.userId, "You weighed this ingredient; another person must check it.")) {
      throw new DomainError("separation_of_duties", "You weighed this ingredient; another person must check it.", { ...checker.refusalDetails(), rule: "V-SOD" });
    }
  });
}

async function voidDispenseCore(
  ctx: AuthContext,
  dispenseRecordId: string,
  reason: string,
  action: "production.dispense_record.voided" | "production.dispense_record.returned",
  assertRec?: (rec: typeof dispenseRecords.$inferSelect) => void,
) {
  const input = { dispenseRecordId };
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
    assertRec?.(rec);
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
      action,
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
  if (open.length) out.push(`${plural(open.length, "ingredient")} still ${open.length === 1 ? "needs" : "need"} to be weighed: ${open.map((l) => l.name).join(", ")}.`);
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
    if (needing.length) out.push(`${plural(needing.length, "weighing")} still ${needing.length === 1 ? "needs" : "need"} the checker's signature.`);
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
