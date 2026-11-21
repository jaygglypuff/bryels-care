import { commands } from "@/lib/api/contract";
import { commandRoute } from "@/lib/api/server";
import { createTakeout } from "@/modules/inventory";

/** ADR-138: take a few finished pieces out (thin adapter; the service checks permission, site, stock and limits). */
export const POST = commandRoute(commands.createTakeout, (ctx, p, meta) => createTakeout(ctx, { ...p, idempotencyKey: meta.idempotencyKey }));
