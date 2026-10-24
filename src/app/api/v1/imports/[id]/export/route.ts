import { getContext } from "@/lib/auth/context";
import { exportImportRows } from "@/modules/imports";
import { errorResponse } from "../../../_http";

export const dynamic = "force-dynamic";

/** GET /api/v1/imports/<id>/export?what=results|crosswalk — results file or row → record crosswalk (CSV, neutralised, audited). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getContext();
    if (!ctx) return Response.json({ ok: false, code: "unauthenticated", message: "Sign in again." }, { status: 401 });
    const { id } = await params;
    const what = new URL(req.url).searchParams.get("what") === "crosswalk" ? "crosswalk" : "results";
    const f = await exportImportRows(ctx, id, what);
    return new Response(new Uint8Array(f.body), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${f.fileName.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
