"use server";
import { revalidatePath } from "next/cache";
import { requireContext } from "@/lib/auth/context";
import { toActionState, type ActionState } from "@/lib/errors";
import { putAwayLot } from "@/modules/inventory/receiving-putaway";

export async function putAwayAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const r = await putAwayLot(ctx, {
      lotRef: String(fd.get("lot") ?? ""),
      locationRef: String(fd.get("location") ?? ""),
      fromLocationId: String(fd.get("fromLocationId") ?? "") || null,
      qty: String(fd.get("qty") ?? "") || null,
      idempotencyKey: String(fd.get("idempotencyKey") ?? ""),
    });
    revalidatePath("/inventory");
    return { ok: true, message: `${r.replayed ? "Already put away" : "Put away"}: lot ${r.lotNumber} · movement ${r.number}.` };
  } catch (e) {
    return toActionState(e);
  }
}
