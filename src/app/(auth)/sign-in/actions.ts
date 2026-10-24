"use server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { clearMfaCookie, clientIp, readMfaCookie, setMfaCookie, setSessionCookie } from "@/lib/auth/session";
import { DomainError, type ActionState, toActionState } from "@/lib/errors";
import { completeMfaSignIn, signInWithPassword } from "@/modules/identity";
import { logger } from "@/lib/log";
import { clientIp as limiterClientIp, limitLoginIp } from "@/lib/rate-limit";

const Schema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(256) });

async function originOk() {
  const origin = (await headers()).get("origin");
  return !(process.env.APP_ORIGIN && origin && origin !== process.env.APP_ORIGIN);
}

export async function signIn(_: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await originOk())) return { ok: false, message: "Request origin not allowed." };
  const parsed = Schema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { ok: false, message: "Enter your email and password." };
  const h = await headers();
  // US-1-25 AC3 / docs/security.md §3.3: per-IP sign-in limits in the shared store (setting platform.rate_limits).
  const limited = await limitLoginIp(limiterClientIp(h));
  if (!limited.allowed) {
    logger.warn("sign-in rate limited", { module: "identity", command: "identity.session.sign_in", outcome: "rate_limited" });
    return { ok: false, message: `Too many sign-in attempts from this network. Wait ${limited.retryAfterSeconds} seconds, then try again.` };
  }
  const r = await signInWithPassword({
    ...parsed.data,
    ip: await clientIp(),
    userAgent: h.get("user-agent"),
    deviceClass: formData.get("sharedDevice") === "on" ? "shared" : "standard",
  });
  if (r.kind === "failed") return { ok: false, message: r.message };
  if (r.kind === "mfa") {
    await setMfaCookie(r.pendingToken, r.session.expiresAt);
    redirect("/sign-in/verify");
  }
  await setSessionCookie(r.token, r.session.expiresAt);
  redirect("/dashboard");
}

/** Second step: TOTP or recovery code (US-1-28 AC2). */
export async function verifyCode(_: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await originOk())) return { ok: false, message: "Request origin not allowed." };
  const pending = await readMfaCookie();
  if (!pending) return { ok: false, message: "The sign-in step expired. Go back and sign in again." };
  try {
    const out = await completeMfaSignIn(pending, String(formData.get("code") ?? ""));
    await clearMfaCookie();
    await setSessionCookie(out.token, out.session.expiresAt);
  } catch (e) {
    if (e instanceof DomainError && e.code === "unauthenticated") await clearMfaCookie();
    return toActionState(e);
  }
  redirect("/dashboard");
}
