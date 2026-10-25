import { NextResponse } from "next/server";
import { getContext } from "@/lib/auth/context";
import { whoCanDo } from "@/modules/identity";

export const dynamic = "force-dynamic";

/** "Who can do this?" under a refused step (ADR-073): roles and colleagues holding the permission. Signed-in staff only. */
export async function GET(req: Request) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const url = new URL(req.url);
  const permission = url.searchParams.get("permission") ?? "";
  const siteId = url.searchParams.get("siteId");
  const result = await whoCanDo(ctx, permission, siteId && /^[0-9a-f-]{36}$/i.test(siteId) ? siteId : null);
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
}
