import { queries } from "@/lib/api/contract";
import { queryRoute } from "@/lib/api/server";
import { getStockCard } from "@/modules/inventory";

export const GET = queryRoute(queries.stockCard, (ctx, q) => getStockCard(ctx, q));
