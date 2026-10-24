import { getContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { UPLOAD_LIMITS, contentDisposition } from "@/lib/storage";
import { attachPaperScan, redeemPaperScan } from "@/modules/production";
import { assertSameOrigin, errorResponse } from "../../../../_http";

export const dynamic = "force-dynamic";

/**
 * Scan of a hybrid paper record page (US-3-20).
 * POST multipart (field `file`, optional `transcriptionNote`), header Idempotency-Key (UUID): the
 * uploader declares they transcribed the page into the system. GET ?exp=&sig=: redeems a 5-minute,
 * user-bound link (docs/security.md §4.8), served as an attachment, never inline.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const ctx = await getContext();
    if (!ctx) return Response.json({ ok: false, code: "unauthenticated", message: "Sign in again." }, { status: 401 });
    const { id } = await params;
    const declaredSize = Number(req.headers.get("content-length") ?? 0);
    if (declaredSize > UPLOAD_LIMITS.pdf + 1024 * 1024) throw new DomainError("validation", "The file is too large. The limit is 25 MB for PDFs and 10 MB for photos.", { field: "file" });
    const fd = await req.formData();
    const file = fd.get("file");
    if (!(file instanceof File)) throw new DomainError("validation", "Choose the scan or photo of the completed page.", { field: "file" });
    const r = await attachPaperScan(ctx, {
      paperRecordId: id,
      fileName: file.name,
      declaredType: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
      transcriptionNote: String(fd.get("transcriptionNote") ?? "") || null,
      idempotencyKey: req.headers.get("idempotency-key") ?? "",
    });
    return Response.json({ ok: true, ...r }, { status: r.replayed ? 200 : 201 });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getContext();
    if (!ctx) return Response.json({ ok: false, code: "unauthenticated", message: "Sign in again." }, { status: 401 });
    const { id } = await params;
    const url = new URL(req.url);
    const r = await redeemPaperScan(ctx, id, { exp: url.searchParams.get("exp"), sig: url.searchParams.get("sig") });
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
