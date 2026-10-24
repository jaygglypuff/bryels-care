import { commands } from "@/lib/api/contract";
import { commandRoute } from "@/lib/api/server";
import { approveOrder } from "@/modules/sales";

export const POST = commandRoute(commands.approveSalesOrder, (ctx, p) => approveOrder(ctx, p.orderId, { note: p.note ?? null }));
