import { queries } from "@/lib/api/contract";
import { queryRoute } from "@/lib/api/server";
import { getCustomer } from "@/modules/sales";

/** Masked customer DTO (US-4-01 AC1: credit fields absent with a `_masked` hint without finance.credit_terms.view). */
export const GET = queryRoute(queries.salesCustomer, async (ctx, q) => {
  const { customer, addresses, contacts } = await getCustomer(ctx, q.customerId);
  return { customer, addresses, contacts };
});
