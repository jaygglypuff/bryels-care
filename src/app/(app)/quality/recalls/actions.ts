"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { toActionState, type ActionState } from "@/lib/errors";
import { refreshCurrentPage } from "@/lib/in-place";
import {
  cancelRecallCase,
  closeRecallCase,
  decideRecallCase,
  markRecallCaseLots,
  openRecallCase,
  recordRecallAccounted,
  recordRecallNotification,
  refreshRecallScope,
  startRecallDrill,
  startRecallRecovery,
  submitRecallCase,
  updateRecallCase,
} from "@/modules/quality";

/* Recall case server actions (US-6-18): thin adapters; the service checks permission, state, SoD and re-authentication. */

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const opt = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return v === null || String(v).trim() === "" ? null : String(v);
};

async function inPlace(run: () => Promise<string>): Promise<ActionState> {
  try {
    const message = await run();
    refreshCurrentPage();
    return { ok: true, message };
  } catch (e) {
    return toActionState(e);
  }
}

export async function openRecallAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const ctx = await requireContext();
    const r = await openRecallCase(ctx, {
      code: opt(fd, "code"),
      supplierLot: opt(fd, "supplierLot"),
      complaintId: opt(fd, "complaintId"),
      mode: str(fd, "mode") === "reverse" ? "reverse" : "forward",
      recallKind: str(fd, "recallKind"),
      title: str(fd, "title"),
      description: str(fd, "description"),
      classification: opt(fd, "classification"),
      regulatoryNotes: opt(fd, "regulatoryNotes"),
      idempotencyKey: opt(fd, "idempotencyKey"),
    });
    id = r.recallCaseId;
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/quality/recalls");
  redirect(`/quality/recalls/${id}?opened=1`);
}

export async function refreshScopeAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    const r = await refreshRecallScope(ctx, { recallCaseId: str(fd, "recallCaseId") });
    return `Scope refreshed: ${r.lots} lot(s), ${r.boxes} box(es), ${r.customers} customer(s).`;
  });
}

export async function updateRecallAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    await updateRecallCase(ctx, { recallCaseId: str(fd, "recallCaseId"), classification: opt(fd, "classification"), regulatoryNotes: opt(fd, "regulatoryNotes") });
    return "Saved.";
  });
}

export async function submitRecallAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    await submitRecallCase(ctx, { recallCaseId: str(fd, "recallCaseId") });
    return "Submitted for approval; QA and then the owner decide.";
  });
}

export async function decideRecallAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    const r = await decideRecallCase(ctx, { recallCaseId: str(fd, "recallCaseId"), decision: str(fd, "decision") as "approved" | "rejected" | "returned", note: opt(fd, "note"), password: opt(fd, "password") });
    return r.status === "approved" ? "Recall approved. QA marks the lots recalled next." : r.status === "draft" ? "Sent back to draft." : "Your approval is recorded; the next approver was notified.";
  });
}

export async function markRecalledAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    const r = await markRecallCaseLots(ctx, { recallCaseId: str(fd, "recallCaseId"), password: opt(fd, "password") });
    const failed = r.outcomes.filter((o) => o.outcome === "failed" || o.outcome === "other_site");
    return `${r.recalled} lot(s) marked recalled; shipments of them are now blocked.${failed.length ? ` Not marked: ${failed.map((o) => `${o.lotNumber} (${o.message})`).join("; ")}.` : ""}`;
  });
}

export async function startDrillAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    await startRecallDrill(ctx, { recallCaseId: str(fd, "recallCaseId") });
    return "Drill started. Notify the customers on the list as a drill; no stock is marked.";
  });
}

export async function notifyCustomerAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    const event = str(fd, "event") === "acknowledged" ? "acknowledged" : "notified";
    await recordRecallNotification(ctx, { recallCaseId: str(fd, "recallCaseId"), customerId: str(fd, "customerId"), event, method: opt(fd, "method"), note: opt(fd, "note") });
    return event === "notified" ? "Notification recorded." : "Acknowledgement recorded.";
  });
}

export async function startRecoveryAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    await startRecallRecovery(ctx, { recallCaseId: str(fd, "recallCaseId") });
    return "Recovery started: receive returns into the returns cage and record what is accounted for.";
  });
}

export async function accountedAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    await recordRecallAccounted(ctx, { lineId: str(fd, "lineId"), qty: str(fd, "qty"), note: str(fd, "note") });
    return "Accounted quantity saved.";
  });
}

export async function closeRecallAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    const r = await closeRecallCase(ctx, { recallCaseId: str(fd, "recallCaseId"), closureReport: str(fd, "closureReport"), reconciliationExplanation: opt(fd, "reconciliationExplanation"), password: opt(fd, "password") });
    return r.unreconciled ? `Case closed with ${r.unreconciled} explained gap(s).` : "Case closed; every line reconciled.";
  });
}

export async function cancelRecallAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    await cancelRecallCase(ctx, { recallCaseId: str(fd, "recallCaseId"), reason: str(fd, "reason") });
    return "Case cancelled.";
  });
}
