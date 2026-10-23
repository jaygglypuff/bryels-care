import { commands } from "@/lib/api/contract";
import { commandRoute } from "@/lib/api/server";
import { cancelJob } from "@/modules/platform";

export const POST = commandRoute(commands.cancelJob, async (ctx, p) => {
  const job = await cancelJob(ctx, p.jobId, p.reason);
  return { jobId: job.id, status: job.status };
});
