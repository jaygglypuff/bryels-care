import { getContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { uploadLegacyScans } from "@/modules/imports";
import { assertSameOrigin, errorResponse } from "../../../_http";

export const dynamic = "force-dynamic";

/** POST /api/v1/imports/<id>/scans — multipart scans (field `files`, repeated) for a legacy_documents import. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const ctx = await getContext();
    if (!ctx) return Response.json({ ok: false, code: "unauthenticated", message: "Sign in again." }, { status: 401 });
    if (Number(req.headers.get("content-length") ?? 0) > 100 * 1024 * 1024) throw new DomainError("too_large", "Upload at most 100 MB of scans at a time.", { field: "files" });
    const { id } = await params;
    const fd = await req.formData();
    const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    const r = await uploadLegacyScans(ctx, id, await Promise.all(files.map(async (f) => ({ fileName: f.name, declaredType: f.type, bytes: new Uint8Array(await f.arrayBuffer()) }))));
    return Response.json({ ok: true, ...r }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
