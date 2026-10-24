import { queries } from "@/lib/api/contract";
import { queryRoute } from "@/lib/api/server";
import { exportResponse, runExport } from "@/lib/export";
import { customersExport } from "@/modules/sales";

export const GET = queryRoute(queries.salesCustomersExport, async (ctx, { format, ...filters }) => exportResponse(await runExport(ctx, customersExport, filters, format)));
