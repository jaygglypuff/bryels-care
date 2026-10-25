import { portalCatalogue } from "@/modules/portal";
import { portalRoute } from "../_portal";

/** GET the signed-in customer's approved catalogue with their prices (portal.catalog.view). */
export const GET = portalRoute((ctx) => portalCatalogue(ctx));
