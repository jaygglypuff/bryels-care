"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireContext } from "@/lib/auth/context";
import { toActionState, type ActionState } from "@/lib/errors";
import { reverseMovement } from "@/modules/inventory";

const QTY_RE = /^\d{1,12}(\.\d{1,6})?$/;

const ReverseSchema = z
  .object({
    movementId: z.uuid(),
    idempotencyKey: z.uuid({ message: "Reload the page and try again." }),
    reason: z.string().trim().min(3, { message: "Give the reason for the correction (at least 3 characters)." }).max(500),
    confirmation: z.string().trim().min(1, { message: "Type REVERSE to confirm." }),
    withReplacement: z.enum(["on"]).optional(),
    replacementFrom: z.string().optional(),
    replacementTo: z.string().optional(),
    replacementQty: z.string().trim().optional(),
  })
  .superRefine((v, c) => {
    if (!v.withReplacement) return;
    if (!v.replacementFrom || !z.uuid().safeParse(v.replacementFrom).success) c.addIssue({ code: "custom", path: ["replacementFrom"], message: "Choose where the stock really came from." });
    if (!v.replacementTo || !z.uuid().safeParse(v.replacementTo).success) c.addIssue({ code: "custom", path: ["replacementTo"], message: "Choose where the stock really went." });
    if (!v.replacementQty || !QTY_RE.test(v.replacementQty)) c.addIssue({ code: "custom", path: ["replacementQty"], message: "Enter the correct quantity." });
  });

export async function reverseMovementAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let lotId: string;
  let movementId: string;
  try {
    const ctx = await requireContext();
    const v = ReverseSchema.parse(Object.fromEntries(formData));
    const r = await reverseMovement(ctx, {
      movementId: v.movementId,
      idempotencyKey: v.idempotencyKey,
      reason: v.reason,
      confirmation: v.confirmation,
      replacement: v.withReplacement ? { fromLocationId: v.replacementFrom!, toLocationId: v.replacementTo!, qty: v.replacementQty! } : null,
    });
    lotId = r.lotId;
    movementId = v.movementId;
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath(`/inventory/${lotId}`);
  revalidatePath("/inventory/movements");
  redirect(`/inventory/movements/${movementId}?reversed=1`);
}
