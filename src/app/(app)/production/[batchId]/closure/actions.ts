"use server";
import { revalidatePath } from "next/cache";
import { requireContext } from "@/lib/auth/context";
import { DomainError, toActionState, type ActionState } from "@/lib/errors";
import { closeBatch, decideReopen, issuePaperPage, recordAmendment, requestReopen, reviewPaperRecord, voidPaperPage, withdrawReopen } from "@/modules/production";

/** Server actions of the batch closure page (US-3-19, US-3-20). Thin: the services check everything. */

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const path = (f: FormData) => `/production/${str(f, "batchId")}/closure`;

function fail(e: unknown): ActionState {
  const s = toActionState(e);
  if (e instanceof DomainError && Array.isArray(e.details?.blockers) && s) {
    const items = (e.details.blockers as { label?: string; detail?: string; message?: string }[]).map((b) => (b.label ? `${b.label}: ${b.detail}` : (b.message ?? "")));
    return { ...s, message: `Not closed. ${items.join(" · ")}` };
  }
  return s;
}

async function run(f: FormData, fn: () => Promise<unknown>, ok: string): Promise<ActionState> {
  try {
    await fn();
  } catch (e) {
    return fail(e);
  }
  revalidatePath(path(f));
  return { ok: true, message: ok };
}

export async function closeBatchAction(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const r = await closeBatch(ctx, { batchId: str(f, "batchId"), note: str(f, "note") || null, idempotencyKey: str(f, "idempotencyKey") });
    revalidatePath(path(f));
    return { ok: true, message: `Batch closed. Final BMR ${r.documentNumber} (${r.watermark}) is ready to print${r.reservationsReleased ? `; ${r.reservationsReleased} reservation(s) released` : ""}.` };
  } catch (e) {
    return fail(e);
  }
}

export async function requestReopenAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  return run(
    f,
    () =>
      requestReopen(ctx, {
        batchId: str(f, "batchId"),
        targetState: str(f, "targetState") as "released",
        reason: str(f, "reason"),
        amendmentScope: str(f, "amendmentScope"),
        idempotencyKey: str(f, "idempotencyKey"),
      }),
    "Reopen requested. QA has been asked to co-approve.",
  );
}

export async function decideReopenAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  const decision = str(f, "decision") === "rejected" ? "rejected" : "approved";
  return run(f, () => decideReopen(ctx, { requestId: str(f, "requestId"), decision, note: str(f, "note") || null }), decision === "approved" ? "Decision recorded." : "Reopen rejected; the batch stays closed.");
}

export async function withdrawReopenAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  return run(f, () => withdrawReopen(ctx, { requestId: str(f, "requestId"), reason: str(f, "reason") }), "Request withdrawn.");
}

export async function amendAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  return run(
    f,
    () =>
      recordAmendment(ctx, {
        batchId: str(f, "batchId"),
        section: str(f, "section") as "other",
        reference: str(f, "reference"),
        previousValue: str(f, "previousValue"),
        correctedValue: str(f, "correctedValue"),
        reason: str(f, "reason"),
        supersedesId: str(f, "supersedesId") || null,
        idempotencyKey: str(f, "idempotencyKey"),
      }),
    "Amendment recorded. It prints on the BMR with the previous value.",
  );
}

export async function issuePaperAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  return run(f, () => issuePaperPage(ctx, { batchId: str(f, "batchId"), stepNo: Number(str(f, "stepNo")), idempotencyKey: str(f, "idempotencyKey") }), "Paper page issued. Print it from the list below.");
}

export async function reviewPaperAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  const decision = str(f, "decision") === "return" ? "return" : "confirm";
  return run(f, () => reviewPaperRecord(ctx, { paperRecordId: str(f, "paperRecordId"), decision, note: str(f, "note") || null }), decision === "confirm" ? "Transcription confirmed." : "Page returned to the transcriber.");
}

export async function voidPaperAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  return run(f, () => voidPaperPage(ctx, { paperRecordId: str(f, "paperRecordId"), reason: str(f, "reason") }), "Paper page voided.");
}
