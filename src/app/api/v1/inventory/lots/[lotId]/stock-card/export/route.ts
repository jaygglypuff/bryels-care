import { queries } from "@/lib/api/contract";
import { queryRoute } from "@/lib/api/server";
import { exportResponse, runExport } from "@/lib/export";
import { stockCardExport } from "@/modules/inventory";

export const GET = queryRoute(queries.stockCardExport, async (ctx, { format, ...filters }) => exportResponse(await runExport(ctx, stockCardExport, filters, format)));
