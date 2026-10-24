import { z } from "zod";
import { defineJob } from "@/modules/platform/job-definition";
import { enqueueJob } from "@/modules/platform/jobs";
import { deliverAccessReport, deliverScheduledReport, dispatchDueSchedules } from "./delivery";

/**
 * Report jobs (docs/architecture.md §8): the 5-minute dispatcher, one delivery per schedule and
 * slot, and the weekly access-and-exceptions report. All run as the organization's system actor;
 * deliveries rebuild a context per recipient (never the dispatcher's permissions).
 */

const slotOf = (now: Date) => new Date(Math.floor(now.getTime() / 300_000) * 300_000).toISOString();
const SlotPayload = z.object({ slot: z.iso.datetime() }).strict();
type SlotPayload = z.infer<typeof SlotPayload>;

const DeliveryPayload = z.object({ scheduleId: z.uuid(), periodKey: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/) }).strict();
type DeliveryPayload = z.infer<typeof DeliveryPayload>;

export const analyticsScheduledReportJob = defineJob<DeliveryPayload>({
  code: "analytics.scheduled_report",
  title: "Deliver a scheduled report",
  description: "Re-checks every recipient's current access, renders one file per permission/site group, notifies in-app and by email link, records report_runs.",
  payload: DeliveryPayload,
  keyTuple: (p) => [p.scheduleId, p.periodKey],
  maxAttempts: 3,
  systemPermissions: ["analytics.report.view"],
  run: (run, p) => deliverScheduledReport(run.ctx, p.scheduleId, p.periodKey, { jobId: run.job.id, now: run.asOf }),
});

export const analyticsScheduleDispatchJob = defineJob<SlotPayload>({
  code: "analytics.schedule_dispatch",
  title: "Dispatch due scheduled reports",
  description: "Every 5 minutes: enqueues one delivery per due schedule slot, advances next_run_at, clears report files past the retention period.",
  payload: SlotPayload,
  keyTuple: (p) => [p.slot],
  maxAttempts: 2,
  systemPermissions: ["analytics.scheduled_report.view"],
  schedule: { cron: "*/5 * * * *", tz: "Asia/Manila", payload: (now) => ({ slot: slotOf(now) }) },
  run: (run) =>
    dispatchDueSchedules(run.ctx, run.asOf, async (tx, scheduleId, periodKey) => {
      await enqueueJob(tx, run.ctx, analyticsScheduledReportJob, { scheduleId, periodKey });
    }),
});

const WeekPayload = z.object({ asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict();
type WeekPayload = z.infer<typeof WeekPayload>;

export const analyticsAccessReportJob = defineJob<WeekPayload>({
  code: "analytics.access_report",
  title: "Weekly access-and-exceptions report",
  description: "Monday 07:00: the previous week's role grants, restricted-permission use, controlled exceptions, reprints and sensitive exports, delivered to the owner (US-5-14).",
  payload: WeekPayload,
  keyTuple: (p) => [p.asOfDate],
  maxAttempts: 3,
  systemPermissions: ["platform.audit.view"],
  schedule: { cron: "0 7 * * 1", tz: "Asia/Manila", payload: (now) => ({ asOfDate: now.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }) }) },
  run: (run, p) => deliverAccessReport(run.ctx, { now: run.asOf, asOfDate: p.asOfDate, jobId: run.job.id }),
});
