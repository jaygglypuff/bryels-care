"use server";
import { revalidatePath } from "next/cache";
import { requireContext } from "@/lib/auth/context";
import { DomainError, toActionState, type ActionState } from "@/lib/errors";
import { createLabelJob, reprintLabelJob } from "@/modules/documents";

/**
 * Server actions behind `<PrintLabelsButton>` (ADR-099). They only call the documents services, which check
 * permission, site, template approval, idempotency and the "same label twice = reprint with reason" rule.
 * On success the button opens the print page of the job.
 */
export type PrintLabelsState = (NonNullable<ActionState> & { jobId?: string; existingJobId?: string }) | null;

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

function fail(e: unknown): PrintLabelsState {
  const s = toActionState(e);
  const existing = e instanceof DomainError && typeof e.details?.existingJobId === "string" ? e.details.existingJobId : undefined;
  return { ok: false, message: s?.message, fieldErrors: s?.fieldErrors, needs: s?.needs, existingJobId: existing };
}

export async function printLabelsAction(_prev: PrintLabelsState, f: FormData): Promise<PrintLabelsState> {
  try {
    const ctx = await requireContext();
    const r = await createLabelJob(ctx, {
      labelTemplateId: str(f, "labelTemplateId"),
      entityType: str(f, "entityType") as "inventory_lot" | "location" | "container" | "batch",
      entityId: str(f, "entityId"),
      copies: str(f, "copies"),
      idempotencyKey: str(f, "idempotencyKey"),
    });
    revalidatePath("/labels");
    return { ok: true, jobId: r.jobId };
  } catch (e) {
    return fail(e);
  }
}

export async function reprintLabelsAction(_prev: PrintLabelsState, f: FormData): Promise<PrintLabelsState> {
  try {
    const ctx = await requireContext();
    const r = await reprintLabelJob(ctx, str(f, "jobId"), { reasonCode: str(f, "reasonCode"), note: str(f, "note") || null, copies: str(f, "copies") || "1", idempotencyKey: str(f, "idempotencyKey") });
    revalidatePath("/labels");
    return { ok: true, jobId: r.jobId };
  } catch (e) {
    return fail(e);
  }
}
