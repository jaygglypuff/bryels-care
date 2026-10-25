import { listPortalDocuments } from "@/modules/portal";
import { portalRoute } from "../_portal";

/** GET the customer's own documents (quotations, delivery receipts; invoices once finance registers them). */
export const GET = portalRoute((ctx, req) => listPortalDocuments(ctx, { kind: new URL(req.url).searchParams.get("kind") ?? undefined }));
