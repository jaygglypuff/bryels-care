import { getContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { UPLOAD_LIMITS } from "@/lib/storage";
import { uploadReceiptDocument, type SupplierDocumentKind } from "@/modules/inventory/receiving-documents";
import { assertSameOrigin, errorResponse } from "../_http";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/files — multipart upload of a supplier lot document or receipt photo (US-2-08).
 * Header Idempotency-Key (UUID) required. Fields: file, entityType, entityId, documentKind, documentNumber.
 * Thin adapter: validation, scope and storage happen in the service.
 */
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const ctx = await getContext();
    if (!ctx) return Response.json({ ok: false, code: "unauthenticated", message: "Sign in again." }, { status: 401 });
    const declaredSize = Number(req.headers.get("content-length") ?? 0);
    if (declaredSize > UPLOAD_LIMITS.pdf + 1024 * 1024) throw new DomainError("validation", "The file is too large. The limit is 25 MB for PDFs and 10 MB for photos.", { field: "file" });
    const fd = await req.formData();
    const file = fd.get("file");
    if (!(file instanceof File)) throw new DomainError("validation", "Choose a file to upload.", { field: "file" });
    const entityType = String(fd.get("entityType") ?? "");
    if (entityType !== "goods_receipt" && entityType !== "goods_receipt_line") throw new DomainError("validation", "Unknown record type.");
    const r = await uploadReceiptDocument(ctx, {
      entityType,
      entityId: String(fd.get("entityId") ?? ""),
      documentKind: String(fd.get("documentKind") ?? "") as SupplierDocumentKind,
      documentNumber: String(fd.get("documentNumber") ?? ""),
      fileName: file.name,
      declaredType: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
      idempotencyKey: req.headers.get("idempotency-key") ?? "",
    });
    return Response.json({ ok: true, ...r }, { status: r.replayed ? 200 : 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
