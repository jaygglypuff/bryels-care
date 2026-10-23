import { queries } from "@/lib/api/contract";
import { queryRoute } from "@/lib/api/server";
import { availabilityRows, availabilityTotals, manilaToday } from "@/modules/inventory";

export const GET = queryRoute(queries.availability, async (ctx, q) => {
  const asOf = q.asOf ?? manilaToday();
  const rows = await availabilityRows(ctx, { ...q, asOf });
  return { asOf, siteId: q.siteId, totals: availabilityTotals(rows, asOf), rows };
});
