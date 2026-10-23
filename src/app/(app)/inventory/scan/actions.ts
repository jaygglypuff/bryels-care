"use server";
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { toActionState, type ActionState } from "@/lib/errors";
import { resolveScan } from "@/modules/inventory/lookup";

export async function scanAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let href: string;
  try {
    const ctx = await requireContext();
    const code = String(formData.get("code") ?? "").slice(0, 200);
    const r = await resolveScan(ctx, code);
    if (!r.ok) return { ok: false, message: r.message };
    href = r.href;
  } catch (e) {
    return toActionState(e);
  }
  redirect(href);
}
