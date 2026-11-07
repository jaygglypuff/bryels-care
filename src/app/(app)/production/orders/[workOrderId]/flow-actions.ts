"use server";
import { z } from "zod";
import { type AuthContext, requireContext } from "@/lib/auth/context";
import { coSign } from "@/lib/auth/co-sign";
import { parseVia } from "@/lib/scan/pick";
import { type ActionState, DomainError, toActionState } from "@/lib/errors";
import { refreshCurrentPage } from "@/lib/in-place";
import type { Permission } from "@/lib/permissions";
import { markLabelJobPrinted } from "@/modules/documents";
import type { PrintLabelsState } from "@/ui/labels/actions";
import { floorCheckNext } from "@/modules/production";
import { approveStepException, batchSiteId, requestMaterialSubstitution, stopForToday, useApprovedAlternative, withdrawMaterialSubstitution, checkDispense, checkStep, confirmPicked, issuePackaging, planBatchBoxes, printBatchLabels, returnLeftOverWrappers, recordDispense, returnDispense, returnStep, selectEquipment, stepDone, submitChecklist } from "@/modules/production";
import { registerAppHooks } from "@/modules/wiring";
import { recordServiceRecord } from "@/modules/masterdata";

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

/**
 * ADR-110 C5 "Record cleaning" on the weigh card and the step's equipment choice: the same service and audit as the
 * equipment page (recordServiceRecord, cleaning · pass; masterdata.equipment.edit at the equipment's site).
 */
export async function recordCleaningAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const equipmentId = uuid.parse(str(fd, "equipmentId"));
    await recordServiceRecord(ctx, { equipmentId, serviceKind: "cleaning", result: "pass", notes: "Cleaning recorded on the floor (weighing or step screen)", idempotencyKey: opt(fd, "idempotencyKey") ?? undefined });
    refreshCurrentPage();
    return { ok: true, message: `Cleaning recorded by ${ctx.displayName}. ${opt(fd, "code") ?? "The machine"} can be used now.` };
  } catch (e) {
    return toActionState(e);
  }
}

/** The second person who signs on this tablet by picking their name (password only when the setting asks). */
async function signer(ctx: AuthContext, fd: FormData, prefix: "checker" | "approver", permission: Permission, batchId: string): Promise<AuthContext | null> {
  const id = opt(fd, `${prefix}Id`);
  if (!id) return null;
  const siteId = await batchSiteId(ctx, batchId);
  return coSign(ctx, { userId: id, password: str(fd, `${prefix}Password`) ?? "", role: prefix === "checker" ? "checker" : "exception_approver", permission, siteId });
}

export type FlowActionState = (NonNullable<ActionState> & { dispenseRecordId?: string; needsCheck?: boolean }) | null;

/** Who checks next after a hand-off on the floor (docs/NEXT_APPROVER.md); never fails the saved action. */
const nextCheck = (ctx: AuthContext, kind: "weighing_check" | "step_check" | "start_check", batchId: string) => floorCheckNext(ctx, kind, batchId, ctx.userId).catch(() => null);

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
      lines: all ? [] : [{ batchMaterialId: uuid.parse(str(fd, "batchMaterialId")), action, reason: opt(fd, "reason"), lotCode: opt(fd, "lotCode"), lotVia: parseVia(opt(fd, "lotVia")) }],
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
      lotConfirmVia: parseVia(opt(fd, "lotConfirmVia")),
      locationRef: opt(fd, "locationId"),
      qty: opt(fd, "qty"),
      uom: "g",
      equipmentRef: opt(fd, "equipmentRef"),
      // ADR-106 §3: weighing from a lot that was not taken at Get materials (one-tap reason; QA sees a note).
      offPlanReasonCode: opt(fd, "offPlanReasonCode"),
      offPlanNote: opt(fd, "offPlanNote"),
      idempotencyKey: opt(fd, "idempotencyKey"),
    });
    refreshCurrentPage();
    const needsCheck = r.needsCheck;
    return { ok: true, message: needsCheck ? `${r.materialName}: saved. Second check needed.` : `${r.materialName}: saved.`, dispenseRecordId: r.dispenseRecordId, needsCheck, next: needsCheck ? await nextCheck(ctx, "weighing_check", batchId) : null };
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
    if (r.status === "completed") return { ok: true, message: `${answers.length} checks recorded as OK. ${r.name} done.` };
    return { ok: true, message: `${answers.length} checks saved.`, next: await nextCheck(ctx, "start_check", batchId) };
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
    if (r.status === "completed") return { ok: true, message: `${r.name}: step done.` };
    return { ok: true, message: `${r.name}: saved.`, next: await nextCheck(ctx, "step_check", batchId) };
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

