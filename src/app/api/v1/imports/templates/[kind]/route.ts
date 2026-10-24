import { getContext } from "@/lib/auth/context";
import { getImportKind, templateFile } from "@/modules/imports";
import { errorResponse } from "../../../_http";
import { registerAppHooks } from "@/modules/wiring";

registerAppHooks(); // Wave 3 cross-module registrations (src/modules/wiring.ts); cheap and idempotent

export const dynamic = "force-dynamic";

/** GET /api/v1/imports/templates/<kind>?format=csv|xlsx — template with clearly fictional example rows (§9.2). */
export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  try {
    const ctx = await getContext();
    if (!ctx) return Response.json({ ok: false, code: "unauthenticated", message: "Sign in again." }, { status: 401 });
    ctx.require("platform.import_job.view");
    const { kind } = await params;
    const format = new URL(req.url).searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
    const f = templateFile(getImportKind(kind), format);
    return new Response(new Uint8Array(f.body), {
      headers: { "Content-Type": f.contentType, "Content-Disposition": `attachment; filename="${f.fileName}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
