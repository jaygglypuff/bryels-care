"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { toActionState, type ActionState } from "@/lib/errors";
import { issueHeldStock, liftHold, markHoldInvestigating, placeHold, type HeldIssuePurpose, type HoldResolution } from "@/modules/inventory/holds";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");

export async function placeHoldAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let holdId: string;
  try {
    const ctx = await requireContext();
    const scope = str(fd, "scope") === "location" ? "location" : "lot";
    const r = await placeHold(ctx, { scope, lotRef: str(fd, "lot"), locationId: str(fd, "locationId"), reasonCode: str(fd, "reasonCode"), reason: str(fd, "reason"), idempotencyKey: str(fd, "idempotencyKey") });
    holdId = r.holdId;
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/quality/holds");
  revalidatePath("/inventory");
  redirect(`/quality/holds/${holdId}?placed=1`);
}

export async function liftHoldAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const holdId = str(fd, "holdId");
  try {
    const ctx = await requireContext();
    await liftHold(ctx, { holdId, resolution: str(fd, "resolution") as HoldResolution, reason: str(fd, "reason") });
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath(`/quality/holds/${holdId}`);
  revalidatePath("/inventory");
  return { ok: true, message: "Hold lifted. Closing dispositions were recorded for every lot." };
}

export async function investigateHoldAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const holdId = str(fd, "holdId");
  try {
    const ctx = await requireContext();
    await markHoldInvestigating(ctx, { holdId, note: str(fd, "note") });
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath(`/quality/holds/${holdId}`);
  return { ok: true, message: "Marked as under investigation. The hold stays in force." };
}

export async function issueHeldStockAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const r = await issueHeldStock(ctx, {
      lotRef: str(fd, "lot"),
      fromLocationId: str(fd, "fromLocationId"),
      qty: str(fd, "qty"),
      purpose: str(fd, "purpose") as HeldIssuePurpose,
      reason: str(fd, "reason"),
      idempotencyKey: str(fd, "idempotencyKey"),
    });
    revalidatePath("/inventory");
    return { ok: true, message: r.replayed ? "Already issued (same submission)." : "Issued under the held-stock exception. The movement is marked as an exception in the ledger." };
  } catch (e) {
    return toActionState(e);
  }
}
