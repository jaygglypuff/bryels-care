"use server";
import { z } from "zod";
import { type AuthContext, requireContext } from "@/lib/auth/context";
import { coSign } from "@/lib/auth/co-sign";
import { type ActionState, DomainError, toActionState } from "@/lib/errors";
import { refreshCurrentPage } from "@/lib/in-place";
import type { Permission } from "@/lib/permissions";
import { approveStepException, batchSiteId, checkDispense, checkStep, confirmPicked, issuePackaging, printBatchLabels, recordDispense, stepDone, submitChecklist } from "@/modules/production";
import { registerAppHooks } from "@/modules/wiring";

// Execution ↔ QA hooks (deviations for early ends and out-of-range values); idempotent.
registerAppHooks();

/**
 * Server actions of the production flow v2 operator screens (ADR-080 stage G2): Materials list,
 * Weigh, Step. Thin adapters: read the form, build the co-signer (name pick, ADR-078), call the
 * service, refresh the page in place (ADR-043). Every rule lives in src/modules/production.
 */

const uuid = z.string().uuid("Choose a valid option.");
const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : undefined;
};
const opt = (fd: FormData, k: string) => {
  const v = str(fd, k)?.trim();
  return v ? v : null;
};
const stepNoOf = (fd: FormData) => z.coerce.number().int().min(1).max(999).parse(str(fd, "stepNo"));

/** The second person who signs on this tablet by picking their name (password only when the setting asks). */
async function signer(ctx: AuthContext, fd: FormData, prefix: "checker" | "approver", permission: Permission, batchId: string): Promise<AuthContext | null> {
  const id = opt(fd, `${prefix}Id`);
  if (!id) return null;
  const siteId = await batchSiteId(ctx, batchId);
  return coSign(ctx, { userId: id, password: str(fd, `${prefix}Password`) ?? "", role: prefix === "checker" ? "checker" : "exception_approver", permission, siteId });
}

export type FlowActionState = (NonNullable<ActionState> & { dispenseRecordId?: string; needsCheck?: boolean }) | null;

/** Materials list: one line (Taken, Not needed, Undo) or "All taken". */
export async function pickAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const batchId = uuid.parse(str(fd, "batchId"));
    const all = str(fd, "all") === "1";
    const action = z.enum(["taken", "not_needed", "untaken"]).catch("taken").parse(str(fd, "pick"));
    const r = await confirmPicked(ctx, {
      batchId,
      all,
      lines: all ? [] : [{ batchMaterialId: uuid.parse(str(fd, "batchMaterialId")), action, reason: opt(fd, "reason"), lotCode: opt(fd, "lotCode") }],
      toLocationCode: opt(fd, "toLocationCode"),
      idempotencyKey: opt(fd, "idempotencyKey"),
    });
    refreshCurrentPage();
    const n = r.progress.taken + r.progress.notNeeded;
    return { ok: true, message: r.ready ? `All ${r.progress.lines} taken. Materials ready: start the batch.` : `${n} of ${r.progress.lines} taken.` };
  } catch (e) {
    return toActionState(e);
  }
}

/** Weigh card Save: preselected lot confirmed by the last 4 (or a scan), net weight from the keypad. */
export async function weighAction(_: FlowActionState, fd: FormData): Promise<FlowActionState> {
  try {
    const ctx = await requireContext();
    const batchId = uuid.parse(str(fd, "batchId"));
    const lotId = uuid.parse(str(fd, "lotId"));
    const r = await recordDispense(ctx, {
      batchId,
      batchMaterialId: uuid.parse(str(fd, "batchMaterialId")),
      lotRef: lotId,
      lotPreselected: true,
      lotConfirm: opt(fd, "lotConfirm"),
      locationRef: opt(fd, "locationId"),
      qty: opt(fd, "qty"),
      uom: "g",
      equipmentRef: opt(fd, "equipmentRef"),
      idempotencyKey: opt(fd, "idempotencyKey"),
    });
    refreshCurrentPage();
    const needsCheck = str(fd, "needsCheck") === "1" && !r.checked;
    return { ok: true, message: needsCheck ? `${r.materialName}: saved. Second check needed.` : `${r.materialName}: saved.`, dispenseRecordId: r.dispenseRecordId, needsCheck };
  } catch (e) {
    return toActionState(e);
  }
}

/** "Yes, I checked": the checker picked their name on this tablet and confirms the weighing (2 taps, ADR-078). */
export async function checkWeighingAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const batchId = uuid.parse(str(fd, "batchId"));
    const checker = await signer(ctx, fd, "checker", "production.dispense_record.approve", batchId);
    if (!checker) throw new DomainError("validation", "Pick the name of the person who watched you weigh.", { field: "checkerId" });
    const r = await checkDispense(checker, { dispenseRecordId: uuid.parse(str(fd, "dispenseRecordId")), signedOn: "operator_device", idempotencyKey: opt(fd, "idempotencyKey") });
    refreshCurrentPage();
    return { ok: true, message: `${r.materialName}: checked by ${checker.displayName}.` };
  } catch (e) {
    return toActionState(e);
  }
}

