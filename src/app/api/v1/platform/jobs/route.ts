import { queries } from "@/lib/api/contract";
import { queryRoute } from "@/lib/api/server";
import { listJobs } from "@/modules/platform";

export const GET = queryRoute(queries.jobs, (ctx, q) => listJobs(ctx, q));
