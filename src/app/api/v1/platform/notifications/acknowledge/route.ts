import { commands } from "@/lib/api/contract";
import { commandRoute } from "@/lib/api/server";
import { acknowledgeNotification } from "@/modules/platform";

export const POST = commandRoute(commands.acknowledgeNotification, async (ctx, p) => {
  const n = await acknowledgeNotification(ctx, p.notificationId);
  return { notificationId: n.id, acknowledgedAt: n.acknowledgedAt };
});