/**
 * Packaging step without wrappers on the materials list: the operator TAPS the lot card they used (lot id
 * and shelf id from the list) or scans its label with the camera; nobody types a code (2026-10-31).
 */
export async function packagingLotAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const lotRef = (str(fd, "lotRef") ?? "").trim();
    if (!lotRef) throw new DomainError("validation", "Tap the wrapper or label you used, or scan its label.", { field: "lot", fieldErrors: { lot: "Tap a card or scan." } });
    const r = await issuePackaging(ctx, { batchId: uuid.parse(str(fd, "batchId")), stepNo: stepNoOf(fd), lotRef, qty: str(fd, "qty") ?? "", locationRef: opt(fd, "locationRef"), idempotencyKey: opt(fd, "idempotencyKey") });
    refreshCurrentPage();
    return { ok: true, message: `${r.materialName} lot ${r.lotNumber} recorded for this batch.` };
  } catch (e) {
    return toActionState(e);
  }
}

/* ---------------------------------------------------------------------------------------------
 * One path for production work (2026-10-31): what the old batch workspace did, now on the flow
 * screens. Same services, same rules; only the screen changed.
 * ------------------------------------------------------------------------------------------- */

/** The checker signs a step from their OWN signed-in phone or tablet (own session, no name pick). */
export async function checkStepOwnAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const r = await checkStep(ctx, { batchId: uuid.parse(str(fd, "batchId")), stepNo: stepNoOf(fd), idempotencyKey: opt(fd, "idempotencyKey") });
    refreshCurrentPage();
    return { ok: true, message: `${r.name}: checked by you (${ctx.displayName}).` };
  } catch (e) {
    return toActionState(e);
  }
}

/** The checker sends a step back to the person who did it, with what must be corrected. */
export async function returnStepCardAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    await returnStep(ctx, { batchId: uuid.parse(str(fd, "batchId")), stepNo: stepNoOf(fd), reason: str(fd, "reason") ?? "" });
    refreshCurrentPage();
    return { ok: true, message: "Sent back. The person who did the step corrects it and taps Step done again." };
  } catch (e) {
    return toActionState(e);
  }
}

/** The equipment (mixer, mould…) used on this step, chosen from the list. */
export async function equipmentCardAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const ref = z.string().trim().min(1, "Choose the equipment.").parse(str(fd, "equipmentRef") ?? "");
    const r = await selectEquipment(ctx, { batchId: uuid.parse(str(fd, "batchId")), stepNo: stepNoOf(fd), equipmentRef: ref });
    refreshCurrentPage();
    return { ok: true, message: `${r.equipmentCode} recorded on this step${r.warnings.length ? ` (warnings kept on record: ${r.warnings.join(", ")})` : ""}.` };
  } catch (e) {
    return toActionState(e);
  }
}

/** The checker confirms a weighing from their OWN signed-in phone (own session). */
export async function checkWeighingOwnAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const r = await checkDispense(ctx, { dispenseRecordId: uuid.parse(str(fd, "dispenseRecordId")), signedOn: "own_session", idempotencyKey: opt(fd, "idempotencyKey") });
    refreshCurrentPage();
    return { ok: true, message: `${r.materialName}: checked by you (${ctx.displayName}).` };
  } catch (e) {
    return toActionState(e);
  }
}

/** "No, send it back" on the checker's own phone (re-audit N9): the weighing is voided with the reason and weighed again. */
export async function returnWeighingAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    await returnDispense(ctx, { dispenseRecordId: uuid.parse(str(fd, "dispenseRecordId")), reason: str(fd, "reason") ?? "" });
    refreshCurrentPage();
    return { ok: true, message: "Sent back. The operator weighs it again." };
  } catch (e) {
    return toActionState(e);
  }
}

/**
 * The batch's product labels from the ADR-099 label panel (`<PrintLabelsPanel action=…>`): same form fields
 * (entityId = batch, copies, idempotencyKey); printBatchLabels fixes lot number and dates the first time.
 */
export async function printBatchLabelsPanelAction(_: PrintLabelsState, fd: FormData): Promise<PrintLabelsState> {
  try {
    const ctx = await requireContext();
    const r = await printBatchLabels(ctx, { batchId: uuid.parse(str(fd, "entityId")), copies: str(fd, "copies") ?? "", idempotencyKey: opt(fd, "idempotencyKey") ?? "" });
    refreshCurrentPage();
    return { ok: true, jobId: r.jobId };
  } catch (e) {
    const s = toActionState(e);
    return { ok: false, message: s?.message, fieldErrors: s?.fieldErrors };
  }
}

