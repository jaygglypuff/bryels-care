import { commands } from "@/lib/api/contract";
import { commandRoute } from "@/lib/api/server";
import { transferStock } from "@/modules/inventory";

export const POST = commandRoute(commands.transferStock, (ctx, p, meta) => transferStock(ctx, { ...p, idempotencyKey: meta.idempotencyKey }));
