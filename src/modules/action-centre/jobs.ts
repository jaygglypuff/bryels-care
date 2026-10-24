import { z } from "zod";
import { defineJob } from "@/modules/platform/job-definition";
import { refreshActionItems } from "./items";

const slotOf = (now: Date) => new Date(Math.floor(now.getTime() / 300_000) * 300_000).toISOString();
const SlotPayload = z.object({ slot: z.iso.datetime() }).strict();
type SlotPayload = z.infer<typeof SlotPayload>;

/** Every 5 minutes: refresh the action-centre queue, notify rule owners, escalate overdue items (US-5-06, US-5-07). */
export const platformActionCentreSweepJob = defineJob<SlotPayload>({
  code: "platform.action_centre_sweep",
  title: "Refresh the action centre and escalate",
  description: "Opens items for new approvals and exceptions, clears items whose record resolved, notifies the rule's roles and escalates items left unacknowledged past the rule's delay.",
  payload: SlotPayload,
  keyTuple: (p) => [p.slot],
  maxAttempts: 2,
  systemPermissions: ["platform.job.view"],
  schedule: { cron: "*/5 * * * *", tz: "Asia/Manila", payload: (now) => ({ slot: slotOf(now) }) },
  run: (run) => refreshActionItems(run.ctx.organizationId, run.asOf),
});
