import { commands } from "@/lib/api/contract";
import { commandRoute } from "@/lib/api/server";
import { retryJob } from "@/modules/platform";

export const POST = commandRoute(commands.retryJob, async (ctx, p) => {
  const job = await retryJob(ctx, p.jobId, p.reason);
  return { jobId: job.id, status: job.status };
});
