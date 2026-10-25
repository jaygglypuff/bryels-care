import "server-only";
import { z } from "zod";
import { defineJob } from "@/modules/platform/job-definition";
import { computeReorderSuggestions } from "./reorder";

const manilaDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

export const reorderSuggestPayload = z
  .object({
    asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    trigger: z.enum(["schedule", "manual"]),
  })
  .strict();
export type ReorderSuggestPayload = z.infer<typeof reorderSuggestPayload>;

/**
 * `procurement.reorder_suggest` (docs/architecture.md §8, W04-01): nightly at 05:30 Asia/Manila, as the
 * organization's system actor. Recomputes reorder suggestions with their drivers for every active
 * reorder policy; never creates a purchase request or order.
 */
export const procurementReorderSuggestJob = defineJob<ReorderSuggestPayload>({
  code: "procurement.reorder_suggest",
  title: "Reorder suggestions",
  description: "Recomputes reorder suggestions (drivers: stock, reservations, open POs, lead time, expiry risk). Never orders anything.",
  payload: reorderSuggestPayload,
  keyTuple: (p) => [p.trigger, p.asOf],
  systemPermissions: ["procurement.reorder_suggestion.view"],
  schedule: { cron: "30 5 * * *", tz: "Asia/Manila", payload: (now) => ({ asOf: manilaDate(now), trigger: "schedule" }) },
  run: async (run) => computeReorderSuggestions(run.ctx),
});
