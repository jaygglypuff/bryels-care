import { getContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { uploadImport } from "@/modules/imports";
import { assertSameOrigin, errorResponse } from "../_http";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/imports — multipart upload of an import file (US-5-08 step 1). Header Idempotency-Key
 * required. Fields: file, kind, siteId (optional, default current site), mappingCode, reuploadReason.
 * Thin adapter: size, format, row cap, checksum, storage and audit happen in the imports service.
 */
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const ctx = await getContext();
    if (!ctx) return Response.json({ ok: false, code: "unauthenticated", message: "Sign in again." }, { status: 401 });
    if (Number(req.headers.get("content-length") ?? 0) > 21 * 1024 * 1024) throw new DomainError("too_large", "The file is too large. The limit is 20 MB.", { field: "file" });
    const fd = await req.formData();
    const file = fd.get("file");
    if (!(file instanceof File)) throw new DomainError("validation", "Choose a file to upload.", { field: "file" });
    const r = await uploadImport(ctx, {
      kind: String(fd.get("kind") ?? ""),
      siteId: String(fd.get("siteId") ?? "") || null,
      fileName: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
      idempotencyKey: req.headers.get("idempotency-key") ?? "",
      mappingCode: String(fd.get("mappingCode") ?? "") || null,
      reuploadReason: String(fd.get("reuploadReason") ?? "") || null,
    });
    return Response.json({ ok: true, ...r }, { status: r.replayed ? 200 : 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
