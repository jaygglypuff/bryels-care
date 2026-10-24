import { queries } from "@/lib/api/contract";
import { queryRoute } from "@/lib/api/server";
import { exportResponse, runExport } from "@/lib/export";
import { genealogyExport } from "@/modules/quality";

export const GET = queryRoute(queries.genealogyExport, async (ctx, { format, ...filters }) => exportResponse(await runExport(ctx, genealogyExport, filters, format)));
