import { getPortalOrder } from "@/modules/portal";
import { portalRoute } from "../../_portal";

/** GET one order of the signed-in customer; another customer's order id answers 404. */
export const GET = portalRoute<{ id: string }>((ctx, _req, p) => getPortalOrder(ctx, p.id));