/** Start check / Before wrapping check: Yes / No per item, or All OK (every item yes, still one answer each). */
export async function checklistCardAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const batchId = uuid.parse(str(fd, "batchId"));
    const stepNo = stepNoOf(fd);
    const itemIds = (str(fd, "itemIds") ?? "").split(",").filter(Boolean);
    const allOk = str(fd, "allOk") === "1";
    const answers = itemIds.map((itemId) => {
      const a = allOk ? "yes" : str(fd, `answer-${itemId}`);
      if (a !== "yes" && a !== "no") throw new DomainError("validation", "Answer every check with Yes or No.", { fieldErrors: { [`answer-${itemId}`]: "Yes or No." } });
      return { itemId, answer: a as "yes" | "no", note: allOk ? null : opt(fd, `note-${itemId}`) };
    });
    const checker = await signer(ctx, fd, "checker", "production.line_clearance.approve", batchId);
    const r = await submitChecklist(ctx, { batchId, stepNo, answers, idempotencyKey: opt(fd, "idempotencyKey") }, { checker });
    refreshCurrentPage();
    if (r.blocked) return { ok: false, message: `Saved. This step is not done yet: ${r.blockers.join(" ")}` };
    return { ok: true, message: r.status === "completed" ? `${answers.length} checks recorded as OK. ${r.name} done.` : `${answers.length} checks saved. Waiting for the second check.` };
  } catch (e) {
    return toActionState(e);
  }
}

/** Step done: the typed values (param-<id>, correction-<id>) and the step completion in one command. */
export async function stepDoneAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const batchId = uuid.parse(str(fd, "batchId"));
    const stepNo = stepNoOf(fd);
    const ids = (str(fd, "parameterIds") ?? "").split(",").filter(Boolean);
    const readings = ids.map((parameterId) => ({ parameterId, value: str(fd, `param-${parameterId}`) ?? "", correctionReason: opt(fd, `correction-${parameterId}`) }));
    const checker = await signer(ctx, fd, "checker", "production.process_step_record.approve", batchId);
    const r = await stepDone(ctx, { batchId, stepNo, readings, notes: opt(fd, "notes"), idempotencyKey: opt(fd, "idempotencyKey") }, { checker });
    refreshCurrentPage();
    if (r.blocked) return { ok: false, message: `Saved. ${r.blockers.map((b) => b.message).join(" ")}` };
    return { ok: true, message: r.status === "completed" ? `${r.name}: step done.` : `${r.name}: saved. Waiting for the second check.` };
  } catch (e) {
    return toActionState(e);
  }
}

/** Ask to end early / accept a value outside its range: an approver picks their name and gives the reason (CX-TOL). */
export async function endEarlyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const batchId = uuid.parse(str(fd, "batchId"));
    const approver = await signer(ctx, fd, "approver", "production.over_tolerance_dispense.approve", batchId);
    if (!approver) throw new DomainError("validation", "Pick the name of the person who approves.", { field: "approverId" });
    await approveStepException(ctx, { batchId, stepNo: stepNoOf(fd), reason: str(fd, "reason") ?? "" }, { approver });
    refreshCurrentPage();
    return { ok: true, message: `Approved by ${approver.displayName}. Tap the step button again to finish it.` };
  } catch (e) {
    return toActionState(e);
  }
}

/** A step waiting for its second check: the checker picks their name on this tablet and confirms (ADR-078). */
export async function checkStepAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const batchId = uuid.parse(str(fd, "batchId"));
    const stepNo = stepNoOf(fd);
    const permission: Permission = str(fd, "stepKind") === "line_clearance" ? "production.line_clearance.approve" : "production.process_step_record.approve";
    const checker = await signer(ctx, fd, "checker", permission, batchId);
    if (!checker) throw new DomainError("validation", "Pick the name of the person who checks.", { field: "checkerId" });
    const r = await checkStep(checker, { batchId, stepNo, idempotencyKey: opt(fd, "idempotencyKey") });
    refreshCurrentPage();
    return { ok: true, message: `${r.name}: checked by ${checker.displayName}.` };
  } catch (e) {
    return toActionState(e);
  }
}

export type LabelActionState = (NonNullable<ActionState> & { jobId?: string; alreadyPrinted?: boolean }) | null;

/** "Print labels for this batch (N labels)" (ADR-088 §3): one label job of N copies; the page then opens its print view. */
export async function printBatchLabelsAction(_: LabelActionState, fd: FormData): Promise<LabelActionState> {
  try {
    const ctx = await requireContext();
    const r = await printBatchLabels(ctx, { batchId: uuid.parse(str(fd, "batchId")), copies: str(fd, "copies") ?? "", idempotencyKey: opt(fd, "idempotencyKey") ?? "" });
    refreshCurrentPage();
    return {
      ok: true,
      jobId: r.jobId,
      alreadyPrinted: r.alreadyPrinted,
      message: r.alreadyPrinted ? `These labels (lot ${r.lotNumber}) were already made. Open them, or reprint with a reason.` : `${r.copies} labels ready: lot ${r.lotNumber}, expiry ${r.expiresOn}.`,
    };
  } catch (e) {
    return toActionState(e);
  }
}

/** Packaging step without wrappers on the materials list: the operator scans or types the lot used (fallback). */
export async function packagingLotAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const r = await issuePackaging(ctx, { batchId: uuid.parse(str(fd, "batchId")), stepNo: stepNoOf(fd), lotRef: str(fd, "lotRef") ?? "", qty: str(fd, "qty") ?? "", locationRef: opt(fd, "locationRef"), idempotencyKey: opt(fd, "idempotencyKey") });
    refreshCurrentPage();
    return { ok: true, message: `${r.materialName} lot ${r.lotNumber} recorded.` };
  } catch (e) {
    return toActionState(e);
  }
}
