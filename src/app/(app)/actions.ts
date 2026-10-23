"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { SITE_COOKIE, destroySession } from "@/lib/auth/session";

export async function switchSite(formData: FormData) {
  const ctx = await requireContext();
  const siteId = String(formData.get("siteId") ?? "");
  ctx.requireSite(siteId);
  (await cookies()).set(SITE_COOKIE, siteId, { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" });
  redirect(String(formData.get("returnTo") || "/dashboard"));
}

export async function signOut() {
  await destroySession();
  redirect("/sign-in");
}
