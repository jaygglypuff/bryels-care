"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { toActionState, type ActionState } from "@/lib/errors";
import { issueHeldStock, liftHold, markHoldInvestigating, placeHold, type HeldIssuePurpose, type HoldResolution } from "@/modules/inventory/holds";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");
/** The lot comes from the pick list (`lot`) or, under "More details", from a scanned label (`lotScan`, wins when filled). */
const lotRef = (fd: FormData) => str(fd, "lotScan").trim() || str(fd, "lot");

export async function placeHoldAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let holdId: string;
  try {
    const ctx = await requireContext();
    const scope = str(fd, "scope") === "location" ? "location" : "lot";
    const r = await placeHold(ctx, { scope, lotRef: lotRef(fd), locationId: str(fd, "locationId"), reasonCode: str(fd, "reasonCode"), reason: str(fd, "reason"), idempotencyKey: str(fd, "idempotencyKey") });
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
  return { ok: true, message: "No longer stopped. The QA decision was saved for every lot." };
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
  return { ok: true, message: "Saved: QA is looking into it. The lots stay stopped." };
}

export async function issueHeldStockAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const r = await issueHeldStock(ctx, {
      lotRef: lotRef(fd),
      fromLocationId: str(fd, "fromLocationId"),
      qty: str(fd, "qty"),
      purpose: str(fd, "purpose") as HeldIssuePurpose,
      reason: str(fd, "reason"),
      idempotencyKey: str(fd, "idempotencyKey"),
    });
    revalidatePath("/inventory");
    return { ok: true, message: r.replayed ? "Already saved (same form sent twice)." : "Taken out as an exception. The stock record marks it as an exception." };
  } catch (e) {
    return toActionState(e);
  }
}
