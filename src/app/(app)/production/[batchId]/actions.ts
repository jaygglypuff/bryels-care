"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type AuthContext, requireContext } from "@/lib/auth/context";
import { coSign } from "@/lib/auth/co-sign";
import { type ActionState, DomainError, toActionState } from "@/lib/errors";
import type { Permission } from "@/lib/permissions";
import {
  approveStepException,
  approveYield,
  checkDispense,
  checkPermission,
  checkStep,
  completeStep,
  countPackaging,
  decideScrapRework,
  issuePackaging,
  postBatchToQuarantine,
  recordDispense,
  recordReading,
  recordScrapRework,
  recordYield,
  returnStep,
  selectEquipment,
  startStep,
  submitChecklist,
  voidDispense,
  batchSiteId,
} from "@/modules/production";
import { registerAppHooks } from "@/modules/wiring";

// Execution ↔ QA hooks (idempotent; also registered at server start in src/instrumentation.ts).
registerAppHooks();

/**
 * Batch workspace server actions (W2B, US-3-09..13). Thin adapters: parse the form, build the
 * co-signer context when a second person signs on this device (their own password, coSign), call the
 * service, revalidate. All rules live in src/modules/production.
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
const num = (fd: FormData, k: string) => z.coerce.number().int().min(1).max(999).parse(str(fd, k));

/** The second person who signed on this device, or null when nobody was chosen. */
async function signer(ctx: AuthContext, fd: FormData, prefix: "checker" | "approver", permission: Permission, batchId: string): Promise<AuthContext | null> {
  const id = opt(fd, `${prefix}Id`);
  if (!id) return null;
  const siteId = await batchSiteId(ctx, batchId);
  return coSign(ctx, { userId: id, password: str(fd, `${prefix}Password`) ?? "", role: prefix === "checker" ? "checker" : "exception_approver", permission, siteId });
}

function done(batchId: string, message: string): ActionState {
  revalidatePath(`/production/${batchId}`);
  revalidatePath("/production");
  return { ok: true, message };
}

export async function checklistAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const batchId = uuid.parse(str(fd, "batchId"));
    const stepNo = num(fd, "stepNo");
    const itemIds = (str(fd, "itemIds") ?? "").split(",").filter(Boolean);
    const answers = itemIds.map((itemId) => {
      const a = str(fd, `answer-${itemId}`);
      if (a !== "yes" && a !== "no" && a !== "na") throw new DomainError("validation", "Answer every item.", { fieldErrors: { [`answer-${itemId}`]: "Choose yes, no or n/a." } });
      return { itemId, answer: a as "yes" | "no" | "na", note: opt(fd, `note-${itemId}`) };
    });
    const checker = await signer(ctx, fd, "checker", "production.line_clearance.approve", batchId);
    const r = await submitChecklist(ctx, { batchId, stepNo, answers, notes: opt(fd, "notes"), idempotencyKey: opt(fd, "idempotencyKey") }, { checker });
    if (r.blocked) {
      revalidatePath(`/production/${batchId}`);
      return { ok: false, message: `Answers saved. Step ${r.stepNo} stays blocked: ${r.blockers.join(" ")}` };
    }
    return done(batchId, r.status === "completed" ? `Step ${r.stepNo} (${r.name}) signed by conductor and checker.` : `Step ${r.stepNo} saved; waiting for the checker's signature.`);
  } catch (e) {
    return toActionState(e);
  }
}

export async function dispenseAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const batchId = uuid.parse(str(fd, "batchId"));
    const checker = await signer(ctx, fd, "checker", "production.dispense_record.approve", batchId);
    const approver = await signer(ctx, fd, "approver", "production.over_tolerance_dispense.approve", batchId);
    const r = await recordDispense(
      ctx,
      {
        batchId,
        batchMaterialId: uuid.parse(str(fd, "batchMaterialId")),
        lotRef: z.string().trim().min(1, "Scan the lot label on the container.").max(200).parse(str(fd, "lotRef") ?? ""),
        locationRef: opt(fd, "locationRef"),
        qty: opt(fd, "qty"),
        uom: opt(fd, "uom") ?? undefined,
        tare: opt(fd, "tare"),
        gross: opt(fd, "gross"),
        equipmentRef: opt(fd, "equipmentRef"),
        partial: str(fd, "partial") === "on",
        supersedesId: opt(fd, "supersedesId"),
        correctionReason: opt(fd, "correctionReason"),
        exceptionReason: opt(fd, "exceptionReason"),
        idempotencyKey: opt(fd, "idempotencyKey"),
      },
      { checker, exceptionApprover: approver },
    );
    const what = r.status === "partial" ? `${r.materialName}: part weighed (line total ${r.lineTotalG} g). Weigh the next lot.` : r.status === "exception" ? `${r.materialName} recorded under an approved exception.` : `${r.materialName} weighed.`;
    return done(batchId, `${what}${r.checked ? " Checked." : " Waiting for the checker."}`);
  } catch (e) {
    return toActionState(e);
  }
}

