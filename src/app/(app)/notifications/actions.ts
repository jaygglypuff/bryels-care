"use server";
import { revalidatePath } from "next/cache";
import { requireContext } from "@/lib/auth/context";
import { acknowledgeNotification, markAllNotificationsRead, markNotificationRead } from "@/modules/platform";

/** Self-service: a user can only touch their own notifications (the service returns "not found" otherwise). */
export async function acknowledgeAction(formData: FormData) {
  const ctx = await requireContext();
  await acknowledgeNotification(ctx, String(formData.get("id") ?? ""));
  revalidatePath("/", "layout");
}

export async function markReadAction(formData: FormData) {
  const ctx = await requireContext();
  await markNotificationRead(ctx, String(formData.get("id") ?? ""));
  revalidatePath("/", "layout");
}

export async function markAllReadAction() {
  const ctx = await requireContext();
  await markAllNotificationsRead(ctx);
  revalidatePath("/", "layout");
}
