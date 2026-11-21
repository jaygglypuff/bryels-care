import { z } from "zod";
import { defineJob } from "@/modules/platform/job-definition";

const manilaDate = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

/**
 * `inventory.takeout_reminders` (ADR-138 §3): daily at 08:00 Asia/Manila. Open boxes and online shop shelf stock with
 * nothing written down for `inventory.takeout.stale_days` days, and the weekly "count the open boxes" nudge, become
 * self-clearing messages for the site's warehouse people. Key `(as_of_date)`; the messages are deduplicated, so a
 * retry or a second run the same day sends nothing new. Changes no stock.
 */
export const inventoryTakeoutRemindersJob = defineJob<{ asOf: string }>({
  code: "inventory.takeout_reminders",
  title: "Remind to count open boxes",
  description: "Tells the warehouse about open boxes and online shop shelf stock with no take-out and no count for some days, and once a week to count the open boxes.",
  payload: z.object({ asOf: z.iso.datetime() }).strict(),
  keyTuple: (p) => [manilaDate(p.asOf)],
  systemPermissions: ["inventory.takeout.view"],
  schedule: { cron: "0 8 * * *", tz: "Asia/Manila", payload: (now) => ({ asOf: now.toISOString() }) },
  // Loaded on run: the job registry is imported by the platform runtime, which the inventory module depends on.
  run: async (run, payload) => (await import("../takeout-reminders")).runTakeoutReminders({ organizationId: run.ctx.organizationId, now: new Date(payload.asOf) }),
});
