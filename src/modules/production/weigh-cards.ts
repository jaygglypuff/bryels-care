import "server-only";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import type { AuthContext } from "@/lib/auth/context";
import { typedChecksAllowed } from "@/lib/scan/typed-check";
import { getSetting } from "@/lib/settings";
import { shownRange, toleranceRange } from "./weigh-window";
import { equipmentOptions, getBatchExecution, signerOptions } from "./execution-queries";
import { currentStepOf } from "./flow-facts";
import { usableLotsForBatch } from "./queries";
import { CHECKER_PERMISSION, type FormulaSnapshot, WEIGHING_STEP_KINDS } from "./shared";
import { expectedLots } from "./staging";
import { stepRecords } from "./execution";
import { plainWords } from "./plain-words";
import { weighBlockCode, weighBlockWords } from "./weigh-block";
import { weighUnitFor } from "./floor-words";
import { pickPlanForLine } from "./materials-list";
import { weighProposal } from "./pick-plan";
import { LOT_CHANGE_REASONS, alternativesForLine, batchMaterialChanges, otherLotOptions, qaDeciderNames, substitutionRequestsOf } from "./material-swaps";

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
  const typedChecks = await typedChecksAllowed(db, ctx.organizationId); // ADR-126: the Weigh card hides typing when off
  const checkMode = await getSetting(db, ctx.organizationId, "production.weighing.second_person_check", b.siteId);
  const scales = step ? await equipmentOptions(ctx, b.siteId, step.equipmentKind ?? "scale") : [];
  const checkers = await signerOptions(ctx, b.siteId, CHECKER_PERMISSION);
  const recs = await stepRecords(db, b.id);
  const current = currentStepOf(snap, recs);

  // ADR-104 §1: lot changes, swapped lines and requests to QA shown on the card.
  const changes = await batchMaterialChanges(db, b.id);
  const requests = await substitutionRequestsOf(db, b.id);
  const qaNames = requests.some((r) => r.r.status === "pending") ? await qaDeciderNames(db, ctx.organizationId, b.siteId, ctx.userId) : null;
  const canChange = ctx.can("production.dispense_record.create") && ctx.canAt("production.dispense_record.create", b.siteId) && ["planned", "materials_staged", "in_process"].includes(b.status);

  const cards = [];
  for (const ing of ex.ingredients) {
    if (ing.status === "substituted") continue; // replaced for this batch (its history stays on the batch record)
    const bm = ing;
    const snapLine = snap.lines.find((x) => (ing.bomLineId ? x.bomLineId === ing.bomLineId : x.lineNo === ing.lineNo)) ?? snap.lines.find((x) => x.lineNo === ing.lineNo);
    // Tolerance: the line's own (a swapped line keeps the recipe line's percentage, absolute band scaled).
    const tol = toleranceRange(ing.theoreticalQtyG, bm.tolerancePct ?? snapLine?.tolerancePct ?? 0, bm.toleranceAbsG ?? null);
    const materialId = ing.materialId;
    const setAside = b.workOrderId && materialId ? await expectedLots(db, b.workOrderId, materialId) : [];
    const options = (materialId ? usable[materialId] : undefined) ?? [];
    const isSetAside = (o: { lotId: string; locationId: string }) => setAside.some((r) => r.r.lotId === o.lotId && r.r.locationId === o.locationId);
    // Lots set aside for the order come first; when there are any, only those can be used (dispensing rule).
    const allowed = setAside.length ? options.filter(isSetAside) : options;
    // The lot chosen with "Use another lot" (latest change of this line) is the one to weigh now.
    const lastLot = [...changes].reverse().find((c) => c.batchMaterialId === bm.id && (c.kind === "floor_lot" || c.kind === "qa_lot"));
    const lastLotNumber = lastLot?.toLot ?? null;
    const lots = lastLotNumber ? [...allowed.filter((l) => l.lotNumber === lastLotNumber), ...allowed.filter((l) => l.lotNumber !== lastLotNumber)] : allowed;
    const open = !(ing.status === "dispensed" || ing.status === "exception");
    const pending = requests.find((r) => r.r.batchMaterialId === bm.id && r.r.status === "pending") ?? null;
    const refused = requests.find((r) => r.r.batchMaterialId === bm.id && r.r.status === "refused") ?? null;
    const swappedFrom = changes.find((c) => c.newBatchMaterialId === bm.id) ?? null;
    const nothingWeighed = new Decimal(ing.dispensedQtyG).eq(0);
    const plan = open && b.workOrderId ? await pickPlanForLine(db, b, { materialId: ing.materialId, theoreticalQtyG: ing.theoreticalQtyG, dispensedQtyG: ing.dispensedQtyG }, ing.baseUom) : null;
    const live = ing.weighings.filter((w) => !w.voided);
    const unchecked = live.filter((w) => !w.checker);
    const needsCheck = snapLine?.requiresChecker !== false;
    cards.push({
      batchMaterialId: bm.id,
      lineNo: ing.lineNo,
      materialCode: ing.materialCode,
      materialName: ing.materialName,
      baseUom: ing.baseUom,
      /** Round 5 problem 4: the unit the operator types (kg for 1 kg or more of a gram material; stored in grams). */
      unit: weighUnitFor(ing.baseUom, tol.target),
      // Rounded to the typed resolution (3 decimals) the same way the weigh service checks (weigh-window.ts).
      target: tol.target.toString(),
      min: tol.min.toString(),
      max: tol.max.toString(),
      /** "OK from … to …" at 0.1 g, never wider than what the server accepts. */
      minShown: shownRange(tol.min, tol.max).lo.toString(),
      maxShown: shownRange(tol.min, tol.max).hi.toString(),
      weighed: new Decimal(ing.dispensedQtyG).toString(),
      status: ing.status,
      done: ing.status === "dispensed" || ing.status === "exception",
      needsCheck,
      lots: lots.map((l) => ({ ...l, last4: l.lotNumber.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(-4) })),
      /** Saved weighings that still wait for the second check (the 2-tap confirm). */
      waitingForCheck: needsCheck ? unchecked.map((w) => ({ id: w.id, qtyG: w.qtyG, lotNumber: w.lotNumber, operatorId: w.operatorId, operator: w.operator })) : [],
      weighings: live.map((w) => ({ id: w.id, qtyG: w.qtyG, lotNumber: w.lotNumber, operator: w.operator, checker: w.checker, within: w.within, partial: w.partial })),
      /** ADR-106 §3: the lots taken at Get materials, in the same order, with how much from each. */
      plan: plan ? plan.steps.map((x) => ({ lotId: x.lotId, lotNumber: x.lotNumber, take: x.take, place: x.place })) : [],
      proposal: plan ? weighProposal(plan, ing.baseUom) : null,
      /** ADR-104 §1a: other released lots of this ingredient ("Use another lot"), use-first on top. */
      otherLots: open && canChange && !pending ? (await otherLotOptions(ctx, b, bm.id)).filter((o) => !o.setAsideNow) : [],
      /** ADR-104 §1b: the recipe's approved alternatives (only while nothing is weighed on the line). */
      alternatives: open && canChange && nothingWeighed && !pending && !swappedFrom ? (await alternativesForLine(db, { bomLineId: ing.bomLineId, theoreticalQtyG: ing.theoreticalQtyG })).filter((a) => a.active) : [],
      canAskOther: open && canChange && nothingWeighed && !pending && !swappedFrom,
      /** A request to QA that still waits: "Waiting for QA (Nina) to say yes". */
      waitingForQa: pending ? { requestId: pending.r.id, substituteName: pending.substituteName, qty: pending.r.qtyBase, uom: pending.uom, reason: pending.r.reason, by: pending.by, mine: pending.r.requestedBy === ctx.userId, qaNames } : null,
      refusedByQa: !pending && refused && !swappedFrom ? { substituteName: refused.substituteName, note: refused.r.decisionNote } : null,
      /** This line replaced the recipe's ingredient for this batch ("Instead of Coconut Oil"). */
      insteadOf: swappedFrom ? { materialName: swappedFrom.materialName, sentence: swappedFrom.sentence } : null,
      lotChanges: changes.filter((c) => c.batchMaterialId === bm.id && (c.kind === "floor_lot" || c.kind === "qa_lot")).map((c) => c.sentence),
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
              ? `Finish "${plainWords(current.name)}" first.`
              : null;
  return {
    batch: b,
    product: ex.product,
    step: step ? { stepNo: step.stepNo, name: step.name, status: step.status, requiresEquipment: !!step.requiresEquipment, blockers: step.blockers, index: ex.steps.findIndex((s) => s.stepNo === step.stepNo) + 1, total: ex.steps.length } : null,
    /** Round 5 problem 10: the button after the weighing step says "Done — go to <next step>". */
    nextStep: step ? (() => { const n = [...ex.steps].sort((x, y) => x.stepNo - y.stepNo).find((s) => s.stepNo > step.stepNo); return n ? { stepNo: n.stepNo, name: plainWords(n.name) } : null; })() : null,
    cards,
    weighedCount,
    uncheckedCount,
    totalWeighed: cards.reduce((s, c) => s.plus(c.weighed), new Decimal(0)).toString(),
    totalTarget: cards.reduce((s, c) => s.plus(c.target), new Decimal(0)).toString(),
    settings: { lotConfirm, checkMode, typedChecks },
    scales: scales.map((s) => ({ id: s.id, code: s.code, name: s.name, usable: s.usable, calibrationDueDate: s.calibrationDueDate, why: s.why, canRecordCleaning: s.canRecordCleaning, fixHelp: s.fixHelp })),
    checkers: checkers.map((c) => ({ id: c.id, displayName: c.displayName })),
    blockedReason,
    canWeigh: ctx.can("production.dispense_record.create") && b.status === "in_process" && !!step && step.status !== "completed" && !blockedReason,
    /** Why Save is pale (finding 2): a state reason first (not started, earlier step), the role only last. */
    weighBlock: (() => {
      const first = [...ex.steps].sort((x, y) => x.stepNo - y.stepNo)[0] ?? null;
      const facts = {
        canCreate: ctx.can("production.dispense_record.create") && ctx.canAt("production.dispense_record.create", b.siteId),
        batchStatus: b.status,
        batchNumber: b.batchNumber,
        hasStep: !!step,
        stepDone: step?.status === "completed",
        earlierStep: step && current && current.stepNo < step.stepNo ? { stepNo: current.stepNo, name: current.name } : null,
      };
      const code = weighBlockCode(facts);
      return code ? { code, ...weighBlockWords(code, { ...facts, firstStepName: first ? plainWords(first.name) : null }), buttonStepNo: code === "earlier_step" ? facts.earlierStep!.stepNo : (first?.stepNo ?? null) } : null;
    })(),
    // ADR-130: a checker standing here may type their own password on this phone (never a name alone).
    sameDevice: await getSetting(db, ctx.organizationId, "production.sign_off.same_device"),
    lotChangeReasons: Object.entries(LOT_CHANGE_REASONS).map(([code, label]) => ({ code, label })),
    changes: changes.map((c) => c.sentence),
  };
}
export type WeighView = Awaited<ReturnType<typeof getWeighView>>;
