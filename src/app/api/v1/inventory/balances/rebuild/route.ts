import { commands } from "@/lib/api/contract";
import { commandRoute } from "@/lib/api/server";
import { requestBalanceRebuild } from "@/modules/inventory";

export const POST = commandRoute(commands.rebuildBalances, async (ctx, p) => {
  const { job, created } = await requestBalanceRebuild(ctx, { siteId: ctx.currentSiteId, reconciliationRunId: p.reconciliationRunId ?? null, lotIds: p.lotIds ?? null, reason: p.reason });
  return { jobId: job.id, status: job.status, created };
});
