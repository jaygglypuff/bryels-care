"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { DomainError, type ActionState, toActionState } from "@/lib/errors";
import { refreshCurrentPage } from "@/lib/in-place";
import { logger } from "@/lib/log";
import { clientIp } from "@/lib/rate-limit";
import { isDemoMode } from "@/lib/demo";
import {
  acceptPortalInvitation,
  beginPortalTotp,
  changePortalPassword,
  clearPortalCookie,
  clearPortalMfaCookie,
  completePortalMfa,
  confirmPortalTotp,
  disablePortalTotp,
  inspectPortalInvitation,
  placePortalOrder,
  readPortalMfaToken,
  readPortalToken,
  requirePortalContext,
  setPortalCookie,
  setPortalMfaCookie,
  signInPortal,
  signInPortalAsDemo,
  signOutPortal,
  type PortalSignInResult,
  type PortalTokenState,
} from "@/modules/portal";

/**
 * Portal server actions: thin adapters over src/modules/portal (no business rules here). Cookies are
 * the portal's own (`bc_portal`, `bc_portal_mfa`); nothing here reads the staff session.
 */

async function originOk() {
  const origin = (await headers()).get("origin");
  return !(process.env.APP_ORIGIN && origin && origin !== process.env.APP_ORIGIN);
}

async function finish(r: PortalSignInResult): Promise<ActionState> {
  if (r.kind === "failed") return { ok: false, message: r.message };
  if (r.kind === "mfa") {
    await setPortalMfaCookie(r.pendingToken, r.session.expiresAt);
    redirect("/portal/sign-in/verify");
  }
  await setPortalCookie(r.token, r.session.expiresAt);
  redirect("/portal");
}

export async function portalSignIn(_: ActionState, fd: FormData): Promise<ActionState> {
  if (!(await originOk())) return { ok: false, message: "Request origin not allowed." };
  const email = String(fd.get("email") ?? "");
  const password = String(fd.get("password") ?? "");
  if (!email.trim() || !password) return { ok: false, message: "Enter your email and password." };
  const h = await headers();
  const r = await signInPortal({ email, password, ip: clientIp(h), userAgent: h.get("user-agent") });
  if (r.kind === "failed" && r.retryAfterSeconds) logger.warn("portal sign-in rate limited", { module: "portal", command: "portal.session.sign_in", outcome: "rate_limited" });
  return finish(r);
}

/** "Sign in as …" for demo portal accounts (demo mode only; the service checks both rules again). */
export async function portalDemoSignIn(_: ActionState, fd: FormData): Promise<ActionState> {
  if (!isDemoMode()) return { ok: false, message: "One-click sign-in exists only in the demo environment." };
  if (!(await originOk())) return { ok: false, message: "Request origin not allowed." };
  const h = await headers();
  let r: PortalSignInResult;
  try {
    r = await signInPortalAsDemo({ email: String(fd.get("email") ?? ""), ip: clientIp(h), userAgent: h.get("user-agent") });
  } catch (e) {
    return toActionState(e);
  }
  return finish(r);
}

export async function portalVerifyCode(_: ActionState, fd: FormData): Promise<ActionState> {
  if (!(await originOk())) return { ok: false, message: "Request origin not allowed." };
  const pending = await readPortalMfaToken();
  if (!pending) return { ok: false, message: "The sign-in step expired. Go back and sign in again." };
  try {
    const out = await completePortalMfa(pending, String(fd.get("code") ?? ""));
    await clearPortalMfaCookie();
    await setPortalCookie(out.token, out.session.expiresAt);
  } catch (e) {
    if (e instanceof DomainError && e.code === "unauthenticated") await clearPortalMfaCookie();
    return toActionState(e);
  }
  redirect("/portal");
}

export async function portalSignOut(): Promise<void> {
  await signOutPortal(await readPortalToken());
  await clearPortalCookie();
  redirect("/portal/sign-in?notice=signed_out");
}

export async function checkPortalInvitation(token: string): Promise<PortalTokenState> {
  return inspectPortalInvitation(String(token ?? ""));
}

