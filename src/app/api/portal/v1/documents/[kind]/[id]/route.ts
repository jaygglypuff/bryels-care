import { getPortalDocument } from "@/modules/portal";
import { portalRoute } from "../../../_portal";

/** GET one document as the customer copy (allow-listed fields); another customer's id answers 404. */
export const GET = portalRoute<{ kind: string; id: string }>((ctx, _req, p) => getPortalDocument(ctx, p.kind, p.id));
