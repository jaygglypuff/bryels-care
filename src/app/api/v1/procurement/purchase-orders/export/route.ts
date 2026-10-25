import { getContext } from "@/lib/auth/context";
import { exportPurchaseOrdersCsv } from "@/modules/procurement";
import { csvResponse, errorResponse } from "../../../_http";

export const dynamic = "force-dynamic";

/** GET /api/v1/procurement/purchase-orders/export?status=&q= — CSV of purchase orders at the caller's sites (procurement.purchase_order.export). */
export async function GET(req: Request) {
  try {
    const ctx = await getContext();
    if (!ctx) return Response.json({ ok: false, code: "unauthenticated", message: "Sign in again." }, { status: 401 });
    const u = new URL(req.url);
    const r = await exportPurchaseOrdersCsv(ctx, { status: u.searchParams.get("status") ?? undefined, q: u.searchParams.get("q") ?? undefined });
    return csvResponse(r.csv, r.fileName);
  } catch (e) {
    return errorResponse(e);
  }
}
