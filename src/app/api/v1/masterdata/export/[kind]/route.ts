import { getContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { type ExportFormat, exportResponse, runExport } from "@/lib/export";
import { materialsExport, productsExport, skusExport } from "@/modules/masterdata";
import { errorResponse } from "../../../_http";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/masterdata/export/{products|skus|materials}?format=csv|xlsx&q=&status=…
 * Runs through src/lib/export.ts: the module `.export` permission, the same query as the screen,
 * formula neutralisation and the platform.export.created audit row (US-1-22 AC3, US-1-23).
 */
export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  try {
    const ctx = await getContext();
    if (!ctx) return Response.json({ ok: false, code: "unauthenticated", message: "Sign in again." }, { status: 401 });
    const { kind } = await params;
    const u = new URL(req.url);
    const format = (u.searchParams.get("format") ?? "csv") as ExportFormat;
    const pick = (...keys: string[]) => Object.fromEntries(keys.map((k) => [k, u.searchParams.get(k) || undefined]).filter(([, v]) => v));
    if (kind === "products") return exportResponse(await runExport(ctx, productsExport, pick("q", "status", "family"), format));
    if (kind === "skus") return exportResponse(await runExport(ctx, skusExport, pick("q", "status", "productId"), format));
    if (kind === "materials") return exportResponse(await runExport(ctx, materialsExport, pick("q", "status", "materialKind"), format));
    throw new DomainError("not_found", "Unknown export.");
  } catch (e) {
    return errorResponse(e);
  }
}
