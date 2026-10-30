import "server-only";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import type { AuthContext } from "@/lib/auth/context";
import { getSetting } from "@/lib/settings";
import { toleranceRange } from "./dispensing";
import { equipmentOptions, getBatchExecution, signerOptions } from "./execution-queries";
import { currentStepOf } from "./flow-facts";
import { usableLotsForBatch } from "./queries";
import { CHECKER_PERMISSION, type FormulaSnapshot, WEIGHING_STEP_KINDS } from "./shared";
import { expectedLots } from "./staging";
import { stepRecords } from "./execution";

/**
 * Production flow v2, slice V2-4 (ADR-080 §3–4, UX review S4): the Weigh screen. One card per
 * ingredient in formula order: target and OK range, the preselected lot (set aside for the order,
 * else use-first), the lot confirmation the site asks for, whether a second check is needed, and
 * the weighings so far. Read only; the commands are recordDispense (lot id + lotConfirm) and
 * checkDispense (checker picked by name on this device, ADR-078).
 */
export async function getWeighView(ctx: AuthContext, batchId: string) {
  const ex = await getBatchExecution(ctx, batchId); // production.batch.view + site scope
  const b = ex.batch;
  const snap = b.formulaSnapshot as FormulaSnapshot;
  const step = ex.steps.find((s) => (WEIGHING_STEP_KINDS as readonly string[]).includes(s.stepKind)) ?? null;
  const usable = await usableLotsForBatch(ctx, b.id);
  const lotConfirm = await getSetting(db, ctx.organizationId, "production.weighing.lot_confirm", b.siteId);
  const checkMode = await getSetting(db, ctx.organizationId, "production.weighing.second_person_check", b.siteId);
  const scales = step ? await equipmentOptions(ctx, b.siteId, step.equipmentKind ?? "scale") : [];
  const checkers = await signerOptions(ctx, b.siteId, CHECKER_PERMISSION);
  const recs = await stepRecords(db, b.id);
  const current = currentStepOf(snap, recs);

  const cards = [];
  for (const ing of ex.ingredients) {
    const bm = ing;
    const snapLine = snap.lines.find((x) => x.lineNo === ing.lineNo);
    const tol = snapLine ? toleranceRange(ing.theoreticalQtyG, snapLine.tolerancePct, snapLine.toleranceAbsG ?? null) : toleranceRange(ing.theoreticalQtyG, 0, null);
    const materialId = snapLine?.materialId ?? null;
    const setAside = b.workOrderId && materialId ? await expectedLots(db, b.workOrderId, materialId) : [];
    const options = (materialId ? usable[materialId] : undefined) ?? [];
    const isSetAside = (o: { lotId: string; locationId: string }) => setAside.some((r) => r.r.lotId === o.lotId && r.r.locationId === o.locationId);
    // Lots set aside for the order come first; when there are any, only those can be used (dispensing rule).
    const lots = setAside.length ? options.filter(isSetAside) : options;
    const live = ing.weighings.filter((w) => !w.voided);
    const unchecked = live.filter((w) => !w.checker);
    const needsCheck = snapLine?.requiresChecker !== false;
    cards.push({
      batchMaterialId: bm.id,
      lineNo: ing.lineNo,
      materialCode: ing.materialCode,
      materialName: ing.materialName,
      baseUom: ing.baseUom,
      target: new Decimal(ing.theoreticalQtyG).toString(),
      min: tol.min.toDecimalPlaces(3).toString(),
      max: tol.max.toDecimalPlaces(3).toString(),
      weighed: new Decimal(ing.dispensedQtyG).toString(),
      status: ing.status,
      done: ing.status === "dispensed" || ing.status === "exception",
      needsCheck,
      lots: lots.map((l) => ({ ...l, last4: l.lotNumber.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(-4) })),
      /** Saved weighings that still wait for the second check (the 2-tap confirm). */
      waitingForCheck: needsCheck ? unchecked.map((w) => ({ id: w.id, qtyG: w.qtyG, lotNumber: w.lotNumber, operatorId: w.operatorId, operator: w.operator })) : [],
      weighings: live.map((w) => ({ id: w.id, qtyG: w.qtyG, lotNumber: w.lotNumber, operator: w.operator, checker: w.checker, within: w.within, partial: w.partial })),
    });
  }
  const weighedCount = cards.filter((c) => c.done).length;
  const uncheckedCount = cards.reduce((n, c) => n + c.waitingForCheck.length, 0);
  const blockedReason =
    b.status === "planned" || b.status === "materials_staged"
      ? "Start the batch first."
      : b.status !== "in_process"
        ? `Batch ${b.batchNumber} is past weighing.`
        : !step
          ? "This batch has no weighing step."
          : step.status === "completed"
            ? null
            : current && current.stepNo < step.stepNo
              ? `Finish "${current.name}" first.`
              : null;
  return {
    batch: b,
    product: ex.product,
    step: step ? { stepNo: step.stepNo, name: step.name, status: step.status, requiresEquipment: !!step.requiresEquipment, blockers: step.blockers, index: ex.steps.findIndex((s) => s.stepNo === step.stepNo) + 1, total: ex.steps.length } : null,
    cards,
    weighedCount,
    uncheckedCount,
    totalWeighed: cards.reduce((s, c) => s.plus(c.weighed), new Decimal(0)).toString(),
    totalTarget: cards.reduce((s, c) => s.plus(c.target), new Decimal(0)).toString(),
    settings: { lotConfirm, checkMode },
    scales: scales.map((s) => ({ id: s.id, code: s.code, name: s.name, usable: s.usable, calibrationDueDate: s.calibrationDueDate })),
    checkers: checkers.map((c) => ({ id: c.id, displayName: c.displayName })),
    blockedReason,
    canWeigh: ctx.can("production.dispense_record.create") && b.status === "in_process" && !!step && step.status !== "completed" && !blockedReason,
    passwordRequired: await getSetting(db, ctx.organizationId, "production.sign_off.require_password"),
  };
}
export type WeighView = Awaited<ReturnType<typeof getWeighView>>;
