import { queries } from "@/lib/api/contract";
import { queryRoute } from "@/lib/api/server";
import { exportResponse, runExport } from "@/lib/export";
import { capaExport } from "@/modules/quality";

export const GET = queryRoute(queries.capaExport, async (ctx, { format, ...filters }) => exportResponse(await runExport(ctx, capaExport, filters, format)));