export async function checkDispenseAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const batchId = uuid.parse(str(fd, "batchId"));
    const r = await checkDispense(ctx, { dispenseRecordId: uuid.parse(str(fd, "dispenseRecordId")), idempotencyKey: opt(fd, "idempotencyKey") });
    return done(batchId, `${r.materialName} weighing checked.`);
  } catch (e) {
    return toActionState(e);
  }
}

export async function voidDispenseAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const batchId = uuid.parse(str(fd, "batchId"));
    await voidDispense(ctx, { dispenseRecordId: uuid.parse(str(fd, "dispenseRecordId")), reason: str(fd, "reason") ?? "" });
    return done(batchId, "Weighing voided. Weigh again; the new row will replace it.");
  } catch (e) {
    return toActionState(e);
  }
}

export async function readingAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const batchId = uuid.parse(str(fd, "batchId"));
    const r = await recordReading(ctx, {
      batchId,
      stepNo: num(fd, "stepNo"),
      parameterId: uuid.parse(str(fd, "parameterId")),
      value: str(fd, "value") ?? "",
      correctionReason: opt(fd, "correctionReason"),
      idempotencyKey: opt(fd, "idempotencyKey"),
    });
    revalidatePath(`/production/${batchId}`);
    return r.isWithinLimits ? { ok: true, message: `${r.parameter} recorded: ${r.value}.` } : { ok: false, message: `${r.parameter} ${r.value} is outside ${r.limits}. Saved; the step is blocked until QA approves an exception with a deviation.` };
  } catch (e) {
    return toActionState(e);
  }
}

export async function equipmentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const batchId = uuid.parse(str(fd, "batchId"));
    const r = await selectEquipment(ctx, { batchId, stepNo: num(fd, "stepNo"), equipmentRef: z.string().trim().min(1, "Scan or choose the equipment.").parse(str(fd, "equipmentRef") ?? "") });
    return done(batchId, `${r.equipmentCode} recorded on the step${r.warnings.length ? ` (warnings recorded: ${r.warnings.join(", ")})` : ""}.`);
  } catch (e) {
    return toActionState(e);
  }
}

export async function startStepAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const batchId = uuid.parse(str(fd, "batchId"));
    const r = await startStep(ctx, { batchId, stepNo: num(fd, "stepNo") });
    return done(batchId, `Step ${r.stepNo} started.`);
  } catch (e) {
    return toActionState(e);
  }
}

export async function completeStepAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const batchId = uuid.parse(str(fd, "batchId"));
    const stepNo = num(fd, "stepNo");
    const kind = str(fd, "stepKind") ?? "process";
    const checker = await signer(ctx, fd, "checker", checkPermission(kind), batchId);
    const r = await completeStep(ctx, { batchId, stepNo, notes: opt(fd, "notes"), idempotencyKey: opt(fd, "idempotencyKey") }, { checker });
    return done(batchId, r.status === "completed" ? `Step ${r.stepNo} (${r.name}) completed.` : `Step ${r.stepNo} done; waiting for the checker's signature.`);
  } catch (e) {
    return toActionState(e);
  }
}

export async function checkStepAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const batchId = uuid.parse(str(fd, "batchId"));
    const r = await checkStep(ctx, { batchId, stepNo: num(fd, "stepNo"), idempotencyKey: opt(fd, "idempotencyKey") });
    return done(batchId, `Step ${r.stepNo} (${r.name}) checked.`);
  } catch (e) {
    return toActionState(e);
  }
}

export async function returnStepAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const batchId = uuid.parse(str(fd, "batchId"));
    const r = await returnStep(ctx, { batchId, stepNo: num(fd, "stepNo"), reason: str(fd, "reason") ?? "" });
    return done(batchId, `Step ${r.stepNo} returned to the operator.`);
  } catch (e) {
    return toActionState(e);
  }
}

export async function stepExceptionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const batchId = uuid.parse(str(fd, "batchId"));
    const approver = await signer(ctx, fd, "approver", "production.over_tolerance_dispense.approve", batchId);
    if (!approver) throw new DomainError("validation", "The approver (QA or site manager) must sign on this device.", { field: "approverId" });
    await approveStepException(ctx, { batchId, stepNo: num(fd, "stepNo"), reason: str(fd, "reason") ?? "" }, { approver });
    return done(batchId, "Exception approved and deviation opened. You can complete the step.");
  } catch (e) {
    return toActionState(e);
  }
}

