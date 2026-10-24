"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { clientIp } from "@/lib/auth/session";
import { type ActionState, toActionState } from "@/lib/errors";
import { type TokenState, acceptInvitation, completePasswordReset, inspectInvitation, inspectResetToken, requestPasswordReset } from "@/modules/identity";

/**
 * Self-service account actions without a session (US-1-11). The token arrives in the POST body,
 * read by the page from the URL fragment, never from a URL the server logs.
 */
async function originOk() {
  const origin = (await headers()).get("origin");
  return !(process.env.APP_ORIGIN && origin && origin !== process.env.APP_ORIGIN);
}

export async function checkInvitation(token: string): Promise<TokenState> {
  return inspectInvitation(String(token ?? ""));
}

export async function checkReset(token: string): Promise<TokenState> {
  return inspectResetToken(String(token ?? ""));
}

function confirmMismatch(formData: FormData): ActionState | null {
  if (formData.get("password") !== formData.get("confirm")) return { ok: false, message: "The two passwords differ.", fieldErrors: { confirm: "Type the same password twice." } };
  return null;
}

export async function acceptInvite(_: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await originOk())) return { ok: false, message: "Request origin not allowed." };
  const mismatch = confirmMismatch(formData);
  if (mismatch) return mismatch;
  try {
    await acceptInvitation({ token: String(formData.get("token") ?? ""), password: String(formData.get("password") ?? ""), ip: await clientIp() });
  } catch (e) {
    return toActionState(e);
  }
  redirect("/sign-in?notice=password_set");
}

export async function requestReset(_: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await originOk())) return { ok: false, message: "Request origin not allowed." };
  const r = await requestPasswordReset({ email: String(formData.get("email") ?? ""), ip: await clientIp() });
  return { ok: true, message: r.message };
}

export async function completeReset(_: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await originOk())) return { ok: false, message: "Request origin not allowed." };
  const mismatch = confirmMismatch(formData);
  if (mismatch) return mismatch;
  try {
    await completePasswordReset({ token: String(formData.get("token") ?? ""), password: String(formData.get("password") ?? ""), ip: await clientIp() });
  } catch (e) {
    return toActionState(e);
  }
  redirect("/sign-in?notice=password_reset");
}
