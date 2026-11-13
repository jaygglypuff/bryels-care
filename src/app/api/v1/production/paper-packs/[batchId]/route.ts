import { syncRoute, unauthenticated } from "@/lib/offline/server/http";
import { paperPackForDevice } from "@/modules/production";

export const dynamic = "force-dynamic";

/**
 * ADR-134: the printable paper batch record pack of one batch, for the person's device (`pack: null` when none was
 * made). Needs `production.batch.view` and `documents.generated_document.view` at the batch's site; every page is
 * checked against its recorded checksum first. `Cache-Control: no-store`: the device keeps it in its own store.
 */
export const GET = syncRoute("production.paper_pack.get", "GET", async ({ ctx, url }) => {
  if (!ctx) return unauthenticated();
  const batchId = decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) ?? "");
  return { status: 200, body: { ok: true, data: { pack: await paperPackForDevice(ctx, batchId) } } };
});
