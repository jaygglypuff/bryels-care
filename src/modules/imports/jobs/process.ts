import "server-only";
import { z } from "zod";
import { DomainError } from "@/lib/errors";
import { defineJob } from "@/modules/platform/job-definition";
import { markRunFailed, runPosting, runValidation } from "../engine";

/**
 * Job `platform.import_job.process` (docs/architecture.md §8): validates or posts one import job in the
 * worker, on behalf of the user who started the run (context rebuilt from their current access, actor
 * `system:platform.import_job.process`). Key `(import_job_id, phase, run_no)`: a duplicate enqueue of the
 * same run is dropped and a retried run continues where it stopped (posted rows are skipped).
 * A permanent failure (domain error or attempts exhausted) marks the import `failed` with the message.
 */
export const payloadSchema = z.object({ importJobId: z.uuid(), phase: z.enum(["validate", "post"]), runNo: z.number().int().min(1) }).strict();
export type ImportProcessPayload = z.infer<typeof payloadSchema>;

export const importJobProcessJob = defineJob<ImportProcessPayload>({
  code: "platform.import_job.process",
  title: "Validate or post an import",
  description: "Runs the import engine for one import job: validation (dry run of every row) or posting in chunks.",
  payload: payloadSchema,
  keyTuple: (p) => [p.importJobId, p.phase, p.runNo],
  maxAttempts: 3,
  timeoutSeconds: 3600,
  run: async (run, p) => {
    try {
      return p.phase === "validate" ? await runValidation(run.ctx, p.importJobId, p.runNo) : await runPosting(run.ctx, p.importJobId, p.runNo);
    } catch (e) {
      if (e instanceof DomainError || run.attempt >= run.job.maxAttempts) await markRunFailed(run.ctx, p.importJobId, p.runNo, e instanceof Error ? e.message : String(e));
      throw e;
    }
  },
});
