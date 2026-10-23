"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError, toActionState, type ActionState } from "@/lib/errors";
import {
  cancelLabelJob,
  createLabelJob,
  createLabelJobsForLots,
  markLabelJobFailed,
  markLabelJobPrinted,
  reprintLabelJob,
  retryLabelJob,
  voidLabelJob,
} from "@/modules/documents";
import { getReceipt } from "@/modules/inventory";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** Maps DomainError details.field onto the form field so the error shows inline. */
function withField(e: unknown): ActionState {
  const s = toActionState(e);
  if (e instanceof DomainError && typeof e.details?.field === "string" && s) return { ...s, fieldErrors: { [e.details.field]: e.message } };
  return s;
}

export async function createLabelJobAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  let target: string;
  try {
    const ctx = await requireContext();
    const r = await createLabelJob(ctx, {
      labelTemplateId: str(f, "labelTemplateId"),
      entityType: str(f, "entityType") as "inventory_lot" | "location",
      entityId: str(f, "entityId"),
      copies: str(f, "copies"),
      printStationId: str(f, "printStationId") || null,
      idempotencyKey: str(f, "idempotencyKey"),
    });
    target = str(f, "then") === "print" ? `/print/labels/${r.jobId}` : `/labels/jobs/${r.jobId}?sent=1`;
  } catch (e) {
    return withField(e);
  }
  revalidatePath("/labels");
  redirect(target);
}

/** One label job per lot of a goods receipt; each lot keeps its own key so a retry never doubles labels. */
export async function createReceiptLabelJobsAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  let msg: string;
  try {
    const ctx = await requireContext();
    const gr = await getReceipt(ctx, str(f, "grId"));
    const out = await createLabelJobsForLots(ctx, gr.lines.map((l) => ({ lotId: l.lotId })), str(f, "labelTemplateId"), Number(str(f, "copies") || "1"), `gr:${gr.id}:${str(f, "labelTemplateId")}`, str(f, "printStationId") || null);
    const failed = out.filter((o) => o.error);
    if (failed.length === out.length) return { ok: false, message: failed[0]?.error ?? "No labels were created." };
    msg = `${out.length - failed.length} label job(s) sent to the print station.${failed.length ? ` ${failed.length} skipped: ${failed[0].error}` : ""}`;
  } catch (e) {
    return withField(e);
  }
  revalidatePath("/labels");
  return { ok: true, message: msg };
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
    target = `/labels/jobs/${r.jobId}?sent=1`;
  } catch (e) {
    return withField(e);
  }
  revalidatePath("/labels");
  redirect(target);
}