export type BoxLabelsState = (NonNullable<ActionState> & { href?: string; boxes?: number }) | null;

/** ADR-104 §2 "Print 13 box labels": plans the boxes and makes one label per box, then opens the print page. */
export async function planBatchBoxesAction(_: BoxLabelsState, fd: FormData): Promise<BoxLabelsState> {
  try {
    const ctx = await requireContext();
    const r = await planBatchBoxes(ctx, { batchId: uuid.parse(str(fd, "batchId")), pieces: str(fd, "pieces") ?? "", idempotencyKey: opt(fd, "idempotencyKey") ?? "" });
    refreshCurrentPage();
    return { ok: true, href: r.printHref, boxes: r.boxes, message: `${r.boxes} box ${r.boxes === 1 ? "label is" : "labels are"} ready for ${r.pieces} pieces.${r.replacedPlan ? " The old box labels are cancelled: destroy any you printed." : ""}` };
  } catch (e) {
    return toActionState(e);
  }
}

/** ADR-104 §2 print page: "Yes, they printed" for every box label of the batch. */
export async function markBatchBoxJobsPrintedAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const ids = (str(fd, "jobIds") ?? "").split(",").filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 200);
    for (const id of ids) await markLabelJobPrinted(ctx, id);
    return { ok: true, message: "Recorded as printed. Stick one label on each box." };
  } catch (e) {
    return toActionState(e);
  }
}

/** ADR-106 §4: "Put the left-over wrappers back on the shelf" (one tap after Finish). */
export async function returnWrappersAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const r = await returnLeftOverWrappers(ctx, { batchId: uuid.parse(str(fd, "batchId")) });
    refreshCurrentPage();
    return { ok: true, message: r.moved.length ? `Back on the shelf: ${r.moved.map((m) => `${Number(m.qty)} ${m.materialName} to ${m.toCode}`).join(", ")}.` : "Nothing to carry back: they are already on the shelf." };
  } catch (e) {
    return toActionState(e);
  }
}

/** ADR-104 §1b "Use the approved alternative" (the recipe lists it for this line). */
export async function takeAlternativeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const r = await useApprovedAlternative(ctx, { batchId: uuid.parse(str(fd, "batchId")), batchMaterialId: uuid.parse(str(fd, "batchMaterialId")), alternativeId: uuid.parse(str(fd, "alternativeId")), idempotencyKey: opt(fd, "idempotencyKey") });
    refreshCurrentPage();
    return { ok: true, message: `Use ${r.materialName} instead of ${r.replaced} for this batch.${r.shortage ? ` ${r.shortage}` : ""}` };
  } catch (e) {
    return toActionState(e);
  }
}

/** ADR-104 §1b "Ask to use something else": a request QA decides. */
export async function askOtherMaterialAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const r = await requestMaterialSubstitution(ctx, {
      batchId: uuid.parse(str(fd, "batchId")),
      batchMaterialId: uuid.parse(str(fd, "batchMaterialId")),
      substituteMaterialId: str(fd, "substituteMaterialId") ?? "",
      qty: opt(fd, "qty"),
      reason: str(fd, "reason") ?? "",
      idempotencyKey: opt(fd, "idempotencyKey"),
    });
    refreshCurrentPage();
    const next = await floorCheckNext(ctx, "material_substitution", str(fd, "batchId") ?? "", ctx.userId).catch(() => null);
    return { ok: true, message: `Asked QA to use ${r.substituteName} instead of ${r.materialName}. Weigh the other ingredients meanwhile.`, next };
  } catch (e) {
    return toActionState(e);
  }
}

export async function withdrawAskAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    await withdrawMaterialSubstitution(ctx, { requestId: uuid.parse(str(fd, "requestId")), reason: opt(fd, "reason") });
    refreshCurrentPage();
    return { ok: true, message: "Request taken back." };
  } catch (e) {
    return toActionState(e);
  }
}

/** ADR-104 §5 "Stop for today": where we stopped and a short note. */
export async function stopForTodayAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const r = await stopForToday(ctx, { batchId: uuid.parse(str(fd, "batchId")), stepNo: stepNoOf(fd), whereStopped: opt(fd, "whereStopped"), note: opt(fd, "note"), idempotencyKey: opt(fd, "idempotencyKey") });
    refreshCurrentPage();
    return { ok: true, message: `Stopped for today: ${r.whereStopped}. Tomorrow the task says where to continue.` };
  } catch (e) {
    return toActionState(e);
  }
}
