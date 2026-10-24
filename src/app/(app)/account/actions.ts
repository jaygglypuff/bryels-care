"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContext } from "@/lib/auth/context";
import { replaceSessionCookie } from "@/lib/auth/session";
import { type ActionState, toActionState } from "@/lib/errors";
import { beginMfaEnrolment, changeOwnPassword, confirmMfaEnrolment, disableOwnMfa, reauthenticate, revokeSession } from "@/modules/identity";

/** Step-up: password (and code when enrolled). Rotates the session token (docs/security.md §3.6). */
export async function reauth(_: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  try {
    const token = await reauthenticate(ctx, {
      password: String(formData.get("password") ?? ""),
      code: (formData.get("code") as string | null) || null,
      purpose: String(formData.get("purpose") ?? "").slice(0, 120),
    });
    await replaceSessionCookie(token, ctx.sessionId!);
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Confirmed. Restricted changes are open for the next few minutes." };
}

const PasswordSchema = z.object({ currentPassword: z.string().min(1, "Enter your current password.").max(256), newPassword: z.string().max(256), confirm: z.string().max(256) });

export async function changePassword(_: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  try {
    const input = PasswordSchema.parse(Object.fromEntries(formData));
    if (input.newPassword !== input.confirm) return { ok: false, message: "The two new passwords differ.", fieldErrors: { confirm: "Type the same password twice." } };
    const r = await changeOwnPassword(ctx, { currentPassword: input.currentPassword, newPassword: input.newPassword });
    revalidatePath("/account");
    return { ok: true, message: `Password changed. ${r.revokedSessions} other device(s) were signed out.` };
  } catch (e) {
    const s = toActionState(e);
    if (s?.fieldErrors?.password) s.fieldErrors.newPassword = s.fieldErrors.password;
    return s;
  }
}

export async function revokeMySession(formData: FormData): Promise<void> {
  const ctx = await requireContext();
  const id = z.uuid().parse(formData.get("sessionId"));
  await revokeSession(ctx, id, "signed out from the account page");
  revalidatePath("/account");
}

export type EnrolState = { ok: boolean; message?: string; secret?: string; qr?: string; codes?: string[]; fieldErrors?: Record<string, string>; needsReauth?: boolean } | null;

export async function startEnrolment(_: EnrolState): Promise<EnrolState> {
  const ctx = await requireContext();
  try {
    const r = await beginMfaEnrolment(ctx);
    return { ok: true, secret: r.secret, qr: r.qrDataUrl };
  } catch (e) {
    const s = toActionState(e);
    return { ok: false, message: s?.message, needsReauth: (e as { code?: string }).code === "reauth_required" };
  }
}

export async function finishEnrolment(prev: EnrolState, formData: FormData): Promise<EnrolState> {
  const ctx = await requireContext();
  try {
    const r = await confirmMfaEnrolment(ctx, String(formData.get("code") ?? ""));
    // No revalidation here: the recovery codes stay on screen until the person presses "I saved them".
    return { ok: true, codes: r.recoveryCodes };
  } catch (e) {
    const s = toActionState(e);
    return { ...prev, ok: false, message: s?.message, fieldErrors: s?.fieldErrors };
  }
}

export async function turnOffMfa(_: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  try {
    await disableOwnMfa(ctx, String(formData.get("code") ?? ""));
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/account");
  return { ok: true, message: "Two-step sign-in is off." };
}
