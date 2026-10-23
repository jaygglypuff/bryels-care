import { queries } from "@/lib/api/contract";
import { queryRoute } from "@/lib/api/server";
import { listMyNotifications } from "@/modules/platform";

export const GET = queryRoute(queries.notifications, (ctx, q) => listMyNotifications(ctx, q));
