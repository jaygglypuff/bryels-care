import { queries } from "@/lib/api/contract";
import { queryRoute } from "@/lib/api/server";
import { exportResponse, runExport } from "@/lib/export";
import { recallExport } from "@/modules/quality";

export const GET = queryRoute(queries.recallExport, async (ctx, { format, ...filters }) => exportResponse(await runExport(ctx, recallExport, filters, format)));
