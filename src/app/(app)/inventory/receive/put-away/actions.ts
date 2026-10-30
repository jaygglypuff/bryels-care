"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { toActionState, type ActionState } from "@/lib/errors";
import { putAwayLot } from "@/modules/inventory/receiving-putaway";

/** Thin adapter: every rule is in putAwayLot. On success it goes back to the list with the result. */
export async function putAwayAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let message: string;
  try {
    const ctx = await requireContext();
    const location = String(fd.get("location") ?? "");
    const r = await putAwayLot(ctx, {
      lotRef: String(fd.get("lot") ?? ""),
      locationRef: location,
      fromLocationId: String(fd.get("fromLocationId") ?? "") || null,
      qty: String(fd.get("qty") ?? "") || null,
      qtyUom: String(fd.get("qtyUom") ?? "") || null,
      idempotencyKey: String(fd.get("idempotencyKey") ?? ""),
    });
    message = `${r.replayed ? "Already put away" : "Done"}: lot ${r.lotNumber} is now at ${location.trim().toUpperCase().replace(/^BC:LOC:/, "")} · movement ${r.number}.`;
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/inventory");
  revalidatePath("/inventory/receive/put-away");
  redirect(`/inventory/receive/put-away?moved=${encodeURIComponent(message)}`);
}
