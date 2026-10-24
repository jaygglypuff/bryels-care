import { getContext } from "@/lib/auth/context";
import { DomainError, HTTP_STATUS } from "@/lib/errors";
import { downloadRunFile } from "@/modules/reports";

/** A delivered scheduled-report file: its recipients only, access re-checked now, audited (US-5-05). */
export async function GET(_req: Request, { params }: { params: Promise<{ runId: string; fileId: string }> }) {
  const ctx = await getContext();
  if (!ctx) return Response.json({ code: "unauthenticated", message: "Sign in again." }, { status: 401 });
  const { runId, fileId } = await params;
  try {
    const f = await downloadRunFile(ctx, runId, fileId);
    return new Response(new Uint8Array(f.body), {
      status: 200,
      headers: { "Content-Type": f.contentType, "Content-Disposition": `attachment; filename="${f.fileName}"`, "Cache-Control": "no-store", "X-Export-Sha256": f.sha256 },
    });
  } catch (e) {
    if (e instanceof DomainError) return Response.json({ code: e.code, message: e.message }, { status: HTTP_STATUS[e.code] });
    throw e;
  }
}
