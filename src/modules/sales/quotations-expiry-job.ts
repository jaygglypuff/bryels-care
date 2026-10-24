import "server-only";
import { z } from "zod";
import { defineJob } from "@/modules/platform/job-definition";
import { expireDueQuotes } from "./quotations";

const manilaDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

export const quoteExpiryPayload = z
  .object({
    /** Business date (Asia/Manila): sent quotations valid until before this date expire. */
    asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    trigger: z.enum(["schedule", "manual"]),
  })
  .strict();
export type QuoteExpiryPayload = z.infer<typeof quoteExpiryPayload>;

/**
 * `sales.quote_expiry` (US-4-04; docs/architecture.md §8): daily at 00:20 Asia/Manila. Sent quotations
 * whose `valid_until` has passed become `expired`, one `sales.quote.expired` audit each, as the
 * organization's system actor. Key `(trigger, as_of)`; the transition itself is idempotent.
 */
export const salesQuoteExpiryJob = defineJob<QuoteExpiryPayload>({
  code: "sales.quote_expiry",
  title: "Quotation expiry",
  description: "Marks sent quotations past their validity date as expired.",
  payload: quoteExpiryPayload,
  keyTuple: (p) => [p.trigger, p.asOf],
  systemPermissions: ["sales.quote.view"],
  schedule: { cron: "20 0 * * *", tz: "Asia/Manila", payload: (now) => ({ asOf: manilaDate(now), trigger: "schedule" }) },
  run: async (run, payload) => {
    const expired = await expireDueQuotes(run.ctx, payload.asOf);
    return { expired: expired.length, quotes: expired };
  },
});
