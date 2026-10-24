"use server";
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { destroySession } from "@/lib/auth/session";
import { type ActionState, toActionState } from "@/lib/errors";
import { resetDemoData } from "@/modules/platform";

/**
 * Owner-only "Reset demo data" (ADR-044). The service checks demo mode, the role, step-up, the typed
 * confirmation and the real-account guard. Every session was part of the wipe, so on success the
 * cookie is cleared and the owner lands on the sign-in page with a notice.
 */
export async function resetDemo(_: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  try {
    await resetDemoData(ctx, { confirm: String(formData.get("confirm") ?? "") });
  } catch (e) {
    return toActionState(e);
  }
  await destroySession("demo data reset");
  redirect("/sign-in?notice=demo_reset");
}
