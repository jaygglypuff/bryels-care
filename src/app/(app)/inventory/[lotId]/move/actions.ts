"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireContext } from "@/lib/auth/context";
import { toActionState, type ActionState } from "@/lib/errors";
import { transferStock } from "@/modules/inventory/movements";

const QTY_RE = /^\d{1,12}(\.\d{1,6})?$/;

const MoveSchema = z.object({
  lotId: z.uuid(),
  idempotencyKey: z.uuid({ message: "Reload the page and try again." }),
  fromLocationId: z.uuid({ message: "Choose where the stock is now." }),
  toLocationId: z.uuid({ message: "Choose where the stock goes." }),
  qty: z.string().trim().regex(QTY_RE, { message: "Enter a quantity like 1500 or 12.5 (up to 6 decimals)." }),
  reason: z.string().trim().min(3, { message: "Say why the stock is moving (at least 3 characters)." }).max(500),
});

export async function moveStockAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let result: { lotId: string; number: string };
  try {
    const ctx = await requireContext();
    const input = MoveSchema.parse(Object.fromEntries(formData));
    result = await transferStock(ctx, input);
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/inventory");
  revalidatePath(`/inventory/${result.lotId}`);
  redirect(`/inventory/${result.lotId}?moved=${encodeURIComponent(result.number)}`);
}
