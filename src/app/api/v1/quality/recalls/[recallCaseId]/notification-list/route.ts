import { queries } from "@/lib/api/contract";
import { queryRoute } from "@/lib/api/server";
import { exportResponse, runExport } from "@/lib/export";
import { recallNotificationExport } from "@/modules/quality";

export const GET = queryRoute(queries.recallNotificationExport, async (ctx, { format, recallCaseId }) => exportResponse(await runExport(ctx, recallNotificationExport, { recallCaseId }, format)));
