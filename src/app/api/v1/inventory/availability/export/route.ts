import { queries } from "@/lib/api/contract";
import { queryRoute } from "@/lib/api/server";
import { exportResponse, runExport } from "@/lib/export";
import { availabilityExport } from "@/modules/inventory";

export const GET = queryRoute(queries.availabilityExport, async (ctx, { format, ...filters }) => exportResponse(await runExport(ctx, availabilityExport, filters, format)));
