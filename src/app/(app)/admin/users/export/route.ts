import { getContext } from "@/lib/auth/context";
import { DomainError, HTTP_STATUS } from "@/lib/errors";
import { type ExportFormat, exportResponse, runExport } from "@/lib/export";
import { userExportDefinition } from "@/modules/identity";

/** User list export (US-1-16 AC3): identity.user.export, same scope as the screen, audited by runExport. */
export async function GET(req: Request) {
  const ctx = await getContext();
  if (!ctx) return Response.json({ code: "unauthenticated", message: "Sign in again." }, { status: 401 });
  const url = new URL(req.url);
  const format: ExportFormat = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const status = url.searchParams.get("status") ?? undefined;
  try {
    return exportResponse(await runExport(ctx, userExportDefinition, status ? { status } : {}, format));
  } catch (e) {
    if (e instanceof DomainError) return Response.json({ code: e.code, message: e.message }, { status: HTTP_STATUS[e.code] });
    throw e;
  }
}
