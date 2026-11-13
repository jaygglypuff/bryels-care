"use server";
import { z } from "zod";
import { requireContext } from "@/lib/auth/context";
import { type ActionState, DomainError, toActionState } from "@/lib/errors";
import { refreshCurrentPage } from "@/lib/in-place";
import { checkDispenses, checkStep, confirmFinishCheck, returnDispense, returnFinishCheck, returnStep } from "@/modules/production";
import { registerAppHooks } from "@/modules/wiring";

registerAppHooks();

/**
 * ADR-130 the checker's list "Waiting for you to check" (/production/checks). Every action runs in the
 * checker's OWN signed-in session (no name pick, no co-signature), then refreshes the list: the checker
 * stays on their list and never lands on the operator's next screen (round 5 B18). Rules live in the services.
 */
const uuid = z.string().uuid("Choose a valid option.");
const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};

/** "Not right" reasons are tapped; "Other" asks for a few words. The services keep their 5-character rule. */
function reasonOf(fd: FormData) {
  const code = str(fd, "reasonCode");
  const note = str(fd, "reasonNote");
  if (!code) throw new DomainError("validation", "Tap what is not right.", { fieldErrors: { reasonCode: "Tap one." } });
  if (code === "Other" && note.length < 3) throw new DomainError("validation", "Write a few words about what is not right.", { fieldErrors: { reasonNote: "A few words." } });
  return code === "Other" ? note : note ? `${code}: ${note}` : code;
}

/** "Looks right" on a weighings card: every listed weighing of the batch, in one go. */
export async function confirmWeighingsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const ids = str(fd, "dispenseRecordIds").split(",").filter(Boolean).map((x) => uuid.parse(x));
    const r = await checkDispenses(ctx, { batchId: uuid.parse(str(fd, "batchId")), dispenseRecordIds: ids, idempotencyKey: str(fd, "idempotencyKey") || null });
    refreshCurrentPage();
    return { ok: true, message: r.checked === 1 ? `Checked: ${r.materials[0]} of batch ${r.batchNumber}. Thank you.` : `Checked: ${r.checked} weighings of batch ${r.batchNumber}. Thank you.` };
  } catch (e) {
    return toActionState(e);
  }
}

/** "Not right" on one weighing: it is undone with the reason and weighed again by the operator. */
export async function weighingNotRightAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    await returnDispense(ctx, { dispenseRecordId: uuid.parse(str(fd, "dispenseRecordId")), reason: reasonOf(fd) });
    refreshCurrentPage();
    return { ok: true, message: "Sent back. The operator weighs it again. You will see it here again." };
  } catch (e) {
    return toActionState(e);
  }
}

/** "Looks right" on a step card. */
export async function confirmStepAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const stepNo = z.coerce.number().int().min(1).max(999).parse(str(fd, "stepNo"));
    const r = await checkStep(ctx, { batchId: uuid.parse(str(fd, "batchId")), stepNo, idempotencyKey: str(fd, "idempotencyKey") || null });
    refreshCurrentPage();
    return { ok: true, message: `Checked: ${r.name}. Thank you.` };
  } catch (e) {
    return toActionState(e);
  }
}

/** "Not right" on a step card: back to the person who did it, with the reason. */
export async function stepNotRightAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const stepNo = z.coerce.number().int().min(1).max(999).parse(str(fd, "stepNo"));
    await returnStep(ctx, { batchId: uuid.parse(str(fd, "batchId")), stepNo, reason: reasonOf(fd) });
    refreshCurrentPage();
    return { ok: true, message: "Sent back with your reason. You will see it here again when it is done." };
  } catch (e) {
    return toActionState(e);
  }
}

/** ADR-133 "Looks right" on a Finish card: the batch moves to the QA waiting area now (one transaction). */
export async function confirmFinishCheckAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const r = await confirmFinishCheck(ctx, { checkId: uuid.parse(str(fd, "checkId")), idempotencyKey: str(fd, "idempotencyKey") });
    refreshCurrentPage();
    return { ok: true, message: `Checked: batch ${r.batchNumber} is in the QA waiting area (${r.location}). Thank you.` };
  } catch (e) {
    return toActionState(e);
  }
}

/** ADR-133 "Not right" on a Finish card: back to the operator with the reason; nothing moves. */
export async function finishNotRightAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    await returnFinishCheck(ctx, { checkId: uuid.parse(str(fd, "checkId")), reason: reasonOf(fd) });
    refreshCurrentPage();
    return { ok: true, message: "Sent back with your reason. The operator counts again and sends it to you." };
  } catch (e) {
    return toActionState(e);
  }
}
