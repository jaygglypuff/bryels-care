"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { toActionState, type ActionState } from "@/lib/errors";
import {
  approveLineDiscrepancy,
  cancelReceiptDraft,
  linkReceiptSupplier,
  postReceipt,
  recordLineDiscrepancy,
  reverseReceipt,
} from "@/modules/inventory/receiving";
import { voidAttachment } from "@/modules/inventory/receiving-documents";
import type { DiscrepancyKind } from "@/modules/inventory/receiving-state";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");

function done(receiptId: string, message: string): ActionState {
  revalidatePath(`/inventory/receive/${receiptId}`);
  revalidatePath("/inventory/receipts");
  return { ok: true, message };
}

export async function postDraftAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const receiptId = str(fd, "receiptId");
  try {
    const ctx = await requireContext();
    await postReceipt(ctx, { receiptId });
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/inventory");
  redirect(`/inventory/receive/${receiptId}?posted=1`);
}

export async function cancelDraftAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const receiptId = str(fd, "receiptId");
  try {
    const ctx = await requireContext();
    await cancelReceiptDraft(ctx, { receiptId, reason: str(fd, "reason") });
  } catch (e) {
    return toActionState(e);
  }
  return done(receiptId, "Draft cancelled.");
}

export async function reverseReceiptAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const receiptId = str(fd, "receiptId");
  try {
    const ctx = await requireContext();
    await reverseReceipt(ctx, { receiptId, reason: str(fd, "reason") });
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/inventory");
  return done(receiptId, "Receipt reversed. The lots stay on record with zero stock.");
}

export async function recordDiscrepancyAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const receiptId = str(fd, "receiptId");
  try {
    const ctx = await requireContext();
    await recordLineDiscrepancy(ctx, { lineId: str(fd, "lineId"), kind: str(fd, "kind") as DiscrepancyKind, note: str(fd, "note") });
  } catch (e) {
    return toActionState(e);
  }
  return done(receiptId, "Discrepancy recorded. Procurement will review it.");
}

export async function approveDiscrepancyAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const receiptId = str(fd, "receiptId");
  try {
    const ctx = await requireContext();
    await approveLineDiscrepancy(ctx, { lineId: str(fd, "lineId"), note: str(fd, "note") });
  } catch (e) {
    return toActionState(e);
  }
  return done(receiptId, "Discrepancy approved.");
}

export async function linkSupplierAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const receiptId = str(fd, "receiptId");
  try {
    const ctx = await requireContext();
    await linkReceiptSupplier(ctx, { receiptId, supplierId: str(fd, "supplierId") });
  } catch (e) {
    return toActionState(e);
  }
  return done(receiptId, "Supplier linked.");
}

export async function voidFileAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const receiptId = str(fd, "receiptId");
  try {
    const ctx = await requireContext();
    await voidAttachment(ctx, { attachmentId: str(fd, "attachmentId"), reason: str(fd, "reason") });
  } catch (e) {
    return toActionState(e);
  }
  return done(receiptId, "File removed. It is kept in storage for the retention period.");
}
