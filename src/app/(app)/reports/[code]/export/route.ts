import { getContext } from "@/lib/auth/context";
import { DomainError, HTTP_STATUS } from "@/lib/errors";
import { type ReportFormat, exportReport } from "@/modules/reports";

/** Report download (US-5-04): CSV, XLSX or printable HTML through the reports service; audited there. */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const ctx = await getContext();
  if (!ctx) return Response.json({ code: "unauthenticated", message: "Sign in again." }, { status: 401 });
  const { code } = await params;
  const url = new URL(req.url);
  const f = url.searchParams.get("format");
  const format: ReportFormat = f === "xlsx" ? "xlsx" : f === "html" ? "html" : "csv";
  const raw: Record<string, string> = {};
  for (const [k, v] of url.searchParams) if (k !== "format" && v !== "") raw[k] = v;
  try {
    const file = await exportReport(ctx, code, raw, format);
    return new Response(new Uint8Array(file.body), {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${file.fileName}"`,
        "Cache-Control": "no-store",
        "X-Export-Rows": String(file.rowCount),
        "X-Export-Sha256": file.sha256,
        "X-Export-Truncated": file.truncated ? "1" : "0",
      },
    });
  } catch (e) {
    if (e instanceof DomainError) return Response.json({ code: e.code, message: e.message, details: e.details ?? null }, { status: HTTP_STATUS[e.code] });
    throw e;
  }
}
