import { getContext } from "@/lib/auth/context";
import { contentDisposition } from "@/lib/storage";
import { redeemImportFile } from "@/modules/imports";
import { errorResponse } from "../../../_http";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/imports/files/<id>?exp=&sig= — redeems a 5-minute, user-bound link to an import file (original,
 * results file) or a legacy document scan (docs/security.md §4.8). Always an attachment, nosniff, sandboxed.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getContext();
    if (!ctx) return Response.json({ ok: false, code: "unauthenticated", message: "Sign in again." }, { status: 401 });
    const { id } = await params;
    const url = new URL(req.url);
    const r = await redeemImportFile(ctx, id, { exp: url.searchParams.get("exp"), sig: url.searchParams.get("sig") });
    if (r.kind === "redirect") return new Response(null, { status: 302, headers: { Location: r.url, "Cache-Control": "private, no-store" } });
    return new Response(Buffer.from(r.bytes), {
      headers: {
        "Content-Type": r.contentType,
        "Content-Disposition": contentDisposition(r.fileName),
        "Content-Length": String(r.bytes.length),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
