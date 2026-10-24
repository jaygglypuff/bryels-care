import { queries } from "@/lib/api/contract";
import { queryRoute } from "@/lib/api/server";
import { exportResponse, runExport } from "@/lib/export";
import { quotesExport } from "@/modules/sales";

export const GET = queryRoute(queries.salesQuotesExport, async (ctx, { format, ...filters }) => exportResponse(await runExport(ctx, quotesExport, filters, format)));
