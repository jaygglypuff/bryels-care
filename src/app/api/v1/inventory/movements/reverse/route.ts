import { commands } from "@/lib/api/contract";
import { commandRoute } from "@/lib/api/server";
import { reverseMovement } from "@/modules/inventory";

export const POST = commandRoute(commands.reverseMovement, (ctx, p, meta) =>
  reverseMovement(ctx, { movementId: p.movementId, reason: p.reason, confirmation: p.confirmation, replacement: p.replacement ?? null, idempotencyKey: meta.idempotencyKey }),
);