export async function issuePackagingAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const batchId = uuid.parse(str(fd, "batchId"));
    const r = await issuePackaging(ctx, {
      batchId,
      stepNo: num(fd, "stepNo"),
      lotRef: z.string().trim().min(1, "Scan the packaging lot.").parse(str(fd, "lotRef") ?? ""),
      locationRef: opt(fd, "locationRef"),
      qty: str(fd, "qty") ?? "",
      idempotencyKey: opt(fd, "idempotencyKey"),
    });
    return done(batchId, `${r.materialName} lot ${r.lotNumber} issued.`);
  } catch (e) {
    return toActionState(e);
  }
}

export async function countPackagingAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const batchId = uuid.parse(str(fd, "batchId"));
    const r = await countPackaging(ctx, {
      reconciliationId: uuid.parse(str(fd, "reconciliationId")),
      used: str(fd, "used") ?? "",
      damaged: str(fd, "damaged"),
      returned: str(fd, "returned"),
      correctionReason: opt(fd, "correctionReason"),
      idempotencyKey: opt(fd, "idempotencyKey"),
    });
    revalidatePath(`/production/${batchId}`);
    return r.within ? { ok: true, message: `${r.materialName} reconciles (variance ${r.variance}).` } : { ok: false, message: `${r.materialName} does not reconcile: variance ${r.variance}. Recount, or ask QA for an exception.` };
  } catch (e) {
    return toActionState(e);
  }
}

export async function yieldAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const batchId = uuid.parse(str(fd, "batchId"));
    const r = await recordYield(ctx, { batchId, actualUnits: str(fd, "actualUnits") ?? "", notes: opt(fd, "notes"), correctionReason: opt(fd, "correctionReason"), idempotencyKey: opt(fd, "idempotencyKey") });
    revalidatePath(`/production/${batchId}`);
    return r.within ? { ok: true, message: `Yield ${r.yieldPct} % recorded (range ${r.range.min}–${r.range.max} %).` } : { ok: false, message: `Yield ${r.yieldPct} % is outside ${r.range.min}–${r.range.max} %. Saved; a site manager or QA must approve it with a deviation before posting.` };
  } catch (e) {
    return toActionState(e);
  }
}

export async function approveYieldAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const batchId = uuid.parse(str(fd, "batchId"));
    await approveYield(ctx, { yieldRecordId: uuid.parse(str(fd, "yieldRecordId")), reason: str(fd, "reason") ?? "" });
    return done(batchId, "Yield approved; deviation opened.");
  } catch (e) {
    return toActionState(e);
  }
}

export async function scrapAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const batchId = uuid.parse(str(fd, "batchId"));
    const kind = z.enum(["scrap", "rework"]).parse(str(fd, "kind"));
    const r = await recordScrapRework(ctx, { batchId, kind, reasonCode: str(fd, "reasonCode") ?? "", qty: str(fd, "qty") ?? "", note: opt(fd, "note"), idempotencyKey: opt(fd, "idempotencyKey") });
    return done(batchId, r.requiresApproval ? "Recorded; above the threshold, so a site manager or QA must approve it." : "Recorded.");
  } catch (e) {
    return toActionState(e);
  }
}

export async function decideScrapAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const batchId = uuid.parse(str(fd, "batchId"));
    const decision = z.enum(["approve", "reject"]).parse(str(fd, "decision"));
    await decideScrapRework(ctx, { scrapReworkRecordId: uuid.parse(str(fd, "scrapReworkRecordId")), decision, note: str(fd, "note") ?? "" });
    return done(batchId, decision === "approve" ? "Approved." : "Rejected.");
  } catch (e) {
    return toActionState(e);
  }
}

export async function postToQuarantineAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const batchId = uuid.parse(str(fd, "batchId"));
    const checker = await signer(ctx, fd, "checker", "production.process_step_record.approve", batchId);
    const r = await postBatchToQuarantine(ctx, { batchId, locationRef: z.string().trim().min(1, "Scan the quarantine location.").parse(str(fd, "locationRef") ?? ""), idempotencyKey: opt(fd, "idempotencyKey") }, { checker });
    return done(batchId, `Posted. Output lot ${r.lotNumber} is in quarantine at ${r.location} awaiting QA (expires ${r.expiresOn}).`);
  } catch (e) {
    return toActionState(e);
  }
}
