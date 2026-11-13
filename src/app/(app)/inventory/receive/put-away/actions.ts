"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { parseVia } from "@/lib/scan/pick";
import { toActionState, type ActionState } from "@/lib/errors";
import { putAwayLot } from "@/modules/inventory/receiving-putaway";
import { formKey } from "@/lib/form-key";

/** Thin adapter: every rule is in putAwayLot. On success it goes back to the list with the result. */
export async function putAwayAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let message: string;
  try {
    const ctx = await requireContext();
    const location = String(fd.get("location") ?? "");
    const r = await putAwayLot(ctx, {
      lotRef: String(fd.get("lot") ?? ""),
      locationRef: location,
      locationVia: parseVia(fd.get("locationVia")),
      fromLocationId: String(fd.get("fromLocationId") ?? "") || null,
      qty: String(fd.get("qty") ?? "") || null,
      qtyUom: String(fd.get("qtyUom") ?? "") || null,
      idempotencyKey: formKey(fd),
    });
    // ADR-110 C16: no movement number on the floor (it stays in Stock changes and the audit trail). C3: boxes are named.
    const boxes = r.boxes.length ? ` with ${r.boxes.length === 1 ? `box ${r.boxes[0]}` : `${r.boxes.length} boxes (${r.boxes.join(", ")})`}` : "";
    message = `${r.replayed ? "Already put away" : "Done"}: lot ${r.lotNumber}${boxes} is ${r.toCode ? `now on ${r.toCode}` : "put away"}. It can be used now.`;
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/inventory");
  revalidatePath("/inventory/receive/put-away");
  redirect(`/inventory/receive/put-away?moved=${encodeURIComponent(message)}`);
}
