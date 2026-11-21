import { queries } from "@/lib/api/contract";
import { queryRoute } from "@/lib/api/server";
import { exportResponse, runExport } from "@/lib/export";
import { takeoutsExport } from "@/modules/inventory";

/** ADR-138: the Taken out lines as CSV/XLSX (inventory.takeout.export; current site; audited by runExport). */
export const GET = queryRoute(queries.takeoutsExport, async (ctx, { format, ...filters }) => exportResponse(await runExport(ctx, takeoutsExport, filters, format)));
