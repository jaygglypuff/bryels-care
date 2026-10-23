import "server-only";
import { z } from "zod";
import { defineJob } from "@/modules/platform/job-definition";
import { runExpiryCheck } from "../holds-expiry";

const manilaDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

export const expiryCheckPayload = z
  .object({
    /** Business date (Asia/Manila) the check runs as of; a lot expiring on this date is still usable that day. */
    asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    trigger: z.enum(["schedule", "manual"]),
  })
  .strict();
export type ExpiryCheckPayload = z.infer<typeof expiryCheckPayload>;

/**
 * `inventory.expiry_check` (US-2-10 AC2, US-2-16 AC1; docs/architecture.md §8): daily at 00:15
 * Asia/Manila for every organization. Expires lots past their date, holds released lots at their
 * retest date, and sends deduplicated `expiring_lot` notifications. Runs as the organization's
 * system actor (ADR-029); a manual run records the requesting user as on_behalf_of. Key
 * `(trigger, as_of)`: one run per business day; the check itself is idempotent.
 */
export const inventoryExpiryCheckJob = defineJob<ExpiryCheckPayload>({
  code: "inventory.expiry_check",
  title: "Expiry and retest check",
  description: "Marks lots past their expiry date expired, puts released lots at their retest date on QA hold and sends near-expiry alerts.",
  payload: expiryCheckPayload,
  keyTuple: (p) => [p.trigger, p.asOf],
  // Reads lots and records rule-driven expire/hold dispositions; deliberately NOT quality.disposition.approve
  // (a scheduled rule never releases or rejects anything).
  systemPermissions: ["inventory.lot.view", "quality.disposition.view"],
  schedule: { cron: "15 0 * * *", tz: "Asia/Manila", payload: (now) => ({ asOf: manilaDate(now), trigger: "schedule" }) },
  run: (run, payload) =>
    runExpiryCheck({ organizationId: run.ctx.organizationId, asOf: payload.asOf, onBehalfOf: run.job.requestedBy, correlationId: run.correlationId }),
});