export async function acceptPortalInvite(_: ActionState, fd: FormData): Promise<ActionState> {
  if (!(await originOk())) return { ok: false, message: "Request origin not allowed." };
  const password = String(fd.get("password") ?? "");
  if (password !== String(fd.get("confirm") ?? "")) return { ok: false, message: "The two passwords are not the same.", fieldErrors: { confirm: "Type the same password again." } };
  try {
    await acceptPortalInvitation({ token: String(fd.get("token") ?? ""), password, ip: clientIp(await headers()) });
  } catch (e) {
    return toActionState(e);
  }
  redirect("/portal/sign-in?notice=password_set");
}

/* ------------------------------------------------------------------ signed in */

/** Places an order (lines.N.productId / lines.N.qty); opens the new order page on success. */
export async function portalPlaceOrder(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requirePortalContext();
  const lines: { productId: string; qty: string }[] = [];
  const formIndex: number[] = [];
  for (let i = 0; i < 500; i++) {
    const productId = fd.get(`lines.${i}.productId`);
    if (productId === null) break;
    const qty = String(fd.get(`lines.${i}.qty`) ?? "").trim();
    if (qty === "" || qty === "0") continue;
    lines.push({ productId: String(productId), qty });
    formIndex.push(i);
  }
  let placed: Awaited<ReturnType<typeof placePortalOrder>>;
  try {
    placed = await placePortalOrder(
      ctx,
      {
        lines,
        requestedDeliveryOn: String(fd.get("requestedDeliveryOn") ?? ""),
        customerPoNumber: String(fd.get("customerPoNumber") ?? "") || null,
        shipToAddressId: String(fd.get("shipToAddressId") ?? "") || null,
        note: String(fd.get("note") ?? "") || null,
      },
      { idempotencyKey: String(fd.get("idempotencyKey") ?? "") || null },
    );
  } catch (e) {
    const st = toActionState(e);
    // Field errors name the n-th ordered line; the form shows them on the catalogue row it came from.
    if (st?.fieldErrors) st.fieldErrors = Object.fromEntries(Object.entries(st.fieldErrors).map(([k, v]) => [k.replace(/^lines\.(\d+)\./, (_, n) => `lines.${formIndex[Number(n)] ?? n}.`), v]));
    return st;
  }
  redirect(`/portal/orders/${placed.orderId}?placed=1`);
}

export async function portalChangePassword(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requirePortalContext();
  const next = String(fd.get("newPassword") ?? "");
  if (next !== String(fd.get("confirm") ?? "")) return { ok: false, message: "The two new passwords are not the same.", fieldErrors: { confirm: "Type the same password again." } };
  try {
    await changePortalPassword(ctx, { currentPassword: String(fd.get("currentPassword") ?? ""), newPassword: next });
  } catch (e) {
    return toActionState(e);
  }
  refreshCurrentPage();
  return { ok: true, message: "Password changed. Your other devices were signed out." };
}

export type TotpBeginState = (ActionState & { qrDataUrl?: string; secret?: string }) | null;

export async function portalBeginTotp(_: TotpBeginState, fd: FormData): Promise<TotpBeginState> {
  const ctx = await requirePortalContext();
  try {
    const r = await beginPortalTotp(ctx, String(fd.get("password") ?? ""));
    return { ok: true, message: "Scan the code with your authenticator app, then enter the 6-digit code below.", qrDataUrl: r.qrDataUrl, secret: r.secret };
  } catch (e) {
    return toActionState(e);
  }
}

export async function portalConfirmTotp(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requirePortalContext();
  try {
    await confirmPortalTotp(ctx, String(fd.get("code") ?? ""));
  } catch (e) {
    return toActionState(e);
  }
  refreshCurrentPage();
  return { ok: true, message: "Two-step sign-in is on. Next time you sign in, enter the code from your app." };
}

export async function portalDisableTotp(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requirePortalContext();
  try {
    await disablePortalTotp(ctx, String(fd.get("code") ?? ""));
  } catch (e) {
    return toActionState(e);
  }
  refreshCurrentPage();
  return { ok: true, message: "Two-step sign-in is off." };
}
