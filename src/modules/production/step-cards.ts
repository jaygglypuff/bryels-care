import "server-only";
import { eq } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import { processStepRecords } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { getSetting } from "@/lib/settings";
import { checkPermission, findStep, finishStep, openStep, performPermission, sortedSteps, stepRecords } from "./execution";
import { postPackagingConsumption } from "./execution-postings";
import { getBatchExecution, signerOptions } from "./execution-queries";
import { currentStepOf, isWaitStep, shortDay, waitLabel } from "./flow-facts";
import { currentPackaging, RECONCILED_STEP_KINDS } from "./packaging";
import { batchLabelInfo, issueTakenPackagingLocked, packagingLinesOf } from "./packaging-flow";
import { currentReadings, recordReadingInTx } from "./process";
import { type FormulaSnapshot, idempotent, isWeighingStep, lockBatch } from "./shared";
import { stepBlockers } from "./steps";

/**
 * Production flow v2, slice V2-5 (ADR-080 §11, UX review S5): the generic Step screen. One step per
 * screen: the instruction, up to 3 number or yes/no fields (each with its own name and unit), the
 * checklist with All OK for check steps, and one button. A waiting step (curing, resting, in the
 * mould) shows "Curing until Fri 28 Nov"; ending it before that needs an approver and a reason.
 */

/** Fields shown on the card; the rest of a step's parameters are under More details. */
export const STEP_CARD_MAX_FIELDS = 3;

export async function getStepCard(ctx: AuthContext, batchId: string, stepNo: number, now = new Date()) {
  const ex = await getBatchExecution(ctx, batchId); // production.batch.view + site scope
  const b = ex.batch;
  const idx = ex.steps.findIndex((s) => s.stepNo === stepNo);
  if (idx < 0) throw new DomainError("not_found", "This step is not part of the batch.");
  const step = ex.steps[idx];
  const recs = await stepRecords(db, b.id);
  const current = currentStepOf(b.formulaSnapshot as FormulaSnapshot, recs, now);
  const required = step.parameters.filter((p) => p.isRequired);
  const optional = step.parameters.filter((p) => !p.isRequired);
  const shown = [...required, ...optional].slice(0, STEP_CARD_MAX_FIELDS);
  const more = [...required, ...optional].slice(STEP_CARD_MAX_FIELDS);
  const readyAt = isWaitStep(step.stepKind) ? (step.record?.earliestCompletionAt ?? null) : null;
  const waiting = !!readyAt && step.status === "in_progress" && readyAt.getTime() > now.getTime();
  const earlier = ex.steps.slice(0, idx).find((s) => s.status !== "completed" && s.status !== "skipped") ?? null;
  const next = ex.steps[idx + 1] ?? null;
  const executable = b.status === "in_process" || (b.status === "materials_staged" && step.stepKind === "line_clearance");
  const blockedReason =
    b.status === "planned"
      ? "Get the materials first."
      : !executable
        ? b.status === "materials_staged"
          ? `Do the Start check first.`
          : `Batch ${b.batchNumber} is past this step.`
        : earlier
          ? `Finish "${earlier.name}" first.`
          : null;
  const canPerform = ctx.can(performPermission(step.stepKind));
  const checkers = step.requiresChecker ? await signerOptions(ctx, b.siteId, checkPermission(step.stepKind)) : [];
  const approvers = isWaitStep(step.stepKind) || step.parameters.length ? await signerOptions(ctx, b.siteId, "production.over_tolerance_dispense.approve") : [];
  // ADR-088 §3: the packaging step shows the wrappers/labels taken at Get materials and the label button.
  const isPackaging = (RECONCILED_STEP_KINDS as readonly string[]).includes(step.stepKind);
  const packagingLines = isPackaging ? await packagingLinesOf(db, b) : [];
  const issuedHere = isPackaging ? (await currentPackaging(db, b.id)).filter((r) => step.record && r.r.processStepRecordId === step.record.id) : [];
  return {
    batch: b,
    product: ex.product,
    step: {
      stepNo: step.stepNo,
      name: step.name,
      kind: step.stepKind,
      instruction: step.instruction,
      workInstruction: step.workInstruction ?? null,
      status: step.status,
      index: idx + 1,
      total: ex.steps.length,
      requiresChecker: step.requiresChecker,
      requiresEquipment: !!step.requiresEquipment,
      equipmentKind: step.equipmentKind ?? null,
      checklist: step.checklist,
      fields: shown,
      moreFields: more,
      record: step.record,
      blockers: step.blockers,
      isWait: isWaitStep(step.stepKind),
      isWeighing: isWeighingStep(step.stepKind),
      isTransfer: step.stepKind === "transfer",
      isCheck: (step.checklist ?? []).length > 0,
      readyAt,
      readyLabel: readyAt ? shortDay(readyAt) : null,
      waiting,
      waitingLabel: readyAt && step.status === "in_progress" ? waitLabel(step.stepKind, step.name, readyAt, now) : null,
      daysLeft: readyAt && waiting ? Math.ceil((readyAt.getTime() - now.getTime()) / 86_400_000) : 0,
      exceptionApproved: !!step.record?.deviationId,
    },
    next: next ? { stepNo: next.stepNo, name: next.name, kind: next.stepKind } : null,
    isLastMakingStep: !!next && next.stepKind === "transfer",
    current: current ? { stepNo: current.stepNo, name: current.name } : null,
    packaging: isPackaging
      ? {
          lines: packagingLines,
          /** Nothing on the list and nothing recorded: the operator scans (or types) the lot used (fallback). */
          needsScan: issuedHere.length === 0 && !packagingLines.some((l) => l.plan.length > 0 || l.issued.length > 0),
          labels: await batchLabelInfo(ctx, b),
        }
      : null,
    blockedReason,
    canPerform: canPerform && !blockedReason && step.status !== "completed",
    checkers: checkers.map((c) => ({ id: c.id, displayName: c.displayName })),
    approvers: approvers.map((c) => ({ id: c.id, displayName: c.displayName })),
    passwordRequired: await getSetting(db, ctx.organizationId, "production.sign_off.require_password"),
  };
}
export type StepCardView = Awaited<ReturnType<typeof getStepCard>>;

