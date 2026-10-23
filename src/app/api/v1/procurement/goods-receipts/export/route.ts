import { getContext } from "@/lib/auth/context";
import { exportReceiptsCsv } from "@/modules/inventory/receiving";
import { csvResponse, errorResponse } from "../../../_http";

export const dynamic = "force-dynamic";

/** GET /api/v1/procurement/goods-receipts/export?status=&q= — CSV of the current site's receipts. */
export async function GET(req: Request) {
  try {
    const ctx = await getContext();
    if (!ctx) return Response.json({ ok: false, code: "unauthenticated", message: "Sign in again." }, { status: 401 });
    const u = new URL(req.url);
    const r = await exportReceiptsCsv(ctx, { status: u.searchParams.get("status") ?? undefined, q: u.searchParams.get("q") ?? undefined });
    return csvResponse(r.csv, r.fileName);
  } catch (e) {
    return errorResponse(e);
  }
}
