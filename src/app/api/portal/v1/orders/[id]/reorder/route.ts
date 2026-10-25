import { reorderCart } from "@/modules/portal";
import { portalRoute } from "../../../_portal";

/** GET the lines of an earlier order still in the catalogue, at today's prices (nothing is created). */
export const GET = portalRoute<{ id: string }>((ctx, _req, p) => reorderCart(ctx, p.id));