export type StepDoneInput = {
  batchId: string;
  stepNo: number;
  /** Values typed on the card (keypad or Yes/No). Empty values are ignored. */
  readings?: { parameterId: string; value: string; correctionReason?: string | null }[];
  notes?: string | null;
  idempotencyKey?: string | null;
};

export type StepDoneResult = {
  stepNo: number;
  name: string;
  status: "in_progress" | "awaiting_check" | "completed";
  blocked: boolean;
  blockers: { message: string; exceptionable: boolean }[];
  /** The next step, started automatically when it is a wait (the timer starts now). */
  next: { stepNo: number; name: string; kind: string; readyAt: string | null } | null;
};

/**
 * "Step done" (V2-5): in one transaction records the typed values (a changed value needs a correction
 * reason, the old one stays), then completes the step with the existing rules (stepBlockers,
 * finishStep: checker, equipment, limits, minimum wait). Readings outside their limits are kept and
 * the step stays open with the reason (returned, not thrown, so the values are not lost). When the
 * next step is a wait (curing, rest), it starts at once so its ready date is set. Idempotent.
 */
export async function stepDone(ctx: AuthContext, input: StepDoneInput, signers: { checker?: AuthContext | null } = {}): Promise<StepDoneResult> {
  return db.transaction(async (tx) => {
    const batch = await lockBatch(tx, ctx, input.batchId);
    const { result } = await idempotent(tx, ctx, input.idempotencyKey, "production.step_card.done", async () => {
      const step = findStep(batch, input.stepNo);
      const perm = performPermission(step.stepKind);
      ctx.require(perm === "production.dispense_record.create" ? "production.process_step_record.create" : perm);
      if (step.stepKind === "transfer") throw new DomainError("validation", "This step is done on the Finish screen.");
      if ((step.checklistItems ?? []).length) {
        const existing = (await stepRecords(tx, batch.id)).find((r) => r.stepNo === step.stepNo);
        if (!existing) throw new DomainError("validation", `Answer the checks of ${step.name} first (Yes / No, or All OK).`);
      }
      const typed = (input.readings ?? []).filter((r) => (r.value ?? "").trim() !== "");
      if (typed.length && !(step.parameters ?? []).length) throw new DomainError("validation", "This step has no fields to fill.");
      if (typed.length) ctx.require("production.process_step_record.create");
      if (signers.checker) {
        // Validated again in finishStep; checked early so nothing is written for a wrong checker.
        if (signers.checker.userId === ctx.userId && !ctx.ownerOverride) throw new DomainError("separation_of_duties", "The checker must be a different person.");
      }
      const rec = await openStep(tx, ctx, batch, step);
      // ADR-088 §3: the wrappers and labels taken at Get materials are recorded on this step (no scan).
      await issueTakenPackagingLocked(tx, ctx, batch, step, rec);
      const now = await currentReadings(tx, rec.id);
      for (const r of typed) {
        const p = (step.parameters ?? []).find((x) => x.id === r.parameterId);
        if (!p) throw new DomainError("validation", "A field is not part of this step.");
        const prev = now.find((x) => x.routingStepParameterId === p.id);
        const prevValue = prev ? (prev.valueNumeric ?? prev.valueText ?? (prev.valueBoolean === null ? null : prev.valueBoolean ? "yes" : "no")) : null;
        if (prev && prevValue !== null && sameValue(prevValue, r.value, p.valueKind)) continue;
        await recordReadingInTx(tx, ctx, batch, step, rec, { parameterId: p.id, value: r.value, correctionReason: r.correctionReason ?? null });
      }
      const blockers = await stepBlockers(tx, ctx, batch, step, rec);
      if (blockers.length) {
        await tx.update(processStepRecords).set({ blockedReason: blockers.map((x) => x.message).join(" ") }).where(eq(processStepRecords.id, rec.id));
        return { stepNo: step.stepNo, name: step.name, status: "in_progress" as const, blocked: true, blockers, next: null };
      }
      const fin = await finishStep(tx, ctx, batch, step, rec, { checker: signers.checker ?? null, notes: input.notes });
      if (await getSetting(tx, ctx.organizationId, "production.post_consumption_at_dispense", batch.siteId)) {
        for (const row of await currentPackaging(tx, batch.id)) {
          if (row.r.processStepRecordId === rec.id) await postPackagingConsumption(tx, ctx, batch, row.r, row.materialName);
        }
      }
      let next: StepDoneResult["next"] = null;
      const ordered = sortedSteps(batch.formulaSnapshot as FormulaSnapshot);
      const ns = ordered.find((s) => s.stepNo > step.stepNo) ?? null;
      if (ns) {
        next = { stepNo: ns.stepNo, name: ns.name, kind: ns.stepKind, readyAt: null };
        if (fin.status === "completed" && isWaitStep(ns.stepKind) && batch.status === "in_process" && ctx.can(performPermission(ns.stepKind))) {
          const nrec = await openStep(tx, ctx, batch, ns);
          next.readyAt = nrec.earliestCompletionAt?.toISOString() ?? null;
        }
      }
      return { stepNo: step.stepNo, name: step.name, status: fin.status as StepDoneResult["status"], blocked: false, blockers: [], next };
    });
    return result;
  });
}

function sameValue(stored: string, typed: string, kind: string) {
  const t = typed.trim().toLowerCase();
  if (kind === "numeric") {
    try {
      return t !== "" && new Decimal(stored).eq(new Decimal(t.replace(/,/g, "")));
    } catch {
      return false;
    }
  }
  if (kind === "boolean") return ["yes", "true", "pass"].includes(t) === (stored === "yes" || stored === "true");
  return stored.trim().toLowerCase() === t;
}

