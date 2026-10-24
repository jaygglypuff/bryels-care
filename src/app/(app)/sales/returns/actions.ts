"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { toActionState, type ActionState } from "@/lib/errors";
import { refreshCurrentPage } from "@/lib/in-place";
import {
  addReturnLine,
  approveCustomerReturn,
  cancelCustomerReturn,
  closeCustomerReturn,
  createCustomerReturn,
  markReturnInspected,
  postCustomerReturn,
  removeReturnLine,
  sendBackCustomerReturn,
  submitCustomerReturn,
} from "@/modules/sales";

/*
 * Customer return server actions (US-4-16). Thin adapters: parse the form, call the service, then
 * redirect (create) or re-render the current page in the response (ADR-043).
 */

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const opt = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return v === null || String(v).trim() === "" ? null : String(v);
};

async function inPlace(fn: () => Promise<string>): Promise<ActionState> {
  try {
    const message = await fn();
    refreshCurrentPage();
    return { ok: true, message };
  } catch (e) {
    return toActionState(e);
  }
}

export async function createReturnAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const ctx = await requireContext();
    const r = await createCustomerReturn(ctx, {
      shipmentId: str(fd, "shipmentId"),
      reasonCode: str(fd, "reasonCode"),
      reasonNote: opt(fd, "reasonNote"),
      complaintId: opt(fd, "complaintId"),
      toLocationId: opt(fd, "toLocationId"),
      idempotencyKey: opt(fd, "idempotencyKey"),
    });
    id = r.returnId;
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/sales/returns");
  redirect(`/sales/returns/${id}`);
}

export async function addLineAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    const r = await addReturnLine(ctx, {
      returnId: str(fd, "returnId"),
      code: str(fd, "code"),
      qty: opt(fd, "qty"),
      condition: str(fd, "condition"),
      toLocationId: opt(fd, "toLocationId"),
      note: opt(fd, "note"),
      manualEntry: fd.get("manualEntry") === "yes",
    });
    return `Line ${r.lineNo}: ${r.qty} ${r.uom} of lot ${r.lotNumber}${r.boxNumber ? ` (box ${r.boxNumber})` : ""}.`;
  });
}

export async function removeLineAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    await removeReturnLine(ctx, { returnId: str(fd, "returnId"), lineId: str(fd, "lineId") });
    return "Line removed.";
  });
}

export async function submitReturnAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    await submitCustomerReturn(ctx, { returnId: str(fd, "returnId") });
    return "Submitted for approval.";
  });
}

export async function approveReturnAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    await approveCustomerReturn(ctx, { returnId: str(fd, "returnId"), note: opt(fd, "note") });
    return "Approved; the return can now be received into quarantine.";
  });
}

export async function sendBackReturnAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    await sendBackCustomerReturn(ctx, { returnId: str(fd, "returnId"), reason: str(fd, "reason") });
    return "Sent back to draft.";
  });
}

export async function postReturnAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    const r = await postCustomerReturn(ctx, { returnId: str(fd, "returnId"), idempotencyKey: str(fd, "idempotencyKey") });
    const lots = r.lines.map((l) => l.returnLotNumber).join(", ");
    return r.replayed ? `Already received (${lots}).` : `Received into quarantine as lot(s) ${lots}. QA has been notified to disposition them.`;
  });
}

export async function inspectReturnAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    await markReturnInspected(ctx, { returnId: str(fd, "returnId") });
    return "Marked as dispositioned by QA.";
  });
}

export async function closeReturnAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    await closeCustomerReturn(ctx, { returnId: str(fd, "returnId") });
    return "Return closed.";
  });
}

export async function cancelReturnAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    await cancelCustomerReturn(ctx, { returnId: str(fd, "returnId"), reason: str(fd, "reason") });
    return "Return cancelled.";
  });
}
