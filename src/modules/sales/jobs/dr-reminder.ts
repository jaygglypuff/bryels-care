import { z } from "zod";
import { defineJob } from "@/modules/platform/job-definition";

const manilaDate = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

/**
 * `sales.delivery_receipt_reminder` (US-4-13, W09 exception "driver leaves without acknowledgment"):
 * daily at 07:00 Asia/Manila, dispatched shipments whose DR is not acknowledged after
 * `sales.delivery_receipt.unacknowledged_days` reach the action centre of the site's warehouse,
 * site manager and sales roles (one notification per DR and day).
 */
export const salesDeliveryReceiptReminderJob = defineJob<{ asOf: string }>({
  code: "sales.delivery_receipt_reminder",
  title: "Remind about unacknowledged delivery receipts",
  description: "Notifies the site's warehouse, site manager and sales roles about dispatched shipments whose delivery receipt is not acknowledged after the configured days.",
  payload: z.object({ asOf: z.iso.datetime() }).strict(),
  keyTuple: (p) => [manilaDate(p.asOf)],
  systemPermissions: ["sales.delivery_receipt.view"],
  schedule: { cron: "0 7 * * *", tz: "Asia/Manila", payload: (now) => ({ asOf: now.toISOString() }) },
  // Loaded on run: the job registry is imported by the platform runtime, which the sales module depends on.
  run: async (run) => (await import("../delivery-receipts")).remindUnacknowledged(run),
});
