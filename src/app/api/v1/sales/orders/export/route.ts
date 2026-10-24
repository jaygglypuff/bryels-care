import { queries } from "@/lib/api/contract";
import { queryRoute } from "@/lib/api/server";
import { exportResponse, runExport } from "@/lib/export";
import { ordersExport } from "@/modules/sales";

export const GET = queryRoute(queries.salesOrdersExport, async (ctx, { format, ...filters }) => exportResponse(await runExport(ctx, ordersExport, filters, format)));
