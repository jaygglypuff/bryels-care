"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { toActionState, type ActionState } from "@/lib/errors";
import { refreshCurrentPage } from "@/lib/in-place";
import {
  classifyComplaint,
  closeComplaint,
  logComplaint,
  raiseComplaintDeviation,
  reopenComplaint,
  resolveComplaint,
  startComplaintInvestigation,
  updateComplaint,
} from "@/modules/quality";

/*
 * Complaint server actions (US-4-15). Thin adapters: parse the form, call the service, then either
 * redirect (log, raise deviation) or re-render the current page in the response (ADR-043).
 */

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const opt = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return v === null || String(v).trim() === "" ? null : String(v);
};

export async function logComplaintAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const ctx = await requireContext();
    const received = opt(fd, "receivedAt");
    const r = await logComplaint(ctx, {
      customerId: str(fd, "customerId"),
      code: opt(fd, "code"),
      productId: opt(fd, "productId"),
      category: str(fd, "category"),
      channel: opt(fd, "channel"),
      description: str(fd, "description"),
      customerReference: opt(fd, "customerReference"),
      qtyAffected: opt(fd, "qtyAffected"),
      sampleReturned: fd.get("sampleReturned") === "yes",
      internalNotes: opt(fd, "internalNotes"),
      // The form sends Manila local time (datetime-local); the business timezone is Asia/Manila (UTC+8).
      receivedAt: received ? new Date(`${received}:00+08:00`) : null,
      idempotencyKey: opt(fd, "idempotencyKey"),
    });
    id = r.complaintId;
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/quality/complaints");
  redirect(`/quality/complaints/${id}?logged=1`);
}

export async function startInvestigationAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const r = await startComplaintInvestigation(ctx, { complaintId: str(fd, "complaintId"), investigation: str(fd, "investigation"), severity: opt(fd, "severity") });
    refreshCurrentPage();
    return { ok: true, message: r.recallReviewFlagged ? "Saved: QA is looking into it. This is serious enough to check if a recall is needed; QA and the owner were told." : "Saved: QA is looking into it." };
  } catch (e) {
    return toActionState(e);
  }
}

export async function classifyAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const r = await classifyComplaint(ctx, { complaintId: str(fd, "complaintId"), severity: str(fd, "severity") });
    refreshCurrentPage();
    return { ok: true, message: r.recallReviewFlagged ? "Saved. This is serious enough to check if a recall is needed; QA and the owner were told." : "Saved." };
  } catch (e) {
    return toActionState(e);
  }
}

export async function updateComplaintAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    await updateComplaint(ctx, {
      complaintId: str(fd, "complaintId"),
      investigation: fd.has("investigation") ? str(fd, "investigation") : undefined,
      rootCause: fd.has("rootCause") ? str(fd, "rootCause") : undefined,
      internalNotes: fd.has("internalNotes") ? str(fd, "internalNotes") : undefined,
      customerResponse: fd.has("customerResponse") ? str(fd, "customerResponse") : undefined,
    });
    refreshCurrentPage();
    return { ok: true, message: "Saved." };
  } catch (e) {
    return toActionState(e);
  }
}

export async function resolveComplaintAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    await resolveComplaint(ctx, { complaintId: str(fd, "complaintId"), resolution: str(fd, "resolution"), rootCause: opt(fd, "rootCause"), customerResponse: opt(fd, "customerResponse") });
    refreshCurrentPage();
    return { ok: true, message: "Answer saved; QA closes the complaint." };
  } catch (e) {
    return toActionState(e);
  }
}

export async function reopenComplaintAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    await reopenComplaint(ctx, { complaintId: str(fd, "complaintId"), reason: str(fd, "reason") });
    refreshCurrentPage();
    return { ok: true, message: "QA is looking into it again." };
  } catch (e) {
    return toActionState(e);
  }
}

export async function closeComplaintAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    await closeComplaint(ctx, { complaintId: str(fd, "complaintId"), note: opt(fd, "note") });
    refreshCurrentPage();
    return { ok: true, message: "Complaint closed." };
  } catch (e) {
    return toActionState(e);
  }
}

export async function raiseDeviationAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const ctx = await requireContext();
    const r = await raiseComplaintDeviation(ctx, { complaintId: str(fd, "complaintId"), description: str(fd, "description") });
    id = r.deviationId;
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/quality/deviations");
  redirect(`/quality/deviations/${id}?opened=1`);
}
