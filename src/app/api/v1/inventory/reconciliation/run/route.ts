import { commands } from "@/lib/api/contract";
import { commandRoute } from "@/lib/api/server";
import { requestReconciliation } from "@/modules/inventory";

export const POST = commandRoute(commands.runReconciliation, async (ctx) => {
  const { job, created } = await requestReconciliation(ctx, { siteId: ctx.currentSiteId });
  return { jobId: job.id, status: job.status, created };
});
