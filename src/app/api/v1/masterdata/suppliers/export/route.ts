import { getContext } from "@/lib/auth/context";
import { exportSuppliersCsv } from "@/modules/masterdata";
import { csvResponse, errorResponse } from "../../../_http";

export const dynamic = "force-dynamic";

/** GET /api/v1/masterdata/suppliers/export?q=&status= — CSV (masterdata.supplier.export). */
export async function GET(req: Request) {
  try {
    const ctx = await getContext();
    if (!ctx) return Response.json({ ok: false, code: "unauthenticated", message: "Sign in again." }, { status: 401 });
    const u = new URL(req.url);
    const r = await exportSuppliersCsv(ctx, { q: u.searchParams.get("q") ?? undefined, status: u.searchParams.get("status") ?? undefined });
    return csvResponse(r.csv, r.fileName);
  } catch (e) {
    return errorResponse(e);
  }
}
