import { commands } from "@/lib/api/contract";
import { commandRoute } from "@/lib/api/server";
import { submitOrder } from "@/modules/sales";

export const POST = commandRoute(commands.submitSalesOrder, (ctx, p) => submitOrder(ctx, p.orderId));
