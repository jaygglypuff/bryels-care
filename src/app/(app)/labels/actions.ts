"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError, toActionState, type ActionState } from "@/lib/errors";
import {
  cancelLabelJob,
  createLabelJobsForLots,
  markLabelJobFailed,
  markLabelJobPrinted,
  reprintLabelJob,
  retryLabelJob,
  voidLabelJob,
} from "@/modules/documents";
import { getReceipt } from "@/modules/inventory";
import { previewHref, receiptLabelsTarget } from "./receipt-print";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** Maps DomainError details.field onto the form field so the error shows inline. */
function withField(e: unknown): ActionState {
  const s = toActionState(e);
  if (e instanceof DomainError && typeof e.details?.field === "string" && s) return { ...s, fieldErrors: { [e.details.field]: e.message } };
  return s;
}

/**
 * One label job per lot of a goods receipt; each lot keeps its own key so a retry never doubles labels.
 * Then the print preview of all of them opens, with one clear sentence about what was sent and what was
 * skipped (usability test 2026-10-30).
 */
export async function createReceiptLabelJobsAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  let target: string;
  try {
    const ctx = await requireContext();
    const gr = await getReceipt(ctx, str(f, "grId"));
    // Copies per lot (default on the form: one per sack/container); the service validates 1–99.
    const lots = gr.lines.map((l) => ({ lotId: l.lotId, copies: str(f, `copies-${l.lotId}`) ? Number(str(f, `copies-${l.lotId}`)) : null }));
    const out = await createLabelJobsForLots(ctx, lots, str(f, "labelTemplateId"), Number(str(f, "copies") || "1"), `gr:${gr.id}:${str(f, "labelTemplateId")}`, null);
    const made = out.filter((o) => o.jobId);
    const other = out.filter((o) => !o.jobId && o.code !== "conflict");
    if (made.length === 0 && other.length > 0) return { ok: false, message: other[0]?.error ?? "No labels were made." };
    target = previewHref(gr.id, out);
  } catch (e) {
    return withField(e);
  }
  revalidatePath("/labels");
  redirect(target);
}

/** Receipt page "Print labels": straight to the print preview when the label size and printer are clear. */
export async function printReceiptLabelsAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  let target: string;
  try {
    const ctx = await requireContext();
    target = await receiptLabelsTarget(ctx, str(f, "receiptId"));
  } catch (e) {
    return withField(e);
  }
  revalidatePath("/labels");
  redirect(target);
}

async function jobAction(fn: () => Promise<unknown>, okMessage: string): Promise<ActionState> {
  try {
    await fn();
  } catch (e) {
    return withField(e);
  }
  revalidatePath("/labels");
  return { ok: true, message: okMessage };
}

export async function markPrintedAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  return jobAction(() => markLabelJobPrinted(ctx, str(f, "jobId")), "Marked as printed. Stick the label on the container now.");
}

export async function markFailedAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  return jobAction(() => markLabelJobFailed(ctx, str(f, "jobId"), str(f, "message")), "Marked as failed. Fix the printer, then retry the same job.");
}

export async function retryAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  return jobAction(() => retryLabelJob(ctx, str(f, "jobId")), "The job is ready to print again.");
}

export async function cancelAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  return jobAction(() => cancelLabelJob(ctx, str(f, "jobId")), "Job cancelled.");
}

export async function voidAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  return jobAction(() => voidLabelJob(ctx, str(f, "jobId"), str(f, "reason")), "Label voided. It is listed as superseded on the scan card; destroy the physical label.");
}

export async function reprintAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  let target: string;
  try {
    const ctx = await requireContext();
    const r = await reprintLabelJob(ctx, str(f, "jobId"), {
      reasonCode: str(f, "reasonCode"),
      note: str(f, "note") || null,
      copies: str(f, "copies") || "1",
      idempotencyKey: str(f, "idempotencyKey"),
    });
    target = `/print/labels/${r.jobId}?auto=1`;
  } catch (e) {
    return withField(e);
  }
  revalidatePath("/labels");
  redirect(target);
}

/** Receipt print preview: records every ready job of the receipt as printed (each job is checked by the service). */
export async function markReceiptJobsPrintedAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const ids = str(f, "jobIds").split(",").filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 50);
    for (const id of ids) await markLabelJobPrinted(ctx, id);
  } catch (e) {
    return withField(e);
  }
  revalidatePath("/labels");
  return { ok: true, message: "Recorded as printed. Stick one label on every sack now." };
}
