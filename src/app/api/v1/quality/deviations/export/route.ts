import { queries } from "@/lib/api/contract";
import { queryRoute } from "@/lib/api/server";
import { exportResponse, runExport } from "@/lib/export";
import { deviationExport } from "@/modules/quality";

export const GET = queryRoute(queries.deviationsExport, async (ctx, { format, ...filters }) => exportResponse(await runExport(ctx, deviationExport, filters, format)));
