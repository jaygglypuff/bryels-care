import { syncRoute, unauthenticated } from "@/lib/offline/server/http";
import { upcomingPaperPacks } from "@/modules/production";

export const dynamic = "force-dynamic";

/**
 * ADR-134: today's and the next batches at the person's sites, with their paper batch record pack (if made). The
 * device downloads the packs listed here so it can print them with no internet. `Cache-Control: no-store`.
 */
export const GET = syncRoute("production.paper_pack.list", "GET", async ({ ctx }) => {
  if (!ctx) return unauthenticated();
  return { status: 200, body: { ok: true, data: { packs: await upcomingPaperPacks(ctx) } } };
});
