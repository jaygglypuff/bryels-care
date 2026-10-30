import { z } from "zod";
import { defineJob } from "@/modules/platform/job-definition";

/** Hour bucket in Asia/Manila (key tuple): one run per hour and organization. */
const manilaHour = (iso: string) => new Date(iso).toLocaleString("sv-SE", { timeZone: "Asia/Manila" }).slice(0, 13);

/**
 * `production.curing_reminder` (ADR-080 V2-5): hourly, started curing / resting steps whose minimum
 * time has passed notify the site's people with production.batch.edit, once per step record
 * (dedupe key `curing-ready:<step record id>`), so retries and later runs never send it again.
 */
export const productionCuringReminderJob = defineJob<{ asOf: string }>({
  code: "production.curing_reminder",
  title: "Remind when curing or resting is finished",
  description: "Notifies the site's production people once when a batch's curing, resting or mould time has reached its ready date.",
  payload: z.object({ asOf: z.iso.datetime() }).strict(),
  keyTuple: (p) => [manilaHour(p.asOf)],
  systemPermissions: ["production.batch.view"],
  schedule: { cron: "5 * * * *", tz: "Asia/Manila", payload: (now) => ({ asOf: now.toISOString() }) },
  // Loaded on run: the job registry is imported by the platform runtime, which the production module depends on.
  run: async (run) => (await import("../curing")).remindCuringReady(run),
});
