"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { toActionState, type ActionState } from "@/lib/errors";
import { refreshCurrentPage } from "@/lib/in-place";
import {
  addCapaAction,
  cancelCapa,
  closeCapa,
  completeCapaAction,
  openCapa,
  recordEffectivenessCheck,
  reopenOrCancelCapaAction,
  submitCapaForClosure,
  updateCapa,
  verifyCapaAction,
  type CapaSource,
} from "@/modules/quality";

/*
 * CAPA server actions (US-6-18). Thin adapters: parse the form, call the service, then redirect (open) or
 * re-render the current page in the response (ADR-043). Every rule is checked by the service.
 */

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const opt = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return v === null || String(v).trim() === "" ? null : String(v);
};

export async function openCapaAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const ctx = await requireContext();
    const r = await openCapa(ctx, {
      sourceKind: str(fd, "sourceKind") as CapaSource,
      deviationId: opt(fd, "deviationId"),
      complaintId: opt(fd, "complaintId"),
      sourceReference: opt(fd, "sourceReference"),
      siteId: opt(fd, "siteId"),
      title: str(fd, "title"),
      problemStatement: str(fd, "problemStatement"),
      ownerId: str(fd, "ownerId"),
      dueDate: opt(fd, "dueDate"),
      idempotencyKey: opt(fd, "idempotencyKey"),
    });
    id = r.capaId;
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/quality/capa");
  redirect(`/quality/capa/${id}?opened=1`);
}

async function inPlace(run: () => Promise<string>): Promise<ActionState> {
  try {
    const message = await run();
    refreshCurrentPage();
    return { ok: true, message };
  } catch (e) {
    return toActionState(e);
  }
}

export async function updateCapaAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    await updateCapa(ctx, {
      capaId: str(fd, "capaId"),
      title: opt(fd, "title") ?? undefined,
      problemStatement: opt(fd, "problemStatement") ?? undefined,
      rootCause: opt(fd, "rootCause"),
      correctiveAction: opt(fd, "correctiveAction"),
      preventiveAction: opt(fd, "preventiveAction"),
      effectivenessCriteria: opt(fd, "effectivenessCriteria"),
      dueDate: opt(fd, "dueDate"),
      ownerId: opt(fd, "ownerId"),
    });
    return "CAPA record saved.";
  });
}

export async function addCapaActionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    const r = await addCapaAction(ctx, { capaId: str(fd, "capaId"), actionKind: str(fd, "actionKind"), description: str(fd, "description"), ownerId: str(fd, "ownerId"), dueDate: str(fd, "dueDate"), verificationMethod: opt(fd, "verificationMethod"), idempotencyKey: opt(fd, "idempotencyKey") });
    return r.replayed ? `Action ${r.actionNo} was already added.` : `Action ${r.actionNo} added${r.started ? "; the CAPA is now in progress" : ""}. Its owner was notified.`;
  });
}

export async function completeCapaActionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    await completeCapaAction(ctx, { actionId: str(fd, "actionId"), note: str(fd, "note") });
    return "Action recorded as done. A second person verifies it.";
  });
}

export async function verifyCapaActionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    await verifyCapaAction(ctx, { actionId: str(fd, "actionId"), note: str(fd, "note") });
    return "Action verified.";
  });
}

export async function reopenCapaActionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    const to = str(fd, "to") === "cancelled" ? "cancelled" : "open";
    await reopenOrCancelCapaAction(ctx, { actionId: str(fd, "actionId"), to, reason: str(fd, "reason") });
    return to === "open" ? "Action sent back to its owner." : "Action cancelled.";
  });
}

export async function submitCapaAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    const r = await submitCapaForClosure(ctx, { capaId: str(fd, "capaId"), effectivenessDueOn: opt(fd, "effectivenessDueOn") });
    return `Submitted for closure. The effectiveness check is due on ${r.effectivenessDueOn}.`;
  });
}

export async function effectivenessAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    const r = await recordEffectivenessCheck(ctx, { capaId: str(fd, "capaId"), result: str(fd, "result"), evidence: str(fd, "evidence") });
    return r.status === "in_progress" ? "Recorded as not effective: the CAPA is back in progress for new actions." : "Effectiveness recorded. Another person can now close the CAPA.";
  });
}

export async function closeCapaAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    await closeCapa(ctx, { capaId: str(fd, "capaId"), note: opt(fd, "note") });
    return "CAPA closed.";
  });
}

export async function cancelCapaAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    await cancelCapa(ctx, { capaId: str(fd, "capaId"), reason: str(fd, "reason") });
    return "CAPA cancelled.";
  });
}
