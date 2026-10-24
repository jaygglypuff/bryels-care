"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { sessions } from "@/db/schema";
import { requireContext } from "@/lib/auth/context";
import { SITE_COOKIE, destroySession } from "@/lib/auth/session";

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

export async function signOut() {
  await destroySession();
  redirect("/sign-in?notice=signed_out");
}
