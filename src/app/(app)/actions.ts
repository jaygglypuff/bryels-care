"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { sessions } from "@/db/schema";
import { requireContext } from "@/lib/auth/context";
import { SITE_COOKIE, destroySession } from "@/lib/auth/session";
import { loadGuide } from "@/ui/help/guides";
import { guideKeyFor } from "@/ui/help/screen-guides";

/** Site switcher (US-1-18 AC2): only allowed sites; the choice filters lists and never widens access. */
export async function switchSite(formData: FormData) {
  const ctx = await requireContext();
  const siteId = String(formData.get("siteId") ?? "");
  ctx.requireSite(siteId);
  (await cookies()).set(SITE_COOKIE, siteId, { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" });
  if (ctx.sessionId) await db.update(sessions).set({ activeSiteId: siteId }).where(eq(sessions.id, ctx.sessionId));
  const returnTo = String(formData.get("returnTo") || "/dashboard");
  redirect(returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/dashboard");
}

/**
 * The frame's Help "?" (round 4): the quick guide for the screen at `pathname`. Guides are reviewed product
 * documentation (docs/help), readable by anyone signed in; nothing is changed or recorded.
 */
export async function helpForScreen(pathname: string) {
  const ctx = await requireContext();
  const path = typeof pathname === "string" && pathname.startsWith("/") ? pathname.slice(0, 300) : "/dashboard";
  return { guide: loadGuide(guideKeyFor(path, ctx.roleCodes)) };
}

export async function signOut() {
  await destroySession();
  redirect("/sign-in?notice=signed_out");
}
