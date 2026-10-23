"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireContext } from "@/lib/auth/context";
import { toActionState, type ActionState } from "@/lib/errors";
import { unlockUser } from "@/modules/identity";

const UnlockSchema = z.object({
  userId: z.uuid(),
  reason: z.string().trim().min(5, "Give a short reason (at least 5 characters).").max(300),
});

export async function unlockAccount(_: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireContext(); // outside try: a sign-in redirect must not be swallowed
  let userId: string;
  try {
    const input = UnlockSchema.parse({ userId: formData.get("userId"), reason: formData.get("reason") });
    await unlockUser(ctx, input.userId, input.reason);
    userId = input.userId;
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/admin/users");
  redirect(`/admin/users/${userId}?unlocked=1`);
}
