import { queries } from "@/lib/api/contract";
import { queryRoute } from "@/lib/api/server";
import { exportResponse, runExport } from "@/lib/export";
import { shipmentExport } from "@/modules/sales";

export const GET = queryRoute(queries.shipmentExport, async (ctx, { format, ...filters }) => exportResponse(await runExport(ctx, shipmentExport, filters, format)));
